from django.http import JsonResponse
from django.urls import path

from . import views


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("health/", health),
    path("register/", views.register),
    path("login/", views.login),
    path("me/", views.me),
    path("strategies/", views.strategies),
    path("strategies/<int:strategy_id>/", views.strategy_detail),
    path("backtestDSLText/", views.backtestDSLText),
    path("backtestDSLJSON/", views.backtestDSLJSON),
    path("dslParameterOptimiser/", views.dslParameterOptimiser),
    path("registry/", views.registry),
]
