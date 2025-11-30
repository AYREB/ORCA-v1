# backend/api/views.py
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json
from core.main import dslJSONBacktest,dslTextToJsonBacktest

@csrf_exempt
def backtestDSLText(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            dsl = body.get("dsl_text", "")

            # main() will now return a dict, not a string
            result = dslTextToJsonBacktest(dsl)

            return JsonResponse(result, safe=False)  
            # safe=False allows returning lists or dicts freely

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

            print(dsl)
            # main() will now return a dict, not a string
            result = dslJSONBacktest(dsl)

            return JsonResponse(result, safe=False)  
            # safe=False allows returning lists or dicts freely

        except Exception as e:
            import traceback
            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)


def registry(request):
    from pathlib import Path
    import json

    base = Path(__file__).resolve().parent.parent.parent / "backend/core/registries"

    with open(base / "commandRegistry.json") as f:
        commands = json.load(f)

    with open(base / "indicatorRegistry.json") as f:
        indicators = json.load(f)

    with open(base / "argumentsRegistry.json") as f:
        arguments = json.load(f)

    return JsonResponse({
        "commands": commands,
        "indicators": indicators,
        "arguments": arguments
    })

