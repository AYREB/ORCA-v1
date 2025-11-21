# backend/api/views.py
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json
from core.main import main

@csrf_exempt
def backtest(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            dsl = body.get("dsl", "")

            # main() will now return a dict, not a string
            result = main(dsl)

            return JsonResponse(result, safe=False)  
            # safe=False allows returning lists or dicts freely

        except Exception as e:
            import traceback
            traceback.print_exc()
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)
