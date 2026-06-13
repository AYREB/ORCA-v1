# backend/api/views.py
import json
import logging
import re
import ssl
import threading
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
from core.main import dslJSONBacktest, dslTextToJsonBacktest, BacktestError, dataframe_to_response_records
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
from .models import BacktestRun, CustomIndicator, Strategy, StrategyConversation, StrategyQueryLog
from core.LLM.orca_llm import parse_strategy, parse_strategy_with_context
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
        from core.LLM.orca_llm import get_model
        get_model()
    except Exception as e:
        logger.warning(f"Model pre-warm failed: {e}")

threading.Thread(target=_prewarm_model, daemon=True).start()


optimizer_jobs: dict[str, dict[str, Any]] = {}
genetic_jobs: dict[str, dict[str, Any]] = {}
# Shared store for the metaheuristic optimizers (random / pso / annealing / differential),
# which all run through the single dslOptimiser endpoint and differ only by `method`.
optimiser_jobs: dict[str, dict[str, Any]] = {}

DEFAULT_INITIAL_BALANCE = 10000.0
MAX_STRATEGY_NAME_LENGTH = 255
MAX_INDICATOR_NAME_LENGTH = 120
MAX_INDICATOR_DESCRIPTION_LENGTH = 2000
MAX_INDICATOR_CODE_LENGTH = 20000

DEFAULT_RATE_LIMITS = {
    "auth": {"max_requests": 20, "window_seconds": 300},
    "backtest": {"max_requests": 60, "window_seconds": 60},
    "compute": {"max_requests": 10, "window_seconds": 60},
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
    return {"id": user.id, "email": user.email, "name": user.first_name or user.username}


def error_response(exc: Exception) -> JsonResponse:
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
                return json_error("Too many requests. Please try again later.", status=429)

            return view_func(request, *args, **kwargs)

        return wrapped

    return decorator


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


def cleanup_jobs(store: dict[str, dict[str, Any]]) -> None:
    ttl_seconds = int(getattr(settings, "ASYNC_JOB_TTL_SECONDS", 3600))
    max_entries = int(getattr(settings, "ASYNC_JOB_MAX_ENTRIES", 500))
    now = timezone.now()

    expired_job_ids = []
    for job_id, job in store.items():
        created_at = job.get("created_at")
        if not created_at:
            expired_job_ids.append(job_id)
            continue
        age_seconds = (now - created_at).total_seconds()
        if age_seconds > ttl_seconds:
            expired_job_ids.append(job_id)

    for job_id in expired_job_ids:
        store.pop(job_id, None)

    if len(store) <= max_entries:
        return

    sorted_jobs = sorted(store.items(), key=lambda item: item[1].get("created_at", now))
    for job_id, job in sorted_jobs:
        if len(store) <= max_entries:
            break
        if job.get("status") in {"completed", "error"}:
            store.pop(job_id, None)

    if len(store) > max_entries:
        for job_id, _ in sorted_jobs:
            if len(store) <= max_entries:
                break
            store.pop(job_id, None)


def ensure_user_can_create_job(store: dict[str, dict[str, Any]], user_id: int) -> None:
    max_per_user = int(getattr(settings, "ASYNC_JOB_MAX_PER_USER", 3))
    active_count = sum(
        1
        for job in store.values()
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

    open_positions: Dict[str, Dict[str, float]] = {}
    equity_curve: List[Dict[str, Any]] = []
    winning_trades = 0
    losing_trades = 0

    for trade in trades:
        try:
            equity = float(trade.get("balance", 0) or 0) + float(trade.get("open_positions_value", 0) or 0)
            ts = trade.get("timestamp")
            if ts:
                equity_curve.append({"timestamp": ts, "equity": equity})
        except (TypeError, ValueError):
            pass

        ttype = trade.get("type")
        ticker = trade.get("ticker")
        if ttype in ("BUY", "RECURRING_BUY") and ticker:
            try:
                price = float(trade.get("price") or 0)
                shares = float(trade.get("shares") or 0)
            except (TypeError, ValueError):
                continue
            pos = open_positions.get(ticker, {"shares": 0.0, "cost": 0.0})
            pos["shares"] += shares
            pos["cost"] += shares * price
            open_positions[ticker] = pos
        elif ttype == "SELL" and ticker:
            try:
                price = float(trade.get("price") or 0)
                shares = float(trade.get("shares") or 0)
            except (TypeError, ValueError):
                continue
            pos = open_positions.get(ticker, {"shares": 0.0, "cost": 0.0})
            avg_cost = (pos["cost"] / pos["shares"]) if pos["shares"] else price
            profit = (price - avg_cost) * shares
            if profit >= 0:
                winning_trades += 1
            else:
                losing_trades += 1
            open_positions[ticker] = {"shares": 0.0, "cost": 0.0}

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
    payload = parse_body(request)
    messages = normalize_assistant_messages(payload.get("messages"))
    strategy_context = normalize_strategy_context(payload.get("strategy_context"))

    try:
        response = ask_strategy_assistant(messages, strategy_context)
    except AssistantError as exc:
        raise APIError(exc.message, status_code=exc.status_code)

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
@require_methods("GET")
@token_required
@rate_limit("general")
def me(request):
    user = get_authenticated_user(request)
    return no_store(JsonResponse(user_payload(user)))


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
    base = Path(__file__).resolve().parent.parent.parent / "backend/core/registries"
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
@rate_limit("compute")
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
@rate_limit("compute")
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
    payload = parse_body(request)
    messages = normalize_assistant_messages(payload.get("messages"))
    indicator_context = normalize_indicator_context(payload.get("indicator_context"))
    mode = "agent" if str(payload.get("mode", "ask")).strip().lower() == "agent" else "ask"

    try:
        response = ask_indicator_assistant(messages, indicator_context, mode=mode)
    except AssistantError as exc:
        raise APIError(exc.message, status_code=exc.status_code)

    return no_store(JsonResponse(response))


@csrf_exempt
@api_error_boundary
@require_methods("POST")
@token_required
@rate_limit("backtest")
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

    result = dslTextToJsonBacktest(dsl, initial_balance=initial_balance, custom_indicators=custom_indicators)
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

    try:
        result = dslJSONBacktest(dsl, initial_balance=initial_balance, custom_indicators=custom_indicators)
    except BacktestError as e:
        return JsonResponse({
            "error": e.message,
            "code": e.code,
            "success": False
        }, status=400)
    except ValueError as e:
        # DSL validation errors
        return JsonResponse({
            "error": str(e),
            "code": "validation_error",
            "success": False
        }, status=400)
    except Exception as e:
        logger.exception("Unexpected backtest error")
        return JsonResponse({
            "error": "An unexpected error occurred. Please try again.",
            "code": "unexpected_error",
            "success": False
        }, status=500)

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
def dslParameterOptimiser(request):
    user = get_authenticated_user(request)
    body = parse_body(request)
    dsl = validate_dict_payload(body.get("dsl_json", {}), "dsl_json")
    parameter_choice = validate_dict_payload(body.get("parameter_choice", {}), "parameter_choice")
    initial_balance = parse_initial_balance(body.get("initial_balance", DEFAULT_INITIAL_BALANCE))
    async_mode = bool(body.get("async", False))

    if async_mode:
        cleanup_jobs(optimizer_jobs)
        ensure_user_can_create_job(optimizer_jobs, user.id)

        job_id = str(uuid.uuid4())
        param_grid, _ = build_param_grid(dsl, parameter_choice)
        if not param_grid:
            raise APIError("No parameters selected for optimization")
        total_runs = 1
        for vals in param_grid.values():
            total_runs *= len(vals)

        optimizer_jobs[job_id] = {
            "status": "queued",
            "completed_runs": 0,
            "total_runs": total_runs,
            "result": None,
            "error": None,
            "user_id": user.id,
            "created_at": timezone.now(),
        }

        def progress_hook(done, total):
            job = optimizer_jobs.get(job_id)
            if not job:
                return
            job["completed_runs"] = done
            job["total_runs"] = total
            job["status"] = "running"

        def run_job():
            try:
                result = optimizer(
                    parsed_dsl=dsl,
                    param_choices=parameter_choice,
                    initial_balance=initial_balance,
                    progress_hook=progress_hook,
                    param_grid_override=param_grid,
                )
                job = optimizer_jobs.get(job_id)
                if not job:
                    return
                job["result"] = result
                job["status"] = "completed"
                job["completed_runs"] = job.get("total_runs", 0)
            except Exception as exc:
                job = optimizer_jobs.get(job_id)
                if not job:
                    return
                job["error"] = str(exc) if settings.DEBUG else "Optimization failed."
                job["status"] = "error"

        threading.Thread(target=run_job, daemon=True).start()
        return JsonResponse({"job_id": job_id, "total_runs": total_runs})

    result = optimizer(parsed_dsl=dsl, param_choices=parameter_choice, initial_balance=initial_balance)
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

    if async_mode:
        cleanup_jobs(genetic_jobs)
        ensure_user_can_create_job(genetic_jobs, user.id)

        job_id = str(uuid.uuid4())
        param_values, _ = build_param_values(dsl, parameter_choice)
        if not param_values:
            raise APIError("No parameters selected for optimization")

        total_runs = int(ga_settings.get("population", 20)) * int(ga_settings.get("generations", 10))

        genetic_jobs[job_id] = {
            "status": "queued",
            "completed_runs": 0,
            "total_runs": total_runs,
            "result": None,
            "error": None,
            "user_id": user.id,
            "created_at": timezone.now(),
        }

        def progress_hook(done, total):
            job = genetic_jobs.get(job_id)
            if not job:
                return
            job["completed_runs"] = done
            job["total_runs"] = total
            job["status"] = "running"

        def run_job():
            try:
                result = genetic_optimizer(
                    parsed_dsl=dsl,
                    param_choices=parameter_choice,
                    initial_balance=initial_balance,
                    ga_settings=ga_settings,
                    progress_hook=progress_hook,
                )
                job = genetic_jobs.get(job_id)
                if not job:
                    return
                job["result"] = result
                job["status"] = "completed"
                job["completed_runs"] = job.get("total_runs", 0)
            except Exception as exc:
                job = genetic_jobs.get(job_id)
                if not job:
                    return
                job["error"] = str(exc) if settings.DEBUG else "Optimization failed."
                job["status"] = "error"

        threading.Thread(target=run_job, daemon=True).start()
        return JsonResponse({"job_id": job_id, "total_runs": total_runs})

    result = genetic_optimizer(
        parsed_dsl=dsl,
        param_choices=parameter_choice,
        initial_balance=initial_balance,
        ga_settings=ga_settings,
    )
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

    if async_mode:
        cleanup_jobs(optimiser_jobs)
        ensure_user_can_create_job(optimiser_jobs, user.id)

        job_id = str(uuid.uuid4())
        total_runs = estimate_total_runs(method, opt_settings)

        optimiser_jobs[job_id] = {
            "status": "queued",
            "completed_runs": 0,
            "total_runs": total_runs,
            "result": None,
            "error": None,
            "user_id": user.id,
            "created_at": timezone.now(),
        }

        def progress_hook(done, total):
            job = optimiser_jobs.get(job_id)
            if not job:
                return
            job["completed_runs"] = done
            job["total_runs"] = total
            job["status"] = "running"

        def run_job():
            try:
                result = runner(
                    parsed_dsl=dsl,
                    param_choices=parameter_choice,
                    initial_balance=initial_balance,
                    settings=opt_settings,
                    progress_hook=progress_hook,
                )
                job = optimiser_jobs.get(job_id)
                if not job:
                    return
                job["result"] = result
                job["status"] = "completed"
                job["completed_runs"] = job.get("total_runs", 0)
            except Exception as exc:
                job = optimiser_jobs.get(job_id)
                if not job:
                    return
                job["error"] = str(exc) if settings.DEBUG else "Optimization failed."
                job["status"] = "error"

        threading.Thread(target=run_job, daemon=True).start()
        return JsonResponse({"job_id": job_id, "total_runs": total_runs})

    result = runner(
        parsed_dsl=dsl,
        param_choices=parameter_choice,
        initial_balance=initial_balance,
        settings=opt_settings,
    )
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

    # 1. Call LLM parser
    result = parse_strategy(message)

    # 2. Handle failure from model
    if isinstance(result, dict) and "error" in result:
        return JsonResponse({
            "success": False,
            "error": result["error"],
            "issues": result.get("issues", []),
            "raw_model_output": result.get("raw_output", "")
        }, status=400)

    # 3. Optional: immediately run backtest if requested
    run_backtest = body.get("run_backtest", False)

    backtest_result = None
    if run_backtest:
        try:
            backtest_result = dslJSONBacktest(
                result,
                initial_balance=parse_initial_balance(body.get("initial_balance", 10000))
            )
        except BacktestError as e:
            backtest_result = {"error": e.message, "code": e.code}
        except Exception as e:
            backtest_result = {"error": "Backtest failed unexpectedly"}

    return JsonResponse({
        "success": True,
        "strategy_name": "Generated Strategy",
        "dsl_json": result,
        "backtest": backtest_result,
        "confidence": 0.9,
        "warnings": [],
        "explanation": "Strategy generated successfully."
    })


def build_explanation(strategy):
    direction = "LONG" if "LONG" in strategy else "SHORT"
    body = strategy[direction]
    ctx = body["context"]
    open_args = body["OPEN"]["ARGUMENTS"]
    has_close = "CLOSE" in body

    tickers = ", ".join(ctx["tickers"])
    tf = ctx["execution_timeframe"]
    start = ctx["dateframe"]["start"]
    end = ctx["dateframe"]["end"]

    tp = open_args.get("takeProfitPercent")
    sl = open_args.get("stopLossPercent")

    lines = []
    lines.append(f"{'Long' if direction == 'LONG' else 'Short'} {tickers} on {tf} timeframe")
    lines.append(f"Backtest period: {start} to {end}")

    if tp:
        # Values are already whole numbers after fix_percentage_fields
        lines.append(f"Take profit: {round(float(tp), 1)}%")
    if sl:
        lines.append(f"Stop loss: {round(float(sl), 1)}%")

    if has_close:
        lines.append("Exit: Explicit close condition set")
    else:
        lines.append("Exit: Via take profit / stop loss")

    if open_args.get("recurring"):
        lines.append("Recurring DCA enabled")

    return " | ".join(lines)


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

    # ---- Try to parse with full context ----
    strategy, errors, raw_output = parse_strategy_with_context(
        history,
        allowed_tickers=constraints["allowed_tickers"],
        allowed_timeframes=constraints["allowed_timeframes"]
    )

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
@token_required
@rate_limit("general")
def registry(request):
    base = Path(__file__).resolve().parent.parent.parent / "backend/core/registries"

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
    base = Path(__file__).resolve().parent.parent.parent / "backend/core/registries"
    with open(base / "tickerRegistry.json", encoding="utf-8") as f:
        return json.load(f).get("TICKERS", {})


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
    if ticker_config is None:
        raise APIError(f"Unknown ticker '{ticker}'.", status_code=404)

    available = ticker_config.get("available_timeframes", [])
    if timeframe not in available:
        raise APIError(
            f"Timeframe '{timeframe}' is not available for {ticker}. "
            f"Available: {', '.join(available) or 'none'}."
        )

    df, error_message = _load_chart_dataframe(ticker, timeframe)
    if error_message:
        raise APIError(error_message)

    records = dataframe_to_response_records(df)

    return no_store(JsonResponse({
        "ticker": ticker,
        "name": ticker_config.get("name", ticker),
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
