from django.urls import path
from django.http import JsonResponse
from . import views

def health(request):
    return JsonResponse({"status": "ok"})

urlpatterns = [
    path("health/", health),
    path("backtestDSLText/", views.backtestDSLText),
    path("backtestDSLJSON/", views.backtestDSLJSON),
    path("dslParameterOptimiser/", views.dslParameterOptimiser),
    path("registry/", views.registry),
]
