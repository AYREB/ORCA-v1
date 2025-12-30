# backend/api/views.py
import json
from pathlib import Path

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework.authtoken.models import Token

import threading
import uuid

from core.analysis.parameter_optimiser import optimizer, build_param_grid, genetic_optimizer, build_param_values
from core.main import dslJSONBacktest, dslTextToJsonBacktest
from .models import Strategy

User = get_user_model()
optimizer_jobs = {}
genetic_jobs = {}


def parse_body(request):
    try:
        return json.loads(request.body)
    except json.JSONDecodeError:
        return {}


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


@csrf_exempt
def register(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)

    body = parse_body(request)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip()

    if not email or not password:
        return JsonResponse({"error": "Email and password are required."}, status=400)

    try:
        validate_password(password)
    except ValidationError as exc:
        return JsonResponse({"error": " ".join(exc.messages)}, status=400)

    if User.objects.filter(email__iexact=email).exists():
        return JsonResponse({"error": "An account with that email already exists."}, status=400)

    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        first_name=name,
    )
    token, _ = Token.objects.get_or_create(user=user)

    return JsonResponse(
        {"token": token.key, "user": {"id": user.id, "email": user.email, "name": user.first_name or user.username}},
        status=201,
    )


@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)

    body = parse_body(request)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not email or not password:
        return JsonResponse({"error": "Email and password are required."}, status=400)

    try:
        user_obj = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return JsonResponse({"error": "Invalid email or password."}, status=400)

    user = authenticate(username=user_obj.username, password=password)
    if not user:
        return JsonResponse({"error": "Invalid email or password."}, status=400)

    token, _ = Token.objects.get_or_create(user=user)

    return JsonResponse({"token": token.key, "user": {"id": user.id, "email": user.email, "name": user.first_name or user.username}})


@csrf_exempt
def me(request):
    user = get_user_from_request(request)
    if not user:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    return JsonResponse({"id": user.id, "email": user.email, "name": user.first_name or user.username})


@csrf_exempt
def strategies(request):
    user = get_user_from_request(request)
    if not user:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    if request.method == "GET":
        strategies_qs = Strategy.objects.filter(user=user).order_by("-updated_at")
        return JsonResponse({"strategies": [serialize_strategy(s) for s in strategies_qs]})

    if request.method == "POST":
        body = parse_body(request)
        name = (body.get("name") or "").strip()
        dsl_text = body.get("dsl") or ""
        dsl_json = body.get("dsl_json")
        last_result = body.get("last_result")

        if not name:
            return JsonResponse({"error": "Strategy name is required."}, status=400)

        if Strategy.objects.filter(user=user, name__iexact=name).exists():
            return JsonResponse({"error": "Strategy name already exists for this user."}, status=400)

        strategy = Strategy.objects.create(
            user=user,
            name=name,
            dsl_text=dsl_text,
            dsl_json=dsl_json,
            last_result=last_result,
            last_run_at=timezone.now() if last_result else None,
        )

        return JsonResponse({"strategy": serialize_strategy(strategy)}, status=201)

    return JsonResponse({"error": "Invalid request"}, status=400)


@csrf_exempt
def strategy_detail(request, strategy_id: int):
    user = get_user_from_request(request)
    if not user:
        return JsonResponse({"error": "Unauthorized"}, status=401)

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
            if not str(name).strip():
                return JsonResponse({"error": "Strategy name cannot be empty."}, status=400)
            if Strategy.objects.filter(user=user, name__iexact=str(name).strip()).exclude(id=strategy.id).exists():
                return JsonResponse({"error": "Strategy name already exists for this user."}, status=400)
            strategy.name = str(name).strip()
        if dsl_text is not None:
            strategy.dsl_text = dsl_text
        if "dsl_json" in body:
            strategy.dsl_json = dsl_json
        if "last_result" in body:
            strategy.last_result = last_result
            strategy.last_run_at = timezone.now() if last_result else None

        strategy.save()
        return JsonResponse({"strategy": serialize_strategy(strategy)})

    if request.method == "DELETE":
        strategy.delete()
        return JsonResponse({"success": True})

    return JsonResponse({"error": "Invalid request"}, status=400)


@csrf_exempt
def backtestDSLText(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            dsl = body.get("dsl_text", "")

            result = dslTextToJsonBacktest(dsl)
            return JsonResponse(result, safe=False)

        except Exception as e:
            import traceback

            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)


@csrf_exempt
def backtestDSLJSON(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            dsl = body.get("dsl_json", "")

            result = dslJSONBacktest(dsl)
            return JsonResponse(result, safe=False)

        except Exception as e:
            import traceback

            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)


@csrf_exempt
def dslParameterOptimiser(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            dsl = body.get("dsl_json", "")
            parameter_choice = body.get("parameter_choice", "")
            initial_balance = body.get("initial_balance", "")
            async_mode = body.get("async", False)

            # Optional async job: start optimizer in a background thread and return a job id
            if async_mode:
                job_id = str(uuid.uuid4())
                # Compute param grid once to know total runs up front
                param_grid, _ = build_param_grid(dsl, parameter_choice)
                total_runs = 1
                for vals in param_grid.values():
                    total_runs *= len(vals)

                optimizer_jobs[job_id] = {
                    "status": "queued",
                    "completed_runs": 0,
                    "total_runs": total_runs,
                    "result": None,
                    "error": None,
                }

                def progress_hook(done, total):
                    optimizer_jobs[job_id]["completed_runs"] = done
                    optimizer_jobs[job_id]["total_runs"] = total
                    optimizer_jobs[job_id]["status"] = "running"

                def run_job():
                    try:
                        result = optimizer(
                            parsed_dsl=dsl,
                            param_choices=parameter_choice,
                            initial_balance=initial_balance,
                            progress_hook=progress_hook,
                            param_grid_override=param_grid,
                        )
                        optimizer_jobs[job_id]["result"] = result
                        optimizer_jobs[job_id]["status"] = "completed"
                        optimizer_jobs[job_id]["completed_runs"] = optimizer_jobs[job_id].get("total_runs", 0)
                    except Exception as e:
                        optimizer_jobs[job_id]["error"] = str(e)
                        optimizer_jobs[job_id]["status"] = "error"

                threading.Thread(target=run_job, daemon=True).start()
                return JsonResponse({"job_id": job_id, "total_runs": total_runs})

            result = optimizer(parsed_dsl=dsl, param_choices=parameter_choice, initial_balance=initial_balance)
            return JsonResponse(result, safe=False)

        except Exception as e:
            import traceback

            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)


@csrf_exempt
def dslParameterOptimiserStatus(request, job_id):
    job = optimizer_jobs.get(job_id)
    if not job:
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
def dslGeneticOptimiser(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            dsl = body.get("dsl_json", "")
            parameter_choice = body.get("parameter_choice", "")
            initial_balance = body.get("initial_balance", "")
            ga_settings = body.get("ga_settings", {})
            async_mode = body.get("async", False)

            if async_mode:
                job_id = str(uuid.uuid4())
                param_values, _ = build_param_values(dsl, parameter_choice)
                if not param_values:
                    return JsonResponse({"error": "No parameters selected for optimization"}, status=400)
                total_runs = ga_settings.get("population", 20) * ga_settings.get("generations", 10)

                genetic_jobs[job_id] = {
                    "status": "queued",
                    "completed_runs": 0,
                    "total_runs": total_runs,
                    "result": None,
                    "error": None,
                }

                def progress_hook(done, total):
                    genetic_jobs[job_id]["completed_runs"] = done
                    genetic_jobs[job_id]["total_runs"] = total
                    genetic_jobs[job_id]["status"] = "running"

                def run_job():
                    try:
                        result = genetic_optimizer(
                            parsed_dsl=dsl,
                            param_choices=parameter_choice,
                            initial_balance=initial_balance,
                            ga_settings=ga_settings,
                            progress_hook=progress_hook,
                        )
                        genetic_jobs[job_id]["result"] = result
                        genetic_jobs[job_id]["status"] = "completed"
                        genetic_jobs[job_id]["completed_runs"] = genetic_jobs[job_id].get("total_runs", 0)
                    except Exception as e:
                        genetic_jobs[job_id]["error"] = str(e)
                        genetic_jobs[job_id]["status"] = "error"

                threading.Thread(target=run_job, daemon=True).start()
                return JsonResponse({"job_id": job_id, "total_runs": total_runs})

            result = genetic_optimizer(
                parsed_dsl=dsl,
                param_choices=parameter_choice,
                initial_balance=initial_balance,
                ga_settings=ga_settings,
            )
            return JsonResponse(result, safe=False)

        except Exception as e:
            import traceback

            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)


@csrf_exempt
def dslGeneticOptimiserStatus(request, job_id):
    job = genetic_jobs.get(job_id)
    if not job:
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
def registry(request):
    base = Path(__file__).resolve().parent.parent.parent / "backend/core/registries"

    with open(base / "commandRegistry.json") as f:
        commands = json.load(f)

    with open(base / "indicatorRegistry.json") as f:
        indicators = json.load(f)

    with open(base / "argumentsRegistry.json") as f:
        arguments = json.load(f)

    return JsonResponse(
        {
            "commands": commands,
            "indicators": indicators,
            "arguments": arguments,
        }
    )
