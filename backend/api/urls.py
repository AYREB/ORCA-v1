from django.urls import path
from .views import backtest, registry  # import registry view

urlpatterns = [
    path("backtest/", backtest, name="backtest"),
    path("registry/", registry, name="registry"),  # add this line
]
