# backend/api/views.py
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json
from core.main import main

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json
from core.main import main

@csrf_exempt
def backtest(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            dsl = data.get("dsl", "")
            result = main(dsl)
            return JsonResponse({"message": result})
        except Exception as e:
            import traceback
            traceback.print_exc()  # print full error in console
            return JsonResponse({"message": str(e)}, status=500)
    return JsonResponse({"message": "Invalid request"}, status=400)
