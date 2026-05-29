# backend/api/views.py
import json
import logging
import ssl
import threading
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

from core.analysis.parameter_optimiser import build_param_grid, build_param_values, genetic_optimizer, optimizer
from core.main import dslJSONBacktest, dslTextToJsonBacktest
from .assistant import AssistantError, ask_strategy_assistant, normalize_assistant_messages, normalize_strategy_context
from .models import BacktestRun, Strategy

try:
    import certifi
except ImportError:  # pragma: no cover - certifi is present in the project venv, fallback is for portability.
    certifi = None

User = get_user_model()
logger = logging.getLogger(__name__)

optimizer_jobs: dict[str, dict[str, Any]] = {}
genetic_jobs: dict[str, dict[str, Any]] = {}

DEFAULT_INITIAL_BALANCE = 10000.0
MAX_STRATEGY_NAME_LENGTH = 255

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
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or "unknown"
    return (request.META.get("REMOTE_ADDR") or "").strip() or "unknown"


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

    strategy = None
    strategy_label = str(body.get("strategy_name") or body.get("label") or "").strip()[:MAX_STRATEGY_NAME_LENGTH]
    strategy_id = body.get("strategy_id")
    if strategy_id is not None:
        try:
            strategy_id = int(strategy_id)
        except (TypeError, ValueError):
            raise APIError("strategy_id must be an integer.")
        strategy = Strategy.objects.filter(id=strategy_id, user=user).first()

    result = dslTextToJsonBacktest(dsl, initial_balance=initial_balance)
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

    strategy = None
    strategy_label = str(body.get("strategy_name") or body.get("label") or "").strip()[:MAX_STRATEGY_NAME_LENGTH]
    strategy_id = body.get("strategy_id")
    if strategy_id is not None:
        try:
            strategy_id = int(strategy_id)
        except (TypeError, ValueError):
            raise APIError("strategy_id must be an integer.")
        strategy = Strategy.objects.filter(id=strategy_id, user=user).first()

    result = dslJSONBacktest(dsl, initial_balance=initial_balance)
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

    return JsonResponse(
        {
            "commands": commands,
            "indicators": indicators,
            "arguments": arguments,
        }
    )


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
