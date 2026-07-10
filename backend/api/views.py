# backend/api/views.py
import json
import logging
import re
import requests
import ssl
import threading
import time
from datetime import timedelta
import urllib.error
import urllib.parse
import urllib.request
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, List

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db.models import Avg, Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework.authtoken.models import Token

from core.analysis.parameter_optimiser import (
    METAHEURISTIC_OPTIMISERS,
    build_param_grid,
    build_param_values,
    estimate_total_runs,
    genetic_optimizer,
    optimizer,
)
from core.main import dslJSONBacktest, BacktestError, dataframe_to_response_records
from core.parsing.parser import parse_dsl as parse_dsl_text
from core.parsing.extractingTickers import extract_tickers as _extract_tickers
from core.parsing.extractingTickers import extract_signal_tickers as _extract_signal_tickers
from core.data_pulling.datapull import get_data_with_indicator
from .assistant import _market_csv_path, _load_market_csv
from .assistant import (
    INDICATOR_KNOWLEDGE,
    AssistantError,
    ask_indicator_assistant,
    ask_strategy_assistant,
    normalize_assistant_messages,
    normalize_indicator_context,
    normalize_strategy_context,
    prepare_strategy_market_data,
)
from .indicator_sandbox import (
    IndicatorValidationError,
    compile_indicator,
    run_indicator_test,
    validate_parameters,
)
from .models import BacktestRun, CustomIndicator, PaperAccountState, Strategy, StrategyConversation, StrategyQueryLog
from . import entitlements
from .entitlements import PlanLimitError
from .plans import PLANS
from core.LLM.orca_llm import LLMUnavailableError, parse_strategy, parse_strategy_with_context

LLM_UNAVAILABLE_MESSAGE = (
    "The AI strategy builder is temporarily unavailable. "
    "You can still build and run strategies with Manual Mode."
)
from core.LLM.ambiguity import (
    detect_missing_fields,
    get_next_question,
    is_non_strategy_input,
)

try:
    import certifi
except ImportError:  # pragma: no cover - certifi is present in the project venv, fallback is for portability.
    certifi = None

User = get_user_model()
logger = logging.getLogger(__name__)

def _prewarm_model():
    try:
        from core.LLM.orca_llm import prewarm
        prewarm()
    except Exception as e:
        logger.warning(f"Model pre-warm failed: {e}")

threading.Thread(target=_prewarm_model, daemon=True).start()


class CacheJobStore:
    """Async-job store backed by the Django cache.

    Optimization jobs run in a background thread inside one worker, but the
    status poll can be served by any worker. A module-level dict only lives in
    the worker that created the job, so polls hitting a different worker (or any
    poll after a restart) 404. Persisting job state to the shared cache (Redis
    in prod, a single-host file cache otherwise) makes jobs visible to every
    worker. An index key tracks live job ids for cleanup and per-user counts.
    """

    def __init__(self, namespace: str):
        self.namespace = namespace
        self.index_key = f"jobs:{namespace}:index"

    def _key(self, job_id: str) -> str:
        return f"jobs:{self.namespace}:{job_id}"

    def _ttl(self) -> int:
        return int(getattr(settings, "ASYNC_JOB_TTL_SECONDS", 3600))

    def _index(self) -> set[str]:
        return set(cache.get(self.index_key) or [])

    def _mutate_index(self, mutate: Callable[[set[str]], None]) -> None:
        """Apply ``mutate(ids)`` to the index under a short cache lock.

        The index is a read-modify-write of one cache key, so two concurrent
        job creations could otherwise each read the same snapshot and the
        second save would silently drop the first job's id (making it invisible
        to cleanup and the per-user active count). If the lock can't be
        obtained quickly we proceed unguarded — a rare dropped index entry is
        better than failing the user's request outright.
        """
        lock_key = f"{self.index_key}:lock"
        acquired = False
        try:
            for _ in range(50):
                try:
                    acquired = bool(cache.add(lock_key, 1, timeout=5))
                except Exception:
                    break  # cache backend without working add(): fall through unguarded
                if acquired:
                    break
                time.sleep(0.02)
            ids = self._index()
            mutate(ids)
            cache.set(self.index_key, list(ids), timeout=None)
        finally:
            if acquired:
                cache.delete(lock_key)

    def get(self, job_id: str):
        return cache.get(self._key(job_id))

    def set(self, job_id: str, job: dict[str, Any]) -> None:
        cache.set(self._key(job_id), job, timeout=self._ttl())
        if job_id not in self._index():
            self._mutate_index(lambda ids: ids.add(job_id))

    def update(self, job_id: str, **changes):
        job = self.get(job_id)
        if job is None:
            return None
        job.update(changes)
        self.set(job_id, job)
        return job

    def pop(self, job_id: str) -> None:
        cache.delete(self._key(job_id))
        if job_id in self._index():
            self._mutate_index(lambda ids: ids.discard(job_id))

    def all(self) -> dict[str, dict[str, Any]]:
        ids = self._index()
        result: dict[str, dict[str, Any]] = {}
        stale: set[str] = set()
        for job_id in list(ids):
            job = cache.get(self._key(job_id))
            if job is None:  # expired via TTL — drop from the index.
                stale.add(job_id)
            else:
                result[job_id] = job
        if stale:
            self._mutate_index(lambda live: live.difference_update(stale))
        return result


optimizer_jobs = CacheJobStore("optimizer")
genetic_jobs = CacheJobStore("genetic")
# Shared store for the metaheuristic optimizers (random / pso / annealing / differential),
# which all run through the single dslOptimiser endpoint and differ only by `method`.
optimiser_jobs = CacheJobStore("optimiser")


def run_async_job(
    store: CacheJobStore,
    user_id: int,
    total_runs: int,
    work_fn: Callable,
    on_error: Callable[[], None] | None = None,
) -> str:
    """Create a queued job and run ``work_fn(progress_hook)`` in a daemon thread.

    All job state is persisted to ``store`` (the shared cache) so any worker can
    serve the status poll. ``work_fn`` receives a progress hook ``(done, total)``.
    ``on_error`` (if given) runs when the job fails — used to refund the
    optimize quota so a failed run isn't charged against the monthly allowance.
    """
    job_id = str(uuid.uuid4())
    store.set(job_id, {
        "status": "queued",
        "completed_runs": 0,
        "total_runs": total_runs,
        "result": None,
        "error": None,
        "user_id": user_id,
        "created_at": timezone.now(),
    })

    # Persisting every progress tick would mean a cache write (disk/Redis I/O)
    # per backtest run. Throttle to ~1/sec, but always flush the final tick.
    last_write = {"t": 0.0}

    def progress_hook(done, total):
        now = time.monotonic()
        if done < total and (now - last_write["t"]) < 1.0:
            return
        last_write["t"] = now
        store.update(job_id, completed_runs=done, total_runs=total, status="running")

    def run_job():
        try:
            result = work_fn(progress_hook)
            job = store.get(job_id)
            final_total = job.get("total_runs", total_runs) if job else total_runs
            store.update(job_id, result=result, status="completed", completed_runs=final_total)
        except Exception as exc:
            store.update(
                job_id,
                error=str(exc) if settings.DEBUG else "Optimization failed.",
                status="error",
            )
            if on_error is not None:
                try:
                    on_error()
                except Exception:
                    logger.exception("Async job on_error hook failed")

    threading.Thread(target=run_job, daemon=True).start()
    return job_id

DEFAULT_INITIAL_BALANCE = 10000.0
MAX_STRATEGY_NAME_LENGTH = 255
MAX_INDICATOR_NAME_LENGTH = 120
MAX_INDICATOR_DESCRIPTION_LENGTH = 2000
MAX_INDICATOR_CODE_LENGTH = 20000

DEFAULT_RATE_LIMITS = {
    "auth": {"max_requests": 20, "window_seconds": 300},
    "backtest": {"max_requests": 60, "window_seconds": 60},
    "backtest_daily": {"max_requests": 10, "window_seconds": 86400},
    "compute": {"max_requests": 10, "window_seconds": 60},
    "optimize_daily": {"max_requests": 3, "window_seconds": 86400},
    "status": {"max_requests": 120, "window_seconds": 60},
    "assistant": {"max_requests": 30, "window_seconds": 60},
    "general": {"max_requests": 180, "window_seconds": 60},
}


class APIError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def json_error(message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"error": message}, status=status)


def no_store(response: JsonResponse) -> JsonResponse:
    response["Cache-Control"] = "no-store"
    return response


def user_payload(user) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.first_name or user.username,
        "date_joined": user.date_joined.isoformat() if hasattr(user, "date_joined") else None,
        # Google-SSO accounts are created without a usable password; the
        # frontend uses this to swap password-confirmation flows (delete
        # account, change password) for SSO-appropriate ones.
        "has_password": user.has_usable_password(),
    }


def error_response(exc: Exception) -> JsonResponse:
    if isinstance(exc, PlanLimitError):
        return JsonResponse(exc.to_dict(), status=exc.status_code)

    if isinstance(exc, APIError):
        return json_error(exc.message, status=exc.status_code)

    logger.exception("Unhandled API exception", exc_info=exc)
    if settings.DEBUG:
        return json_error(str(exc), status=500)
    return json_error("Internal server error", status=500)


def api_error_boundary(view_func: Callable) -> Callable:
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        try:
            return view_func(request, *args, **kwargs)
        except Exception as exc:
            return error_response(exc)

    return wrapped


def parse_body(request) -> dict[str, Any]:
    content_type = request.headers.get("Content-Type", "")
    if content_type and "application/json" not in content_type:
        raise APIError("Expected application/json request body.")

    raw_body = request.body or b""
    max_size = int(getattr(settings, "MAX_JSON_BODY_BYTES", 1048576))
    if len(raw_body) > max_size:
        raise APIError("Request body too large.", status_code=413)
    if not raw_body:
        return {}

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise APIError("Invalid JSON payload.")

    if not isinstance(payload, dict):
        raise APIError("JSON payload must be an object.")

    return payload


def require_methods(*methods: str) -> Callable:
    allowed = set(methods)

    def decorator(view_func: Callable) -> Callable:
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            if request.method not in allowed:
                return json_error("Method not allowed.", status=405)
            return view_func(request, *args, **kwargs)

        return wrapped

    return decorator


def resolve_rate_limit(bucket: str) -> tuple[int, int]:
    limits = getattr(settings, "API_RATE_LIMITS", {})
    bucket_limits = limits.get(bucket, DEFAULT_RATE_LIMITS.get(bucket, DEFAULT_RATE_LIMITS["general"]))
    max_requests = int(bucket_limits.get("max_requests", DEFAULT_RATE_LIMITS["general"]["max_requests"]))
    window_seconds = int(bucket_limits.get("window_seconds", DEFAULT_RATE_LIMITS["general"]["window_seconds"]))
    return max(1, max_requests), max(1, window_seconds)


def get_client_ip(request) -> str:
    """Best-effort client IP for IP-based rate limiting.

    X-Forwarded-For is fully client-controllable, so trusting its leftmost value
    lets an attacker mint a fresh rate-limit bucket per request and walk straight
    past the auth/brute-force limits. We therefore only honor XFF when
    TRUSTED_PROXY_COUNT is set (= the number of trusted proxies in front of the
    app, e.g. 1 behind Railway/Vercel's edge) and read the entry that proxy
    appended — counting from the right, which a client cannot forge. Default 0
    means "no trusted proxy", so we use the real socket peer (REMOTE_ADDR).
    """
    num_proxies = int(getattr(settings, "TRUSTED_PROXY_COUNT", 0))
    remote_addr = (request.META.get("REMOTE_ADDR") or "").strip()

    if num_proxies > 0:
        forwarded_for = request.headers.get("X-Forwarded-For", "")
        parts = [part.strip() for part in forwarded_for.split(",") if part.strip()]
        if len(parts) >= num_proxies:
            return parts[-num_proxies] or "unknown"

    return remote_addr or "unknown"


def get_rate_limit_identifier(request) -> str:
    user = getattr(request, "api_user", None)
    if user:
        return f"user:{user.id}"
    return f"ip:{get_client_ip(request)}"


def rate_limit(bucket: str) -> Callable:
    def decorator(view_func: Callable) -> Callable:
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            max_requests, window_seconds = resolve_rate_limit(bucket)
            cache_key = f"ratelimit:{bucket}:{get_rate_limit_identifier(request)}"

            try:
                is_new = cache.add(cache_key, 1, timeout=window_seconds)
                if is_new:
                    count = 1
                else:
                    try:
                        count = cache.incr(cache_key)
                    except ValueError:
                        cache.set(cache_key, 1, timeout=window_seconds)
                        count = 1
            except Exception:
                # If cache is unavailable, don't block all traffic.
                return view_func(request, *args, **kwargs)

            if count > max_requests:
                response = json_error("Too many requests. Please try again later.", status=429)
                response["Retry-After"] = str(window_seconds)
                return response

            return view_func(request, *args, **kwargs)

        return wrapped

    return decorator


def enforce_optimize_intensity(total_runs: int) -> None:
    """Reject optimizations that would run too many backtests.

    `total_runs` is how many backtests the optimization will execute (grid = the
    product of parameter-value counts; genetic = population x generations;
    metaheuristics = their own estimate). Capping it keeps a single optimization
    "small" so users can't launch an enormous sweep. Tunable via
    MAX_OPTIMIZE_TOTAL_RUNS.
    """
    cap = int(getattr(settings, "MAX_OPTIMIZE_TOTAL_RUNS", 300))
    if total_runs > cap:
        raise APIError(
            f"This optimization would run {total_runs} backtests, over the limit of "
            f"{cap}. Reduce the parameters/values (grid) or the population x "
            f"generations so the search stays small.",
            status_code=400,
        )


def get_user_from_request(request):
    auth_header = request.headers.get("Authorization", "")
    token_key = None

    if auth_header.startswith("Token "):
        token_key = auth_header.split(" ", 1)[1].strip()
    elif auth_header.startswith("Bearer "):
        token_key = auth_header.split(" ", 1)[1].strip()

    if not token_key:
        return None

    try:
        token = Token.objects.select_related("user").get(key=token_key)
        return token.user
    except Token.DoesNotExist:
        return None


def token_required(view_func: Callable) -> Callable:
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        user = get_user_from_request(request)
        if not user:
            return json_error("Unauthorized", status=401)
        request.api_user = user
        return view_func(request, *args, **kwargs)

    return wrapped


def get_authenticated_user(request):
    return getattr(request, "api_user", None) or get_user_from_request(request)


def parse_initial_balance(raw_value: Any) -> float:
    if raw_value in ("", None):
        value = DEFAULT_INITIAL_BALANCE
    else:
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            raise APIError("initial_balance must be a number.")

    if value <= 0:
        raise APIError("initial_balance must be greater than zero.")

    max_initial_balance = float(getattr(settings, "MAX_INITIAL_BALANCE", 100000000.0))
    if value > max_initial_balance:
        raise APIError(f"initial_balance exceeds allowed maximum of {int(max_initial_balance)}.")

    return value


def validate_strategy_name(name: Any) -> str:
    parsed = str(name or "").strip()
    if not parsed:
        raise APIError("Strategy name is required.")
    if len(parsed) > MAX_STRATEGY_NAME_LENGTH:
        raise APIError(f"Strategy name must be {MAX_STRATEGY_NAME_LENGTH} characters or fewer.")
    return parsed


def validate_dsl_text(value: Any, field_name: str = "dsl_text") -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise APIError(f"{field_name} must be a string.")
    max_len = int(getattr(settings, "MAX_DSL_TEXT_LENGTH", 50000))
    if len(value) > max_len:
        raise APIError(f"{field_name} exceeds maximum length.")
    return value


INDICATOR_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def validate_indicator_name(name: Any) -> str:
    parsed = str(name or "").strip()
    if not parsed:
        raise APIError("Indicator name is required.")
    if len(parsed) > MAX_INDICATOR_NAME_LENGTH:
        raise APIError(f"Indicator name must be {MAX_INDICATOR_NAME_LENGTH} characters or fewer.")
    if not INDICATOR_NAME_PATTERN.match(parsed):
        raise APIError(
            "Indicator name must start with a letter and contain only letters, digits, and "
            "underscores (e.g. MyMomentum) — it doubles as the name you reference it by in "
            "strategy conditions, like RSI(period=14) or MyMomentum(period=20)."
        )
    if parsed.upper() in {item["name"].upper() for item in _native_indicators()}:
        raise APIError(f"'{parsed}' is a built-in indicator name and can't be used for a custom indicator.")
    return parsed


def validate_indicator_description(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise APIError("description must be a string.")
    if len(value) > MAX_INDICATOR_DESCRIPTION_LENGTH:
        raise APIError("description exceeds maximum length.")
    return value


def validate_indicator_code(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise APIError("code must be a string.")
    if len(value) > MAX_INDICATOR_CODE_LENGTH:
        raise APIError("code exceeds maximum length.")
    return value


def validate_dict_payload(value: Any, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise APIError(f"{field_name} must be a JSON object.")
    return value


def cleanup_jobs(store: CacheJobStore) -> None:
    ttl_seconds = int(getattr(settings, "ASYNC_JOB_TTL_SECONDS", 3600))
    max_entries = int(getattr(settings, "ASYNC_JOB_MAX_ENTRIES", 500))
    now = timezone.now()

    jobs = store.all()
    for job_id, job in list(jobs.items()):
        created_at = job.get("created_at")
        if not created_at or (now - created_at).total_seconds() > ttl_seconds:
            store.pop(job_id)
            jobs.pop(job_id, None)

    if len(jobs) <= max_entries:
        return

    sorted_jobs = sorted(jobs.items(), key=lambda item: item[1].get("created_at", now))
    for job_id, job in sorted_jobs:
        if len(jobs) <= max_entries:
            break
        if job.get("status") in {"completed", "error"}:
            store.pop(job_id)
            jobs.pop(job_id, None)

    if len(jobs) > max_entries:
        for job_id, _ in sorted_jobs:
            if len(jobs) <= max_entries:
                break
            store.pop(job_id)
            jobs.pop(job_id, None)


def ensure_user_can_create_job(store: CacheJobStore, user_id: int) -> None:
    max_per_user = int(getattr(settings, "ASYNC_JOB_MAX_PER_USER", 3))
    active_count = sum(
        1
        for job in store.all().values()
        if job.get("user_id") == user_id and job.get("status") in {"queued", "running"}
    )
    if active_count >= max_per_user:
        raise APIError("Too many active optimization jobs. Please wait for one to finish.", status_code=429)


def serialize_strategy(strategy: Strategy):
    return {
        "id": strategy.id,
        "name": strategy.name,
        "dsl": strategy.dsl_text,
        "dsl_json": strategy.dsl_json,
        "last_result": strategy.last_result,
        "created_at": strategy.created_at.isoformat(),
        "updated_at": strategy.updated_at.isoformat(),
        "last_run_at": strategy.last_run_at.isoformat() if strategy.last_run_at else None,
    }


def serialize_custom_indicator(indicator: CustomIndicator):
    return {
        "id": indicator.id,
        "name": indicator.name,
        "description": indicator.description,
        "parameters": indicator.parameters,
        "code": indicator.code,
        "last_test_result": indicator.last_test_result,
        "created_at": indicator.created_at.isoformat(),
        "updated_at": indicator.updated_at.isoformat(),
    }


def calculate_backtest_metrics(result: Dict[str, Any]):
    trades = result.get("trades") if isinstance(result, dict) else []
    if not isinstance(trades, list):
        trades = []

    equity_curve: List[Dict[str, Any]] = []
    winning_trades = 0
    losing_trades = 0

    # Signed cost basis per ticker. Positive = long position cost (cash spent).
    # Negative = short obligation (cash received but owed back).
    # True portfolio equity = cash_balance + sum(position_cost.values()).
    # This keeps equity flat when a position opens (cash out = position value in)
    # and only moves equity at close events (when P&L is realised).
    position_cost: Dict[str, float] = {}

    # Separate tracker for win/loss: avg entry cost per ticker.
    entry_tracker: Dict[str, Dict[str, float]] = {}

    for trade in trades:
        ttype = trade.get("type")
        ticker = trade.get("ticker")

        try:
            price = float(trade.get("price") or 0)
            shares = float(trade.get("shares") or 0)
            cash = float(trade.get("balance") or 0)
        except (TypeError, ValueError):
            continue

        if ticker and ttype:
            cost = position_cost.get(ticker, 0.0)

            if ttype == "BUY":
                if cost >= -0.001:
                    # Opening a LONG position
                    cost += shares * price
                    pos = entry_tracker.get(ticker, {"shares": 0.0, "cost": 0.0})
                    pos["shares"] += shares
                    pos["cost"] += shares * price
                    entry_tracker[ticker] = pos
                else:
                    # Covering a SHORT position (buying back)
                    pos = entry_tracker.get(ticker, {"shares": 0.0, "cost": 0.0})
                    avg_entry = (pos["cost"] / pos["shares"]) if pos["shares"] else price
                    # For short: profit when buy_price < sell_price (entry)
                    profit = (avg_entry - price) * shares
                    if profit >= 0:
                        winning_trades += 1
                    else:
                        losing_trades += 1
                    cost = 0.0
                    entry_tracker[ticker] = {"shares": 0.0, "cost": 0.0}

            elif ttype == "SELL":
                if cost <= 0.001:
                    # Opening a SHORT position
                    cost -= shares * price
                    pos = entry_tracker.get(ticker, {"shares": 0.0, "cost": 0.0})
                    pos["shares"] += shares
                    pos["cost"] += shares * price
                    entry_tracker[ticker] = pos
                else:
                    # Closing a LONG position
                    pos = entry_tracker.get(ticker, {"shares": 0.0, "cost": 0.0})
                    avg_entry = (pos["cost"] / pos["shares"]) if pos["shares"] else price
                    profit = (price - avg_entry) * shares
                    if profit >= 0:
                        winning_trades += 1
                    else:
                        losing_trades += 1
                    cost = 0.0
                    entry_tracker[ticker] = {"shares": 0.0, "cost": 0.0}

            elif ttype == "Recurring_Entry":
                if cost >= 0:
                    cost += shares * price  # LONG DCA
                else:
                    cost -= shares * price  # SHORT DCA
                pos = entry_tracker.get(ticker, {"shares": 0.0, "cost": 0.0})
                pos["shares"] += shares
                pos["cost"] += shares * price
                entry_tracker[ticker] = pos

            position_cost[ticker] = cost

        # True equity: cash in hand + cost basis of all open positions.
        total_open = sum(position_cost.values())
        equity = cash + total_open

        ts = trade.get("timestamp")
        if ts and equity >= 0:
            equity_curve.append({"timestamp": ts, "equity": round(equity, 4)})

    closed_trades = winning_trades + losing_trades
    win_rate = (winning_trades / closed_trades * 100) if closed_trades else 0.0

    if not equity_curve:
        final_value = result.get("total_portfolio") or result.get("cash") or 0
        equity_curve = [{"timestamp": timezone.now().isoformat(), "equity": final_value}]

    return {
        "equity_curve": equity_curve,
        "winning_trades": winning_trades,
        "losing_trades": losing_trades,
        "trades_count": len(trades),
        "win_rate": win_rate,
    }


def record_backtest_run(user, result: Dict[str, Any], strategy: Strategy | None = None, strategy_name: str = ""):
    if not user:
        return None

    metrics = calculate_backtest_metrics(result or {})
    name = strategy_name or (strategy.name if strategy else "")

    return BacktestRun.objects.create(
        user=user,
        strategy=strategy,
        strategy_name=name,
        pct_change=float(result.get("pct_change") or 0),
        final_balance=float(result.get("total_portfolio") or 0),
        cash=float(result.get("cash") or 0),
        invested=float(result.get("invested") or 0),
        trades_count=metrics["trades_count"],
        winning_trades=metrics["winning_trades"],
        losing_trades=metrics["losing_trades"],
        win_rate=metrics["win_rate"],
        equity_curve=metrics["equity_curve"],
    )


def serialize_backtest_run(run: BacktestRun):
    return {
        "id": run.id,
        "strategy_id": run.strategy_id,
        "strategy_name": run.strategy_name or (run.strategy.name if run.strategy else "Ad-hoc Backtest"),
        "pct_change": run.pct_change,
        "win_rate": run.win_rate,
        "trades": run.trades_count,
        "final_balance": run.final_balance,
        "created_at": run.created_at.isoformat(),
    }


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("assistant")
def strategy_assistant_chat(request):
    user = get_authenticated_user(request)
    payload = parse_body(request)
    messages = normalize_assistant_messages(payload.get("messages"))
    strategy_context = normalize_strategy_context(payload.get("strategy_context"))

    entitlements.consume_quota(user, "ai")
    try:
        response = ask_strategy_assistant(messages, strategy_context)
    except AssistantError as exc:
        entitlements.refund_quota(user, "ai")
        raise APIError(exc.message, status_code=exc.status_code)
    except Exception:
        entitlements.refund_quota(user, "ai")
        raise

    return no_store(JsonResponse(response))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("assistant")
def strategy_assistant_market_data(request):
    payload = parse_body(request)
    markets = payload.get("markets")

    if markets is None:
        strategy_context = normalize_strategy_context(payload.get("strategy_context"))
        markets = strategy_context.get("markets")

    try:
        market_data = prepare_strategy_market_data(markets)
    except AssistantError as exc:
        raise APIError(exc.message, status_code=exc.status_code)

    return no_store(JsonResponse({"market_data": market_data}))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@rate_limit("auth")
def register(request):
    body = parse_body(request)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip()

    if not email or not password:
        raise APIError("Email and password are required.")

    try:
        validate_email(email)
    except ValidationError:
        raise APIError("Please enter a valid email address.")

    if len(name) > 150:
        raise APIError("Name must be 150 characters or fewer.")

    try:
        validate_password(password)
    except ValidationError as exc:
        raise APIError(" ".join(exc.messages))

    if User.objects.filter(email__iexact=email).exists():
        raise APIError("An account with that email already exists.")

    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        first_name=name,
    )
    token, _ = Token.objects.get_or_create(user=user)

    return no_store(JsonResponse({"token": token.key, "user": user_payload(user)}, status=201))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@rate_limit("auth")
def login(request):
    body = parse_body(request)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not email or not password:
        raise APIError("Email and password are required.")

    try:
        validate_email(email)
    except ValidationError:
        raise APIError("Invalid email or password.")

    user = authenticate(username=email, password=password)
    if not user:
        raise APIError("Invalid email or password.")

    # Rotate token on each login to reduce blast radius if a prior token leaked.
    Token.objects.filter(user=user).delete()
    token = Token.objects.create(user=user)

    return no_store(JsonResponse({"token": token.key, "user": user_payload(user)}))


def google_ssl_context():
    if certifi is None:
        return None
    return ssl.create_default_context(cafile=certifi.where())


def verify_google_id_token(id_token: str) -> dict[str, Any]:
    client_id = getattr(settings, "GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise APIError("Google sign-in is not configured on the backend.", status_code=503)

    query = urllib.parse.urlencode({"id_token": id_token})
    request = urllib.request.Request(f"https://oauth2.googleapis.com/tokeninfo?{query}", method="GET")
    ssl_context = google_ssl_context()

    try:
        urlopen_kwargs = {"timeout": 10}
        if ssl_context is not None:
            urlopen_kwargs["context"] = ssl_context
        with urllib.request.urlopen(request, **urlopen_kwargs) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        logger.warning("Google token verification failed with status %s", exc.code)
        raise APIError("Google sign-in token was rejected.")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("Google token verification failed: %s", exc)
        raise APIError("Unable to verify Google sign-in right now.", status_code=502)

    if payload.get("aud") != client_id:
        raise APIError("Google sign-in token is for a different app.")
    if payload.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise APIError("Google sign-in token has an invalid issuer.")
    if payload.get("email_verified") not in {True, "true", "True", "1"}:
        raise APIError("Google account email is not verified.")
    if not payload.get("email"):
        raise APIError("Google sign-in did not return an email address.")

    return payload


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@rate_limit("auth")
def google_login(request):
    body = parse_body(request)
    id_token = (body.get("id_token") or "").strip()
    if not id_token:
        raise APIError("Google sign-in token is required.")

    payload = verify_google_id_token(id_token)
    email = str(payload["email"]).strip().lower()
    name = str(payload.get("name") or payload.get("given_name") or "").strip()

    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        user = User.objects.create_user(username=email, email=email, password=None, first_name=name[:150])
    else:
        update_fields = []
        if name and not user.first_name:
            user.first_name = name[:150]
            update_fields.append("first_name")
        if user.username != email:
            user.username = email
            update_fields.append("username")
        if update_fields:
            user.save(update_fields=update_fields)

    Token.objects.filter(user=user).delete()
    token = Token.objects.create(user=user)
    return no_store(JsonResponse({"token": token.key, "user": user_payload(user)}))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("auth")
def logout(request):
    user = get_authenticated_user(request)
    Token.objects.filter(user=user).delete()
    return no_store(JsonResponse({"success": True}))


@csrf_exempt
@api_error_boundary
@require_methods("GET", "PATCH")
@token_required
@rate_limit("general")
def me(request):
    user = get_authenticated_user(request)
    if request.method == "PATCH":
        body = parse_body(request)
        name = str(body.get("name", "")).strip()[:100]
        if not name:
            raise APIError("Name cannot be empty.")
        user.first_name = name
        user.save(update_fields=["first_name"])
    payload = user_payload(user)
    payload["plan"] = entitlements.plan_summary(user)
    return no_store(JsonResponse(payload))


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("general")
def plan_view(request):
    """The signed-in user's plan, limits, and month-to-date usage."""
    user = get_authenticated_user(request)
    return no_store(JsonResponse(entitlements.plan_summary(user)))


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@rate_limit("general")
def plans_public(request):
    """The full pricing table for the Plans page (no auth required)."""
    return JsonResponse({"plans": entitlements.all_plans_public()})


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("general")
def switch_plan(request):
    """Change a user's plan.

    PLAN_SELF_SERVICE (default: DEBUG) controls whether a user may change their
    OWN plan without paying. It is OFF in production so nobody can self-upgrade
    to Pro for free before billing exists — a non-staff self-switch then 403s.
    Turn it on only once Stripe gates the upgrade. Staff can always switch.
    Targeting another user by email stays staff-only.
    Body: {"plan": "free|plus|pro", "email": "<optional target user>"}.
    """
    actor = get_authenticated_user(request)
    body = parse_body(request)
    raw_plan = str(body.get("plan") or "").strip().lower()
    if raw_plan not in PLANS:
        raise APIError("Invalid plan. Choose free, plus, or pro.")

    target = actor
    email = str(body.get("email") or "").strip()
    if email:
        User = get_user_model()
        candidate = User.objects.filter(email__iexact=email).first()
        if not candidate:
            raise APIError("No user with that email.", status_code=404)
        if candidate.id != actor.id and not getattr(actor, "is_staff", False):
            raise APIError("Only staff can change another user's plan.", status_code=403)
        target = candidate

    self_service = bool(getattr(settings, "PLAN_SELF_SERVICE", False))
    if target.id == actor.id and not self_service and not getattr(actor, "is_staff", False):
        raise APIError("Plan changes are handled through checkout.", status_code=403)

    profile = entitlements.get_profile(target)
    profile.plan = raw_plan
    profile.save(update_fields=["plan", "updated_at"])
    return no_store(JsonResponse({
        "email": target.email,
        "plan": profile.plan,
        "summary": entitlements.plan_summary(target),
    }))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("auth")
def delete_account(request):
    user = get_authenticated_user(request)
    body = parse_body(request)
    password = body.get("password") or ""

    if user.has_usable_password():
        if not password:
            raise APIError("Password is required to delete your account.")
        if not user.check_password(password):
            raise APIError("Incorrect password.")
    else:
        # Google-SSO accounts have no password to check — confirm by having the
        # user type their account email instead (the request is already
        # token-authenticated; this guards against accidental clicks).
        confirm_email = str(body.get("confirm_email") or "").strip().lower()
        if not confirm_email:
            raise APIError("Type your account email to confirm deletion.")
        if confirm_email != (user.email or "").strip().lower():
            raise APIError("The email you typed doesn't match your account email.")

    # Delete the user — CASCADE removes all related data (strategies, backtest
    # runs, custom indicators, paper accounts, password reset tokens, etc.)
    user.delete()
    return no_store(JsonResponse({"message": "Account deleted."}))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("auth")
def change_password(request):
    from .models import PasswordResetToken as _PRT  # noqa — local import avoids circular at module level
    from django.core.mail import send_mail as _send  # noqa
    body = parse_body(request)
    user = get_authenticated_user(request)
    current = body.get("current_password") or ""
    new_pass = body.get("new_password") or ""

    if not new_pass:
        raise APIError("new_password is required.")

    if user.has_usable_password():
        if not current:
            raise APIError("Both current_password and new_password are required.")
        if not user.check_password(current):
            raise APIError("Current password is incorrect.")
    # else: Google-SSO account with no password yet — this call SETS a first
    # password (the request is already token-authenticated), which also enables
    # email+password login and password-confirmed deletion for the account.

    try:
        validate_password(new_pass, user=user)
    except ValidationError as exc:
        raise APIError(" ".join(exc.messages))

    user.set_password(new_pass)
    user.save()
    # Rotate token so existing sessions are invalidated on other devices.
    Token.objects.filter(user=user).delete()
    new_token = Token.objects.create(user=user)
    return no_store(JsonResponse({"token": new_token.key, "message": "Password changed successfully."}))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@rate_limit("auth")
def forgot_password(request):
    from django.core.mail import send_mail as _send_mail
    from .models import PasswordResetToken

    body = parse_body(request)
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise APIError("Email is required.")

    # Always respond the same way — prevents user-enumeration attacks.
    _SAFE_RESPONSE = no_store(JsonResponse({"message": "If that email exists, a reset link has been sent."}))

    try:
        validate_email(email)
    except ValidationError:
        return _SAFE_RESPONSE

    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return _SAFE_RESPONSE

    # Expire any outstanding tokens for this user.
    PasswordResetToken.objects.filter(user=user, used=False).update(used=True)
    reset_token = PasswordResetToken.objects.create(user=user)

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
    reset_url = f"{frontend_url}/reset-password?token={reset_token.token}"
    name = user.first_name or "there"

    try:
        _send_mail(
            subject="Reset your Orca password",
            message=(
                f"Hi {name},\n\n"
                f"Click the link below to reset your password. This link expires in 1 hour.\n\n"
                f"{reset_url}\n\n"
                f"If you didn't request this, you can safely ignore this email."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send password reset email to %s", email)
        # Still return the safe response — don't leak backend errors to the client.

    return _SAFE_RESPONSE


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@rate_limit("auth")
def reset_password(request):
    from .models import PasswordResetToken

    body = parse_body(request)
    token_str = (body.get("token") or "").strip()
    new_pass = body.get("new_password") or ""

    if not token_str or not new_pass:
        raise APIError("token and new_password are required.")

    try:
        token_uuid = uuid.UUID(token_str)
    except ValueError:
        raise APIError("Invalid reset token.", status_code=400)

    try:
        reset_token = PasswordResetToken.objects.select_related("user").get(token=token_uuid)
    except PasswordResetToken.DoesNotExist:
        raise APIError("Invalid or expired reset link.", status_code=400)

    if not reset_token.is_valid():
        raise APIError("This reset link has expired. Please request a new one.", status_code=400)

    user = reset_token.user
    try:
        validate_password(new_pass, user=user)
    except ValidationError as exc:
        raise APIError(" ".join(exc.messages))

    user.set_password(new_pass)
    user.save()
    reset_token.used = True
    reset_token.save(update_fields=["used"])

    return no_store(JsonResponse({"message": "Password reset successfully. You can now sign in."}))


@csrf_exempt
@api_error_boundary
@require_methods("GET", "POST")
@token_required
@rate_limit("general")
def strategies(request):
    user = get_authenticated_user(request)

    if request.method == "GET":
        strategies_qs = Strategy.objects.filter(user=user).order_by("-updated_at")
        return JsonResponse({"strategies": [serialize_strategy(s) for s in strategies_qs]})

    body = parse_body(request)
    name = validate_strategy_name(body.get("name"))
    dsl_text = validate_dsl_text(body.get("dsl") or "", field_name="dsl")
    dsl_json = body.get("dsl_json")
    last_result = body.get("last_result")

    if dsl_json is not None and not isinstance(dsl_json, dict):
        raise APIError("dsl_json must be a JSON object when provided.")
    if last_result is not None and not isinstance(last_result, dict):
        raise APIError("last_result must be a JSON object when provided.")

    if Strategy.objects.filter(user=user, name__iexact=name).exists():
        raise APIError("Strategy name already exists for this user.")

    entitlements.enforce_count_cap(user, "strategies", Strategy.objects.filter(user=user).count())

    strategy = Strategy.objects.create(
        user=user,
        name=name,
        dsl_text=dsl_text,
        dsl_json=dsl_json,
        last_result=last_result,
        last_run_at=timezone.now() if last_result else None,
    )

    return JsonResponse({"strategy": serialize_strategy(strategy)}, status=201)


@csrf_exempt
@api_error_boundary
@require_methods("GET", "PUT", "PATCH", "DELETE")
@token_required
@rate_limit("general")
def strategy_detail(request, strategy_id: int):
    user = get_authenticated_user(request)

    try:
        strategy = Strategy.objects.get(id=strategy_id, user=user)
    except Strategy.DoesNotExist:
        return JsonResponse({"error": "Strategy not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({"strategy": serialize_strategy(strategy)})

    if request.method in ("PUT", "PATCH"):
        body = parse_body(request)
        name = body.get("name")
        dsl_text = body.get("dsl")
        dsl_json = body.get("dsl_json") if "dsl_json" in body else None
        last_result = body.get("last_result") if "last_result" in body else None

        if name is not None:
            parsed_name = validate_strategy_name(name)
            if Strategy.objects.filter(user=user, name__iexact=parsed_name).exclude(id=strategy.id).exists():
                raise APIError("Strategy name already exists for this user.")
            strategy.name = parsed_name
        if dsl_text is not None:
            strategy.dsl_text = validate_dsl_text(dsl_text, field_name="dsl")
        if "dsl_json" in body:
            if dsl_json is not None and not isinstance(dsl_json, dict):
                raise APIError("dsl_json must be a JSON object when provided.")
            strategy.dsl_json = dsl_json
        if "last_result" in body:
            if last_result is not None and not isinstance(last_result, dict):
                raise APIError("last_result must be a JSON object when provided.")
            strategy.last_result = last_result
            strategy.last_run_at = timezone.now() if last_result else None

        strategy.save()
        return JsonResponse({"strategy": serialize_strategy(strategy)})

    if request.method == "DELETE":
        strategy.delete()
        return JsonResponse({"success": True})

    return json_error("Method not allowed.", status=405)


def _native_indicators() -> list[dict[str, Any]]:
    """Native indicators, read-only: registry config merged with assistant knowledge."""
    base = Path(settings.BASE_DIR) / "core" / "registries"
    try:
        with open(base / "indicatorRegistry.json", encoding="utf-8") as f:
            registry_data = json.load(f)
    except (OSError, json.JSONDecodeError):
        registry_data = {}

    indicators = registry_data.get("INDICATORS") if isinstance(registry_data, dict) else None
    if not isinstance(indicators, dict):
        return []

    native: list[dict[str, Any]] = []
    for name, config in indicators.items():
        if not isinstance(config, dict):
            continue
        knowledge = INDICATOR_KNOWLEDGE.get(name, {})
        native.append(
            {
                "name": name,
                "function": config.get("function", ""),
                "args": config.get("args", []),
                "defaults": config.get("defaults", {}),
                "supports_timeframe": bool(config.get("supports_timeframe", False)),
                "family": knowledge.get("family", ""),
                "typical_use": knowledge.get("typical_use", ""),
                "watchout": knowledge.get("watchout", ""),
            }
        )
    return native


def build_custom_indicator_runtime(user) -> dict[str, dict[str, Any]]:
    """Compile a user's saved custom indicators into the runtime shape `core.main.main`
    expects: {name: {"calculate": fn, "args": [...], "defaults": {...}}}, keyed by the
    exact (case-sensitive) name they're referenced by in DSL conditions."""
    runtime: dict[str, dict[str, Any]] = {}
    for indicator in CustomIndicator.objects.filter(user=user):
        try:
            calculate = compile_indicator(indicator.code)
        except IndicatorValidationError:
            continue  # defensive — saved rows are already gate-passed at save time
        runtime[indicator.name] = {
            "calculate": calculate,
            "args": [param["name"] for param in indicator.parameters],
            "defaults": {param["name"]: param["default"] for param in indicator.parameters},
        }
    return runtime


def _validate_indicator_parameters(parameters: Any) -> list[dict[str, Any]]:
    try:
        return validate_parameters(parameters)
    except IndicatorValidationError as exc:
        raise APIError(str(exc))


@csrf_exempt
@api_error_boundary
@require_methods("GET", "POST")
@token_required
@rate_limit("general")
def custom_indicators(request):
    user = get_authenticated_user(request)

    if request.method == "GET":
        custom_qs = CustomIndicator.objects.filter(user=user).order_by("-updated_at")
        return JsonResponse(
            {
                "native": _native_indicators(),
                "custom": [serialize_custom_indicator(indicator) for indicator in custom_qs],
            }
        )

    body = parse_body(request)
    name = validate_indicator_name(body.get("name"))
    description = validate_indicator_description(body.get("description"))
    code = validate_indicator_code(body.get("code"))
    parameters = _validate_indicator_parameters(body.get("parameters"))

    if CustomIndicator.objects.filter(user=user, name__iexact=name).exists():
        raise APIError("An indicator with that name already exists.")

    entitlements.enforce_count_cap(user, "custom_indicators", CustomIndicator.objects.filter(user=user).count())

    test_result = run_indicator_test(code, parameters)
    if not test_result.get("passed"):
        return JsonResponse(
            {"error": "Indicator failed the compiler/tester gate.", "test_result": test_result},
            status=422,
        )

    indicator = CustomIndicator.objects.create(
        user=user,
        name=name,
        description=description,
        parameters=parameters,
        code=code,
        last_test_result=test_result,
    )
    return JsonResponse({"indicator": serialize_custom_indicator(indicator)}, status=201)


@csrf_exempt
@api_error_boundary
@require_methods("GET", "PUT", "PATCH", "DELETE")
@token_required
@rate_limit("general")
def custom_indicator_detail(request, indicator_id: int):
    user = get_authenticated_user(request)

    try:
        indicator = CustomIndicator.objects.get(id=indicator_id, user=user)
    except CustomIndicator.DoesNotExist:
        return JsonResponse({"error": "Custom indicator not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({"indicator": serialize_custom_indicator(indicator)})

    if request.method in ("PUT", "PATCH"):
        body = parse_body(request)

        next_name = indicator.name
        if body.get("name") is not None:
            next_name = validate_indicator_name(body.get("name"))
            if (
                CustomIndicator.objects.filter(user=user, name__iexact=next_name)
                .exclude(id=indicator.id)
                .exists()
            ):
                raise APIError("An indicator with that name already exists.")

        next_description = (
            validate_indicator_description(body.get("description"))
            if body.get("description") is not None
            else indicator.description
        )
        next_code = (
            validate_indicator_code(body.get("code")) if body.get("code") is not None else indicator.code
        )
        next_parameters = (
            _validate_indicator_parameters(body.get("parameters"))
            if "parameters" in body
            else indicator.parameters
        )

        gate_inputs_changed = next_code != indicator.code or next_parameters != indicator.parameters
        last_test_result = indicator.last_test_result
        if gate_inputs_changed:
            test_result = run_indicator_test(next_code, next_parameters)
            if not test_result.get("passed"):
                return JsonResponse(
                    {"error": "Indicator failed the compiler/tester gate.", "test_result": test_result},
                    status=422,
                )
            last_test_result = test_result

        indicator.name = next_name
        indicator.description = next_description
        indicator.code = next_code
        indicator.parameters = next_parameters
        indicator.last_test_result = last_test_result
        indicator.save()
        return JsonResponse({"indicator": serialize_custom_indicator(indicator)})

    if request.method == "DELETE":
        indicator.delete()
        return JsonResponse({"success": True})

    return json_error("Method not allowed.", status=405)


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("compute")
def custom_indicator_test(request):
    get_authenticated_user(request)
    body = parse_body(request)
    code = validate_indicator_code(body.get("code"))
    parameters = _validate_indicator_parameters(body.get("parameters"))

    test_result = run_indicator_test(code, parameters)
    return no_store(JsonResponse({"test_result": test_result}))


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("general")
def custom_indicator_guide(request):
    path = Path(__file__).resolve().parent / "docs" / "custom_indicator_guide.md"
    try:
        markdown = path.read_text(encoding="utf-8")
    except OSError:
        markdown = ""
    return no_store(JsonResponse({"markdown": markdown}))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("assistant")
def indicator_assistant_chat(request):
    user = get_authenticated_user(request)
    payload = parse_body(request)
    messages = normalize_assistant_messages(payload.get("messages"))
    indicator_context = normalize_indicator_context(payload.get("indicator_context"))
    mode = "agent" if str(payload.get("mode", "ask")).strip().lower() == "agent" else "ask"

    entitlements.consume_quota(user, "ai")
    try:
        response = ask_indicator_assistant(messages, indicator_context, mode=mode)
    except AssistantError as exc:
        entitlements.refund_quota(user, "ai")
        raise APIError(exc.message, status_code=exc.status_code)
    except Exception:
        entitlements.refund_quota(user, "ai")
        raise

    return no_store(JsonResponse(response))


# Caps shared by every endpoint that executes a backtest (JSON, text, and the
# strategy-to-DSL convenience path) — one strategy can't fan out into unbounded
# market-data fetches.
MAX_TICKERS_PER_BACKTEST = 5
MAX_SIGNAL_TICKERS_PER_BACKTEST = 3


def validate_backtest_dsl_guards(dsl: dict) -> JsonResponse | None:
    """Cheap pre-execution validation shared by all backtest entrypoints.

    Returns a 400 JsonResponse describing the problem, or None if the DSL
    passes. Runs BEFORE any quota is consumed so a rejected request never
    burns a backtest.
    """
    if not isinstance(dsl, dict) or not ("LONG" in dsl or "SHORT" in dsl):
        return JsonResponse({
            "error": "Strategy must contain a LONG or SHORT block.",
            "code": "invalid_dsl",
            "success": False,
        }, status=400)

    # Guard: risk-based position sizing requires a stop loss
    _direction = "LONG" if "LONG" in dsl else "SHORT"
    _open_args = dsl.get(_direction, {}).get("OPEN", {}).get("ARGUMENTS", {})
    if not isinstance(_open_args, dict):
        _open_args = {}
    _invest_type = _open_args.get("initialOpenPositionInvestType", "")
    if _invest_type in ("riskFixedAmount", "riskPercentBalance"):
        _sl = _open_args.get("stopLossPercent")
        try:
            _sl_num = float(_sl) if _sl is not None else 0.0
        except (TypeError, ValueError):
            _sl_num = 0.0
        if _sl_num <= 0:
            return JsonResponse({
                "error": "Risk-based position sizing requires a stop loss. Set Stop Loss % > 0 in the Risk Management section.",
                "code": "missing_stop_loss",
                "success": False,
            }, status=400)

    # Guard: fees and risk percentages must not be negative. The engine also
    # clamps these defensively, but rejecting here tells API users what was
    # wrong instead of silently ignoring the value.
    for _field in ("fee_value", "fee_fixed", "spread", "stopLossPercent", "takeProfitPercent"):
        _raw = _open_args.get(_field)
        if _raw is None:
            continue
        try:
            _num = float(_raw)
        except (TypeError, ValueError):
            return JsonResponse({
                "error": f"{_field} must be a number.",
                "code": "invalid_argument",
                "success": False,
            }, status=400)
        if _num < 0:
            return JsonResponse({
                "error": f"{_field} cannot be negative.",
                "code": "invalid_argument",
                "success": False,
            }, status=400)

    # Guard: cap tickers per request to prevent excessive data fetching
    _tickers = _extract_tickers(dsl)
    if len(_tickers) > MAX_TICKERS_PER_BACKTEST:
        return JsonResponse({
            "error": f"Too many tickers. Maximum {MAX_TICKERS_PER_BACKTEST} tickers per backtest.",
            "code": "too_many_tickers",
            "success": False,
        }, status=400)
    _signal_tickers = _extract_signal_tickers(dsl)
    if len(_signal_tickers) > MAX_SIGNAL_TICKERS_PER_BACKTEST:
        return JsonResponse({
            "error": f"Too many watch-only tickers. Maximum {MAX_SIGNAL_TICKERS_PER_BACKTEST} per backtest.",
            "code": "too_many_tickers",
            "success": False,
        }, status=400)

    return None


def execute_dsl_backtest(user, dsl: dict, initial_balance: float, custom_indicators: dict):
    """Reserve one backtest of quota, run the engine, and map failures to
    friendly 400/500 responses (refunding the quota on any failure).

    Returns (result, None) on success or (None, JsonResponse) on failure.
    Raises PlanLimitError (rendered as a 402) if the monthly quota is spent.
    """
    entitlements.consume_quota(user, "backtest")
    try:
        result = dslJSONBacktest(dsl, initial_balance=initial_balance, custom_indicators=custom_indicators)
    except BacktestError as e:
        entitlements.refund_quota(user, "backtest")
        return None, JsonResponse({
            "error": e.message,
            "code": e.code,
            "success": False,
        }, status=400)
    except ValueError as e:
        # DSL validation errors
        entitlements.refund_quota(user, "backtest")
        return None, JsonResponse({
            "error": str(e),
            "code": "validation_error",
            "success": False,
        }, status=400)
    except Exception:
        entitlements.refund_quota(user, "backtest")
        logger.exception("Unexpected backtest error")
        return None, JsonResponse({
            "error": "An unexpected error occurred. Please try again.",
            "code": "unexpected_error",
            "success": False,
        }, status=500)
    return result, None


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("backtest")
@rate_limit("backtest_daily")
def backtestDSLText(request):
    user = get_authenticated_user(request)
    body = parse_body(request)
    dsl = validate_dsl_text(body.get("dsl_text", ""), field_name="dsl_text")
    initial_balance = parse_initial_balance(body.get("initial_balance", DEFAULT_INITIAL_BALANCE))
    custom_indicators = build_custom_indicator_runtime(user)

    strategy = None
    strategy_label = str(body.get("strategy_name") or body.get("label") or "").strip()[:MAX_STRATEGY_NAME_LENGTH]
    strategy_id = body.get("strategy_id")
    if strategy_id is not None:
        try:
            strategy_id = int(strategy_id)
        except (TypeError, ValueError):
            raise APIError("strategy_id must be an integer.")
        strategy = Strategy.objects.filter(id=strategy_id, user=user).first()

    # Parse the DSL text up front so the same guards and error mapping the JSON
    # endpoint uses apply here too (previously a bad ticker/date range surfaced
    # as a generic 500 on this path).
    try:
        dsl_json = parse_dsl_text(dsl)
    except Exception as e:
        return JsonResponse({
            "error": f"Could not parse the strategy DSL: {e}",
            "code": "dsl_parse_error",
            "success": False,
        }, status=400)

    guard_error = validate_backtest_dsl_guards(dsl_json)
    if guard_error is not None:
        return guard_error

    result, error_response_ = execute_dsl_backtest(user, dsl_json, initial_balance, custom_indicators)
    if error_response_ is not None:
        return error_response_

    result["ticker_names"] = resolve_ticker_names(list(result.get("data", {}).keys()))
    record_backtest_run(user, result, strategy=strategy, strategy_name=strategy_label)
    if strategy:
        strategy.last_result = result
        strategy.dsl_text = dsl or strategy.dsl_text
        strategy.last_run_at = timezone.now()
        strategy.save(update_fields=["last_result", "dsl_text", "last_run_at", "updated_at"])
    return JsonResponse(result, safe=False)


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("backtest")
@rate_limit("backtest_daily")
def backtestDSLJSON(request):
    user = get_authenticated_user(request)
    body = parse_body(request)
    dsl = validate_dict_payload(body.get("dsl_json", {}), "dsl_json")
    initial_balance = parse_initial_balance(body.get("initial_balance", DEFAULT_INITIAL_BALANCE))
    custom_indicators = build_custom_indicator_runtime(user)

    strategy = None
    strategy_label = str(body.get("strategy_name") or body.get("label") or "").strip()[:MAX_STRATEGY_NAME_LENGTH]
    strategy_id = body.get("strategy_id")
    if strategy_id is not None:
        try:
            strategy_id = int(strategy_id)
        except (TypeError, ValueError):
            raise APIError("strategy_id must be an integer.")
        strategy = Strategy.objects.filter(id=strategy_id, user=user).first()

    guard_error = validate_backtest_dsl_guards(dsl)
    if guard_error is not None:
        return guard_error

    # Quota is reserved only after every cheap validation guard has passed
    # (inside execute_dsl_backtest), so a rejected request never burns a
    # backtest; failures refund it.
    result, error_response_ = execute_dsl_backtest(user, dsl, initial_balance, custom_indicators)
    if error_response_ is not None:
        return error_response_

    result["ticker_names"] = resolve_ticker_names(list(result.get("data", {}).keys()))
    record_backtest_run(user, result, strategy=strategy, strategy_name=strategy_label)

    if strategy:
        strategy.last_result = result
        strategy.dsl_json = dsl or strategy.dsl_json
        strategy.last_run_at = timezone.now()
        strategy.save(update_fields=["last_result", "dsl_json", "last_run_at", "updated_at"])

    return JsonResponse(result, safe=False)


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("compute")
@rate_limit("optimize_daily")
def dslParameterOptimiser(request):
    user = get_authenticated_user(request)
    body = parse_body(request)
    dsl = validate_dict_payload(body.get("dsl_json", {}), "dsl_json")
    parameter_choice = validate_dict_payload(body.get("parameter_choice", {}), "parameter_choice")
    initial_balance = parse_initial_balance(body.get("initial_balance", DEFAULT_INITIAL_BALANCE))
    async_mode = bool(body.get("async", False))

    # Size the grid up front and cap it (applies to both sync and async paths).
    param_grid, _ = build_param_grid(dsl, parameter_choice)
    if not param_grid:
        raise APIError("No parameters selected for optimization")
    total_runs = 1
    for vals in param_grid.values():
        total_runs *= len(vals)
    entitlements.enforce_optimizer_method(user, "grid")
    entitlements.enforce_optimize_intensity(user, total_runs)

    if async_mode:
        # Check the job slot BEFORE reserving quota so a 429 here doesn't
        # silently burn one of the user's monthly optimizations.
        cleanup_jobs(optimizer_jobs)
        ensure_user_can_create_job(optimizer_jobs, user.id)
        entitlements.consume_quota(user, "optimize")

        job_id = run_async_job(
            optimizer_jobs,
            user.id,
            total_runs,
            lambda hook: optimizer(
                parsed_dsl=dsl,
                param_choices=parameter_choice,
                initial_balance=initial_balance,
                progress_hook=hook,
                param_grid_override=param_grid,
            ),
            on_error=lambda: entitlements.refund_quota(user, "optimize"),
        )
        return JsonResponse({"job_id": job_id, "total_runs": total_runs})

    entitlements.consume_quota(user, "optimize")
    try:
        result = optimizer(parsed_dsl=dsl, param_choices=parameter_choice, initial_balance=initial_balance)
    except Exception:
        entitlements.refund_quota(user, "optimize")
        raise
    return JsonResponse(result, safe=False)


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("status")
def dslParameterOptimiserStatus(request, job_id):
    user = get_authenticated_user(request)
    cleanup_jobs(optimizer_jobs)
    job = optimizer_jobs.get(job_id)
    if not job or job.get("user_id") != user.id:
        return JsonResponse({"error": "Job not found"}, status=404)

    completed = job.get("completed_runs", 0)
    total = job.get("total_runs", 0)
    progress = (completed / total * 100) if total else 0

    response = {
        "status": job["status"],
        "completed_runs": completed,
        "total_runs": total,
        "progress": min(100, max(0, progress)),
    }
    if job["status"] == "completed":
        response["result"] = job.get("result")
    if job["status"] == "error":
        response["error"] = job.get("error")

    return JsonResponse(response, safe=False)


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("compute")
@rate_limit("optimize_daily")
def dslGeneticOptimiser(request):
    user = get_authenticated_user(request)
    body = parse_body(request)
    dsl = validate_dict_payload(body.get("dsl_json", {}), "dsl_json")
    parameter_choice = validate_dict_payload(body.get("parameter_choice", {}), "parameter_choice")
    initial_balance = parse_initial_balance(body.get("initial_balance", DEFAULT_INITIAL_BALANCE))
    ga_settings = body.get("ga_settings", {})
    async_mode = bool(body.get("async", False))

    if ga_settings and not isinstance(ga_settings, dict):
        raise APIError("ga_settings must be a JSON object when provided.")

    # Size the search (population x generations) up front and cap it.
    try:
        population = int(ga_settings.get("population", 10))
        generations = int(ga_settings.get("generations", 10))
    except (TypeError, ValueError):
        raise APIError("ga_settings population and generations must be integers.")
    total_runs = max(1, population) * max(1, generations)
    entitlements.enforce_optimizer_method(user, "genetic")
    entitlements.enforce_optimize_intensity(user, total_runs)

    if async_mode:
        # Job-slot + parameter checks BEFORE reserving quota so a rejected
        # request doesn't burn one of the user's monthly optimizations.
        cleanup_jobs(genetic_jobs)
        ensure_user_can_create_job(genetic_jobs, user.id)

        param_values, _ = build_param_values(dsl, parameter_choice)
        if not param_values:
            raise APIError("No parameters selected for optimization")

        entitlements.consume_quota(user, "optimize")
        job_id = run_async_job(
            genetic_jobs,
            user.id,
            total_runs,
            lambda hook: genetic_optimizer(
                parsed_dsl=dsl,
                param_choices=parameter_choice,
                initial_balance=initial_balance,
                ga_settings=ga_settings,
                progress_hook=hook,
            ),
            on_error=lambda: entitlements.refund_quota(user, "optimize"),
        )
        return JsonResponse({"job_id": job_id, "total_runs": total_runs})

    entitlements.consume_quota(user, "optimize")
    try:
        result = genetic_optimizer(
            parsed_dsl=dsl,
            param_choices=parameter_choice,
            initial_balance=initial_balance,
            ga_settings=ga_settings,
        )
    except Exception:
        entitlements.refund_quota(user, "optimize")
        raise
    return JsonResponse(result, safe=False)

def get_user_constraints(user):
    """
    Returns allowed tickers and timeframes for this user.
    Extend this as you add plan tiers.
    """
    return {
        "allowed_tickers": None,    # None = all tickers
        "allowed_timeframes": None  # None = all timeframes
    }


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("status")
def dslGeneticOptimiserStatus(request, job_id):
    user = get_authenticated_user(request)
    cleanup_jobs(genetic_jobs)
    job = genetic_jobs.get(job_id)
    if not job or job.get("user_id") != user.id:
        return JsonResponse({"error": "Job not found"}, status=404)

    completed = job.get("completed_runs", 0)
    total = job.get("total_runs", 0)
    progress = (completed / total * 100) if total else 0

    response = {
        "status": job["status"],
        "completed_runs": completed,
        "total_runs": total,
        "progress": min(100, max(0, progress)),
    }
    if job["status"] == "completed":
        response["result"] = job.get("result")
    if job["status"] == "error":
        response["error"] = job.get("error")

    return JsonResponse(response, safe=False)


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("compute")
@rate_limit("optimize_daily")
def dslOptimiser(request):
    """Generic entrypoint for the metaheuristic optimizers (random search,
    particle swarm, simulated annealing, differential evolution). Dispatches on
    `method`; otherwise mirrors the grid/genetic endpoints (sync or async job)."""
    user = get_authenticated_user(request)
    body = parse_body(request)

    method = str(body.get("method", "")).strip().lower()
    runner = METAHEURISTIC_OPTIMISERS.get(method)
    if runner is None:
        valid = ", ".join(sorted(METAHEURISTIC_OPTIMISERS))
        raise APIError(f"Unknown optimiser method '{method}'. Expected one of: {valid}.")

    dsl = validate_dict_payload(body.get("dsl_json", {}), "dsl_json")
    parameter_choice = validate_dict_payload(body.get("parameter_choice", {}), "parameter_choice")
    initial_balance = parse_initial_balance(body.get("initial_balance", DEFAULT_INITIAL_BALANCE))
    opt_settings = body.get("settings", {})
    if opt_settings and not isinstance(opt_settings, dict):
        raise APIError("settings must be a JSON object when provided.")
    async_mode = bool(body.get("async", False))

    # Size the search up front and cap it (applies to both sync and async paths).
    total_runs = estimate_total_runs(method, opt_settings)
    entitlements.enforce_optimizer_method(user, "meta")
    entitlements.enforce_optimize_intensity(user, total_runs)

    if async_mode:
        # Job-slot check BEFORE reserving quota so a 429 here doesn't burn one
        # of the user's monthly optimizations.
        cleanup_jobs(optimiser_jobs)
        ensure_user_can_create_job(optimiser_jobs, user.id)
        entitlements.consume_quota(user, "optimize")

        job_id = run_async_job(
            optimiser_jobs,
            user.id,
            total_runs,
            lambda hook: runner(
                parsed_dsl=dsl,
                param_choices=parameter_choice,
                initial_balance=initial_balance,
                settings=opt_settings,
                progress_hook=hook,
            ),
            on_error=lambda: entitlements.refund_quota(user, "optimize"),
        )
        return JsonResponse({"job_id": job_id, "total_runs": total_runs})

    entitlements.consume_quota(user, "optimize")
    try:
        result = runner(
            parsed_dsl=dsl,
            param_choices=parameter_choice,
            initial_balance=initial_balance,
            settings=opt_settings,
        )
    except Exception:
        entitlements.refund_quota(user, "optimize")
        raise
    return JsonResponse(result, safe=False)


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("status")
def dslOptimiserStatus(request, job_id):
    user = get_authenticated_user(request)
    cleanup_jobs(optimiser_jobs)
    job = optimiser_jobs.get(job_id)
    if not job or job.get("user_id") != user.id:
        return JsonResponse({"error": "Job not found"}, status=404)

    completed = job.get("completed_runs", 0)
    total = job.get("total_runs", 0)
    progress = (completed / total * 100) if total else 0

    response = {
        "status": job["status"],
        "completed_runs": completed,
        "total_runs": total,
        "progress": min(100, max(0, progress)),
    }
    if job["status"] == "completed":
        response["result"] = job.get("result")
    if job["status"] == "error":
        response["error"] = job.get("error")

    return JsonResponse(response, safe=False)


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("assistant")
def strategy_to_dsl(request):
    user = get_authenticated_user(request)

    body = parse_body(request)
    message = (body.get("message") or "").strip()

    if not message:
        raise APIError("message is required")

    entitlements.consume_quota(user, "ai")

    # 1. Call LLM parser
    try:
        result = parse_strategy(message)
    except LLMUnavailableError as e:
        entitlements.refund_quota(user, "ai")
        logger.warning(f"LLM unavailable for strategy_to_dsl: {e}")
        return JsonResponse({"success": False, "error": LLM_UNAVAILABLE_MESSAGE}, status=503)
    except Exception:
        entitlements.refund_quota(user, "ai")
        raise

    # 2. Handle failure from model
    if isinstance(result, dict) and "error" in result:
        entitlements.refund_quota(user, "ai")
        return JsonResponse({
            "success": False,
            "error": result["error"],
            "issues": result.get("issues", []),
            "raw_model_output": result.get("raw_output", "")
        }, status=400)

    # 3. Optional: immediately run backtest if requested. This goes through the
    # same guards + metered quota as the dedicated backtest endpoints (it used
    # to bypass both, letting the "backtest" quota be dodged via this route),
    # and includes the user's custom indicators so parity holds.
    run_backtest = body.get("run_backtest", False)

    backtest_result = None
    if run_backtest:
        guard_error = validate_backtest_dsl_guards(result)
        if guard_error is not None:
            guard_payload = json.loads(guard_error.content.decode("utf-8"))
            backtest_result = {"error": guard_payload.get("error"), "code": guard_payload.get("code")}
        else:
            try:
                backtest_result, error_response_ = execute_dsl_backtest(
                    user,
                    result,
                    parse_initial_balance(body.get("initial_balance", 10000)),
                    build_custom_indicator_runtime(user),
                )
                if error_response_ is not None:
                    error_payload = json.loads(error_response_.content.decode("utf-8"))
                    backtest_result = {"error": error_payload.get("error"), "code": error_payload.get("code")}
                else:
                    record_backtest_run(user, backtest_result, strategy_name="Generated Strategy")
            except PlanLimitError as e:
                # Parse succeeded but the monthly backtest quota is spent —
                # return the strategy anyway, with the limit noted.
                backtest_result = e.to_dict()

    return JsonResponse({
        "success": True,
        "strategy_name": "Generated Strategy",
        "dsl_json": result,
        "backtest": backtest_result,
        "confidence": 0.9,
        "warnings": [],
        "explanation": "Strategy generated successfully."
    })


def _operand_to_text(node):
    """Render one side of a DSL condition as plain English."""
    if not isinstance(node, dict):
        return str(node)
    if "value" in node:
        return str(node["value"])
    if "func" in node:
        func = str(node["func"])
        args = node.get("arg", {}) or {}
        offset = args.get("offset") or 0
        suffix = f" ({int(offset)} bar{'s' if int(offset) != 1 else ''} ago)" if offset else ""
        if func.upper() == "PRICE":
            return f"{args.get('OHLC', 'close')} price{suffix}"
        if func.upper() == "VOLUME":
            return f"volume{suffix}"
        shown = [str(v) for k, v in args.items()
                 if k not in ("timeframe", "offset") and v not in (None, "")]
        label = f"{func}({', '.join(shown)})" if shown else func
        tf = args.get("timeframe")
        if tf:
            label += f" on {tf}"
        return label + suffix
    if "op" in node:
        return f"{_operand_to_text(node.get('left'))} {node.get('op')} {_operand_to_text(node.get('right'))}"
    return "?"


def _conditions_to_text(cond):
    """Render a DSL condition tree (with AND/OR nesting) as plain English."""
    if not isinstance(cond, dict):
        return "?"
    if "AND" in cond:
        return " AND ".join(_conditions_to_text(c) for c in cond["AND"])
    if "OR" in cond:
        return " OR ".join(_conditions_to_text(c) for c in cond["OR"])
    return (f"{_operand_to_text(cond.get('left'))} "
            f"{cond.get('operator', '?')} "
            f"{_operand_to_text(cond.get('right'))}")


def build_explanation(strategy):
    direction = "LONG" if "LONG" in strategy else "SHORT"
    body = strategy[direction]
    ctx = body["context"]
    open_block = body.get("OPEN", {})
    open_args = open_block.get("ARGUMENTS", {})
    close_block = body.get("CLOSE")

    tickers = ", ".join(ctx["tickers"])
    tf = ctx["execution_timeframe"]
    start = ctx["dateframe"]["start"]
    end = ctx["dateframe"]["end"]

    tp = open_args.get("takeProfitPercent")
    sl = open_args.get("stopLossPercent")

    lines = [f"Here's your strategy — {'Long' if direction == 'LONG' else 'Short'} {tickers} on the {tf} chart:"]

    entry_text = _conditions_to_text(open_block.get("CONDITIONS"))
    if entry_text and entry_text != "?":
        lines.append(f"• Enter when: {entry_text}")

    risk_bits = []
    if tp:
        risk_bits.append(f"take profit {round(float(tp), 1)}%")
    if sl:
        risk_bits.append(f"stop loss {round(float(sl), 1)}%")
    if risk_bits:
        lines.append(f"• Risk: {' · '.join(risk_bits)}")

    if close_block and close_block.get("CONDITIONS"):
        exit_text = _conditions_to_text(close_block.get("CONDITIONS"))
        lines.append(f"• Also exit when: {exit_text}")
    elif not risk_bits:
        lines.append("• Exit: none set — position closes at the end of the backtest")

    if open_args.get("recurring"):
        rec_period = open_args.get("recurringPeriod")
        lines.append(f"• DCA: adds to the position every {rec_period} bars" if rec_period else "• DCA enabled")

    lines.append(f"• Backtest period: {start} → {end}")

    return "\n".join(lines)


def log_query(
    user,
    raw_input,
    status,
    conversation_history=None,
    model_output=None,
    errors=None,
    turns_taken=1,
    session_id=None,
    missing_field=None,
):
    """Fire and forget query logging - never blocks the request"""
    try:
        StrategyQueryLog.objects.create(
            user=user,
            raw_input=raw_input,
            conversation_history=conversation_history or [],
            model_output=model_output,
            status=status,
            errors=errors or [],
            turns_taken=turns_taken,
            session_id=session_id,
            missing_field=missing_field,
        )
    except Exception as e:
        logger.warning(f"Failed to log query: {e}")


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("general")
def strategy_chat_outcome(request):
    """Post-parse feedback: did the user run the AI-parsed strategy, and which
    fields did they correct first? Stamped onto the matching query log — this
    is the ground-truth signal for whether the model's parses are RIGHT
    (schema-valid but wrong parses show up here as edits, nowhere else)."""
    user = get_authenticated_user(request)
    body = parse_body(request)

    session_id = str(body.get("session_id") or "").strip()
    if not session_id:
        raise APIError("session_id is required")

    edited = body.get("edited_fields")
    if not isinstance(edited, list):
        edited = []
    edited = [str(f)[:50] for f in edited][:20]

    log = (
        StrategyQueryLog.objects
        .filter(user=user, session_id=session_id, status="complete")
        .order_by("-id")
        .first()
    )
    if log:
        log.ran_backtest = bool(body.get("ran_backtest", True))
        log.edited_fields = edited
        log.save(update_fields=["ran_backtest", "edited_fields"])

    return no_store(JsonResponse({"ok": True}))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("assistant")
def strategy_chat(request):
    user = get_authenticated_user(request)
    body = parse_body(request)
    message = (body.get("message") or "").strip()
    session_id = body.get("session_id")

    if not message:
        raise APIError("message is required")

    # ---- Non-strategy input ----
    if not session_id and is_non_strategy_input(message):
        log_query(
            user=user,
            raw_input=message,
            status='non_strategy',
            session_id=session_id,
        )
        return JsonResponse({
            "status": "clarify",
            "session_id": str(uuid.uuid4()),
            "question": "I can help you build and backtest trading strategies. Try describing a strategy like: 'Buy AAPL when RSI drops below 30 on 4h, TP 15%, SL 5%'",
            "examples": [
                "Buy AAPL when RSI drops below 30 on 4h, TP 15%, SL 5%",
                "Short Tesla when price falls below 50-SMA on 4h, TP 20%, SL 10%",
                "Long Bitcoin when MACD crosses zero on daily, TP 30%, SL 10%",
            ],
            "field": "general",
        })

    # ---- Get or create conversation ----
    if session_id:
        conversation = StrategyConversation.objects.filter(
            session_id=session_id,
            user=user,
            status='in_progress'
        ).first()

        if not conversation:
            conversation = StrategyConversation.objects.create(
                user=user,
                session_id=str(uuid.uuid4()),
                turns=[],
                missing_fields=[],
            )
    else:
        conversation = StrategyConversation.objects.create(
            user=user,
            session_id=str(uuid.uuid4()),
            turns=[],
            missing_fields=[],
        )

    # ---- Add user message to history ----
    conversation.add_turn("user", message)
    history = conversation.get_conversation_history()

    # ---- Max turns guard ----
    MAX_TURNS = 10
    if len(history) > MAX_TURNS:
        conversation.status = 'abandoned'
        conversation.save(update_fields=["status", "updated_at"])
        return JsonResponse({
            "status": "clarify",
            "session_id": conversation.session_id,
            "question": "This conversation has gone on too long without a complete strategy. Let's start fresh - try describing your full strategy in one message.",
            "examples": [
                "Buy AAPL when RSI drops below 30 on 4h, TP 15%, SL 5%",
                "Short Tesla when price falls below 50-SMA on 4h, TP 20%, SL 10%",
            ],
            "field": "general",
        })

    # ---- Check for missing fields ----
    missing = detect_missing_fields(message, history)

    if missing:
        next_q = get_next_question(missing)

        # If asking about timeframe, show only valid options for mentioned tickers
        if next_q["field"] == "timeframe":
            from core.LLM.registry_loader import load_ticker_registry
            from core.LLM.ambiguity import get_timeframe_question

            all_user_text = " ".join(
                t["content"] for t in history if t["role"] == "user"
            )
            ticker_reg = load_ticker_registry()
            available_tfs = set()

            for ticker, data in ticker_reg.items():
                aliases = [a.lower() for a in data.get("aliases", [])] + [ticker.lower()]
                if any(a in all_user_text.lower() for a in aliases):
                    tfs = data.get("available_timeframes", ["1h", "4h", "1D"])
                    available_tfs.update(tfs)

            if available_tfs:
                next_q = get_timeframe_question(sorted(available_tfs))

        conversation.missing_fields = missing
        conversation.save(update_fields=["missing_fields", "updated_at"])
        conversation.add_turn("assistant", next_q["question"])

        log_query(
            user=user,
            raw_input=message,
            status='clarify',
            conversation_history=history,
            turns_taken=len(history),
            session_id=conversation.session_id,
            missing_field=next_q["field"],
        )

        return JsonResponse({
            "status": "clarify",
            "session_id": conversation.session_id,
            "question": next_q["question"],
            "examples": next_q.get("examples", []),
            "field": next_q["field"],
            "turns": len(history),
        })

    # ---- Get user constraints ----
    constraints = get_user_constraints(user)

    # ---- Plan quota (only the real model call is metered, not clarify turns) ----
    # Reserve atomically before the model call; refund if the model is unavailable.
    entitlements.consume_quota(user, "ai")

    # ---- Try to parse with full context ----
    try:
        strategy, errors, raw_output = parse_strategy_with_context(
            history,
            allowed_tickers=constraints["allowed_tickers"],
            allowed_timeframes=constraints["allowed_timeframes"]
        )
    except LLMUnavailableError as e:
        entitlements.refund_quota(user, "ai")
        logger.warning(f"LLM unavailable for strategy_chat: {e}")
        return JsonResponse({"success": False, "error": LLM_UNAVAILABLE_MESSAGE}, status=503)
    except Exception:
        entitlements.refund_quota(user, "ai")
        raise

    # ---- Check for invalid timeframe in errors ----
    timeframe_errors = [e for e in errors if "Invalid timeframe" in e]
    if timeframe_errors and strategy is not None:
        from core.LLM.registry_loader import load_ticker_registry
        direction = "LONG" if "LONG" in strategy else "SHORT"
        tickers = strategy[direction]["context"]["tickers"]
        ticker_reg = load_ticker_registry()
        available_tfs = set()
        for t in tickers:
            tfs = ticker_reg.get(t, {}).get("available_timeframes", ["4h", "1D"])
            available_tfs.update(tfs)

        available_tfs_list = sorted(available_tfs)

        # Check if user actually specified a timeframe in their messages
        all_user_text = " ".join(
            t["content"] for t in history if t["role"] == "user"
        ).lower()

        user_specified_timeframe = any(
            re.search(pattern, all_user_text)
            for pattern in [
                r'\b(1m|5m|15m|1h|4h|1d)\b',
                r'\b\d+\s*hour\b',
                r'\b\d+\s*minute\b',
                r'\b(hourly|daily|weekly)\b',
            ]
        )

        if user_specified_timeframe:
            # User said a specific timeframe that isn't available - tell them
            conversation.add_turn("assistant", f"That timeframe isn't available for {', '.join(tickers)}.")
            conversation.save()

            log_query(
                user=user,
                raw_input=message,
                status='clarify',
                conversation_history=history,
                errors=errors,
                turns_taken=len(history),
                session_id=conversation.session_id,
                missing_field='timeframe',
            )

            return JsonResponse({
                "status": "clarify",
                "session_id": conversation.session_id,
                "question": f"That timeframe isn't available for {', '.join(tickers)}. Please choose from: {', '.join(available_tfs_list)}",
                "examples": available_tfs_list,
                "field": "timeframe",
                "turns": len(history),
            })
        else:
            # User didn't specify - silently use best default
            best_default = "1h" if "1h" in available_tfs_list else available_tfs_list[0]
            strategy[direction]["context"]["execution_timeframe"] = best_default
            # Fall through to success

    # ---- Model failed ----
    if strategy is None:
        conversation.add_turn(
            "assistant",
            "I couldn't quite parse that. Could you rephrase it?"
        )

        log_query(
            user=user,
            raw_input=message,
            status='failed',
            conversation_history=history,
            errors=errors,
            turns_taken=len(history),
            session_id=conversation.session_id,
        )

        return JsonResponse({
            "status": "clarify",
            "session_id": conversation.session_id,
            "question": "I had trouble understanding that. Could you try rephrasing? For example: 'Buy AAPL when RSI drops below 30 on 4h, TP 15%, SL 5%'",
            "examples": [
                "Buy AAPL when RSI drops below 30 on 4h, TP 15%, SL 5%",
                "Short Tesla when price falls below 50-SMA on 4h, TP 20%, SL 10%",
            ],
            "field": "general",
        })

    # ---- Success ----
    conversation.status = 'complete'
    conversation.partial_strategy = strategy
    explanation = build_explanation(strategy)
    conversation.add_turn("assistant", f"Got it. {explanation}")
    conversation.save(update_fields=["status", "partial_strategy", "updated_at"])

    log_query(
        user=user,
        raw_input=message,
        status='complete',
        conversation_history=history,
        model_output=strategy,
        errors=errors,
        turns_taken=len(history),
        session_id=conversation.session_id,
    )

    return JsonResponse({
        "status": "complete",
        "session_id": conversation.session_id,
        "dsl_json": strategy,
        "explanation": explanation,
        "warnings": [e for e in errors if "default" not in e],
        "turns": len(history),
    })


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@rate_limit("general")
def registry(request):
    base = Path(settings.BASE_DIR) / "core" / "registries"

    with open(base / "commandRegistry.json", encoding="utf-8") as f:
        commands = json.load(f)

    with open(base / "indicatorRegistry.json", encoding="utf-8") as f:
        indicators = json.load(f)

    with open(base / "argumentsRegistry.json", encoding="utf-8") as f:
        arguments = json.load(f)

    with open(base / "tickerRegistry.json", encoding="utf-8") as f:
        ticker_data = json.load(f)

    with open(base / "timeframeRegistry.json", encoding="utf-8") as f:
        timeframe_data = json.load(f)

    # Format tickers for frontend - just what UI needs
    tickers = {
        ticker: {
            "name": data["name"],
            "available_timeframes": data["available_timeframes"]
        }
        for ticker, data in ticker_data.get("TICKERS", {}).items()
    }

    # Format timeframes for frontend
    timeframes = {
        tf: data["label"]
        for tf, data in timeframe_data.get("TIMEFRAMES", {}).items()
    }

    return JsonResponse({
        "commands": commands,
        "indicators": indicators,
        "arguments": arguments,
        "tickers": tickers,
        "timeframes": timeframes,
    })


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("general")
def dashboard_summary(request):
    user = get_authenticated_user(request)

    strategies_qs = Strategy.objects.filter(user=user)
    backtests_qs = BacktestRun.objects.filter(user=user).order_by("-created_at")
    backtests_asc = list(backtests_qs.order_by("created_at").values("created_at", "final_balance"))

    aggregates = backtests_qs.aggregate(
        avg_return=Avg("pct_change"),
        total_wins=Sum("winning_trades"),
        total_losses=Sum("losing_trades"),
    )
    total_wins = aggregates.get("total_wins") or 0
    total_losses = aggregates.get("total_losses") or 0
    closed_trades = total_wins + total_losses

    # Use run-level equity points for a stable dashboard curve (one point per run).
    equity_curve = [
        {"timestamp": point["created_at"].isoformat(), "equity": float(point["final_balance"])}
        for point in backtests_asc
    ]

    response = {
        "strategy_count": strategies_qs.count(),
        "backtest_run_count": backtests_qs.count(),
        # Average pct_change across the user's runs. The old key name
        # ("total_return_pct") is kept alongside for any stale clients.
        "avg_return_pct": aggregates.get("avg_return") or 0,
        "total_return_pct": aggregates.get("avg_return") or 0,
        "win_rate": (total_wins / closed_trades * 100) if closed_trades else 0,
        "equity_curve": equity_curve,
        "recent_backtests": [serialize_backtest_run(run) for run in backtests_qs[:5]],
    }

    return JsonResponse(response)


# yfinance interval codes differ from our internal timeframe ids (used only when
# there is no pre-pulled CSV to fall back on; yfinance has no native 4h bar).
_TIMEFRAME_TO_YF_INTERVAL = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "1D": "1d",
}


def _load_ticker_registry() -> dict:
    try:
        base = Path(settings.BASE_DIR) / "core" / "registries"
        with open(base / "tickerRegistry.json", encoding="utf-8") as f:
            return json.load(f).get("TICKERS", {})
    except (OSError, ValueError) as exc:  # missing/corrupt file -> treat all as custom
        logger.warning("ticker registry unavailable: %s", exc)
        return {}


# ---------------------------------------------------------------------------
# Ticker symbol search / name resolution (Yahoo Finance-backed)
# ---------------------------------------------------------------------------
_YF_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
# Yahoo rejects requests without a browser-ish UA.
_YF_SEARCH_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; OrcaBacktester/1.0)"}
_TICKER_NAME_CACHE_TTL = 7 * 24 * 3600
_YF_SEARCH_CACHE_TTL = 6 * 3600


def _yahoo_symbol_search(query: str) -> list:
    """Search Yahoo Finance for symbols matching ``query``.

    Returns [{symbol, name, exchange, type}], cached per query so typing in the
    UI (and repeated name lookups) don't hammer Yahoo. Failures degrade to an
    empty list with a short negative-cache so an outage doesn't retry per call.
    """
    key = f"yf_search:{query.lower()}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    try:
        resp = requests.get(
            _YF_SEARCH_URL,
            params={"q": query, "quotesCount": 10, "newsCount": 0, "listsCount": 0},
            headers=_YF_SEARCH_HEADERS,
            timeout=4,
        )
        resp.raise_for_status()
        quotes = resp.json().get("quotes", []) or []
    except Exception as exc:  # noqa: BLE001 — any network/parse failure degrades the same way
        logger.warning("Yahoo ticker search failed for %r: %s", query, exc)
        cache.set(key, [], 60)
        return []

    results = []
    for item in quotes:
        symbol = str(item.get("symbol") or "").strip()
        if not symbol:
            continue
        name = item.get("shortname") or item.get("longname") or symbol
        results.append({
            "symbol": symbol,
            "name": name,
            "exchange": item.get("exchDisp") or item.get("exchange") or "",
            "type": item.get("quoteTypeDisp") or item.get("quoteType") or "",
        })
        # Every search doubles as a name lookup for later resolution.
        cache.set(f"ticker_name:{symbol.upper()}", name, _TICKER_NAME_CACHE_TTL)

    cache.set(key, results, _YF_SEARCH_CACHE_TTL)
    return results


def resolve_ticker_names(symbols) -> dict:
    """Map each symbol to its full asset name.

    Resolution order: local ticker registry -> cached Yahoo lookups -> a live
    Yahoo search for that symbol -> the symbol itself (never fails).
    """
    registry = _load_ticker_registry()
    names = {}
    for sym in symbols:
        entry = registry.get(sym)
        if entry and entry.get("name"):
            names[sym] = entry["name"]
            continue
        cached = cache.get(f"ticker_name:{sym.upper()}")
        if cached:
            names[sym] = cached
            continue
        match = next(
            (r for r in _yahoo_symbol_search(sym) if r["symbol"].upper() == sym.upper()),
            None,
        )
        names[sym] = match["name"] if match else sym
    return names


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("general")
def ticker_search(request):
    """Symbol autocomplete: local registry matches first, then live Yahoo Finance.

    Each result: {symbol, name, exchange, type, local}. ``local`` marks symbols
    with pre-pulled Orca data (they support more timeframes / faster backtests).
    """
    query = (request.GET.get("q") or "").strip()[:40]
    if not query:
        return no_store(JsonResponse({"results": []}))

    query_lower = query.lower()
    results, seen = [], set()

    for sym, meta in _load_ticker_registry().items():
        haystack = " ".join([sym, meta.get("name", ""), *meta.get("aliases", [])]).lower()
        if query_lower in haystack:
            results.append({
                "symbol": sym,
                "name": meta.get("name", sym),
                "exchange": "Orca data",
                "type": "",
                "local": True,
            })
            seen.add(sym.upper())

    for item in _yahoo_symbol_search(query):
        if item["symbol"].upper() in seen:
            continue
        results.append({**item, "local": False})
        seen.add(item["symbol"].upper())

    return no_store(JsonResponse({"results": results[:15]}))


def _load_chart_dataframe(ticker: str, timeframe: str):
    """
    Prefer the pre-pulled CSVs in core/data_csvs (the same source backtests use,
    and the only source with 4h bars). Fall back to live yfinance otherwise.
    Returns (dataframe_or_None, error_message_or_None).
    """
    # CSV filenames are inconsistent in case (e.g. AAPL_1d.csv but registry id "1D").
    for tf_variant in dict.fromkeys([timeframe, timeframe.lower(), timeframe.upper()]):
        path = _market_csv_path(ticker, tf_variant)
        if path is not None:
            try:
                df = _load_market_csv(path)
                if df is not None and not df.empty:
                    # _load_market_csv keeps the original datetime as both a column and
                    # the index; keep only OHLCV so reset_index() doesn't collide.
                    ohlcv = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
                    return df[ohlcv], None
            except Exception as exc:  # noqa: BLE001
                logger.warning("chart_data CSV load failed for %s %s: %s", ticker, tf_variant, exc)

    yf_interval = _TIMEFRAME_TO_YF_INTERVAL.get(timeframe)
    if yf_interval is None:
        return None, f"No stored data for {ticker} on the {timeframe} timeframe."

    today = timezone.now().date()
    # yfinance caps intraday history (~730 days for 1h, ~60 for minute bars);
    # asking from 2020 just returns nothing, so clamp the start for those.
    if yf_interval == "1d":
        start = "2020-01-01"
    elif yf_interval in ("1m", "5m", "15m"):
        start = (today - timedelta(days=55)).isoformat()
    else:
        start = (today - timedelta(days=700)).isoformat()

    try:
        df = get_data_with_indicator(ticker, start, today.isoformat(), interval=yf_interval)
        if df is None or df.empty:
            return None, "No market data is available for that selection."
        return df, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("chart_data yfinance fetch failed for %s %s: %s", ticker, timeframe, exc)
        return None, "Could not load market data for that selection."


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("general")
def chart_data(request):
    """Raw OHLCV for a single ticker/timeframe, for the standalone Charts page."""
    ticker = (request.GET.get("ticker") or "").strip().upper()
    timeframe = (request.GET.get("timeframe") or "1D").strip()

    if not ticker:
        raise APIError("ticker is required.")

    registry = _load_ticker_registry()
    ticker_config = registry.get(ticker)

    # Allowed timeframes = anything yfinance can fetch live (1m…1h, 1D) plus, for
    # stored tickers, the extra ones baked into their CSVs (e.g. 4h). So a known
    # ticker like AAPL can still be viewed on 1h — it just comes from Yahoo.
    yf_timeframes = set(_TIMEFRAME_TO_YF_INTERVAL)
    if ticker_config is not None:
        name = ticker_config.get("name", ticker)
        allowed = set(ticker_config.get("available_timeframes", [])) | yf_timeframes
    else:
        # Unknown ticker: resolve its real asset name (cached Yahoo lookup).
        name = resolve_ticker_names([ticker]).get(ticker, ticker)
        allowed = yf_timeframes

    if timeframe not in allowed:
        raise APIError(
            f"Timeframe '{timeframe}' isn't available for {ticker}. "
            f"Try one of: {', '.join(sorted(allowed)) or 'none'}."
        )

    df, error_message = _load_chart_dataframe(ticker, timeframe)
    if error_message:
        raise APIError(error_message, status_code=404)

    records = dataframe_to_response_records(df)

    return no_store(JsonResponse({
        "ticker": ticker,
        "name": name,
        "timeframe": timeframe,
        "candles": records,
    }))


def serialize_backtest_run_full(run: BacktestRun):
    payload = serialize_backtest_run(run)
    payload.update(
        {
            "winning_trades": run.winning_trades,
            "losing_trades": run.losing_trades,
            "cash": run.cash,
            "invested": run.invested,
            "equity_curve": run.equity_curve or [],
        }
    )
    return payload


@csrf_exempt
@api_error_boundary
@require_methods("GET")
@token_required
@rate_limit("general")
def backtest_runs(request):
    user = get_authenticated_user(request)

    try:
        limit = int(request.GET.get("limit", 200))
        offset = int(request.GET.get("offset", 0))
    except (TypeError, ValueError):
        raise APIError("limit and offset must be integers.")
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    runs_qs = BacktestRun.objects.filter(user=user).order_by("-created_at")
    total = runs_qs.count()
    runs = runs_qs[offset : offset + limit]

    return JsonResponse(
        {
            "runs": [serialize_backtest_run_full(run) for run in runs],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    )


@csrf_exempt
@api_error_boundary
@require_methods("DELETE")
@token_required
@rate_limit("general")
def backtest_run_detail(request, run_id: int):
    user = get_authenticated_user(request)

    try:
        run = BacktestRun.objects.get(id=run_id, user=user)
    except BacktestRun.DoesNotExist:
        return JsonResponse({"error": "Backtest run not found."}, status=404)

    run.delete()
    return JsonResponse({"success": True})


# Cap the stored paper-trading document so a runaway client can't bloat the DB.
MAX_PAPER_ACCOUNTS = 50
MAX_PAPER_ACCOUNTS_BYTES = 2_000_000  # ~2 MB of JSON per user


@csrf_exempt
@api_error_boundary
@require_methods("GET", "PUT")
@token_required
@rate_limit("general")
def paper_accounts(request):
    """Per-user paper-trading workspace, persisted as one JSON document."""
    user = get_authenticated_user(request)

    if request.method == "GET":
        state = PaperAccountState.objects.filter(user=user).first()
        accounts = state.accounts if state and isinstance(state.accounts, list) else []
        return no_store(JsonResponse({"accounts": accounts}))

    body = parse_body(request)
    accounts = body.get("accounts")
    if not isinstance(accounts, list):
        raise APIError("accounts must be a list.")
    if len(accounts) > MAX_PAPER_ACCOUNTS:
        raise APIError(f"Too many paper accounts (max {MAX_PAPER_ACCOUNTS}).")
    entitlements.enforce_total_count(user, "paper_accounts", len(accounts))
    if len(json.dumps(accounts)) > MAX_PAPER_ACCOUNTS_BYTES:
        raise APIError("Paper account data is too large to save.")

    PaperAccountState.objects.update_or_create(user=user, defaults={"accounts": accounts})
    return no_store(JsonResponse({"accounts": accounts}))
