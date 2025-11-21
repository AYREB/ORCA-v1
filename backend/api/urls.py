# backend/api/urls.py
from django.urls import path
from .views import backtest

urlpatterns = [
    path("backtest/", backtest, name="backtest"),
]
