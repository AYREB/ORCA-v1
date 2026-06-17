from django.http import JsonResponse
from django.urls import path

from . import views


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("health/", health),
    path("register/", views.register),
    path("login/", views.login),
    path("login/google/", views.google_login),
    path("logout/", views.logout),
    path("me/", views.me),
    path("delete-account/", views.delete_account),
    path("change-password/", views.change_password),
    path("forgot-password/", views.forgot_password),
    path("reset-password/", views.reset_password),
    path("strategies/", views.strategies),
    path("strategies/<int:strategy_id>/", views.strategy_detail),
    path("custom-indicators/", views.custom_indicators),
    path("custom-indicators/test/", views.custom_indicator_test),
    path("custom-indicators/guide/", views.custom_indicator_guide),
    path("custom-indicators/<int:indicator_id>/", views.custom_indicator_detail),
    path("indicator-assistant/chat/", views.indicator_assistant_chat),
    path("backtestDSLText/", views.backtestDSLText),
    path("backtestDSLJSON/", views.backtestDSLJSON),
    path("dslParameterOptimiser/", views.dslParameterOptimiser),
    path("dslParameterOptimiser/status/<str:job_id>/", views.dslParameterOptimiserStatus),
    path("dslGeneticOptimiser/", views.dslGeneticOptimiser),
    path("dslGeneticOptimiser/status/<str:job_id>/", views.dslGeneticOptimiserStatus),
    path("dslOptimiser/", views.dslOptimiser),
    path("dslOptimiser/status/<str:job_id>/", views.dslOptimiserStatus),
    path("registry/", views.registry),
    path("strategy-assistant/chat/", views.strategy_assistant_chat),
    path("strategy-assistant/market-data/", views.strategy_assistant_market_data),
    path("dashboard/summary/", views.dashboard_summary),
    path("chart-data/", views.chart_data),
    path("backtest-runs/", views.backtest_runs),
    path("backtest-runs/<int:run_id>/", views.backtest_run_detail),
    path("paper-accounts/", views.paper_accounts),
    path("strategy-to-dsl/", views.strategy_to_dsl),
    path('strategy/chat/', views.strategy_chat),
]
