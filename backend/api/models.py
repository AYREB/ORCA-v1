from django.conf import settings
from django.db import models


class Strategy(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="strategies")
    name = models.CharField(max_length=255)
    dsl_text = models.TextField(blank=True)
    dsl_json = models.JSONField(blank=True, null=True)
    last_result = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_run_at = models.DateTimeField(blank=True, null=True)

    def __str__(self):
        return f"{self.name} ({self.user.email})"


class BacktestRun(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="backtest_runs")
    strategy = models.ForeignKey(
        Strategy, on_delete=models.SET_NULL, null=True, blank=True, related_name="backtest_runs"
    )
    strategy_name = models.CharField(max_length=255, blank=True)
    pct_change = models.FloatField()
    final_balance = models.FloatField()
    cash = models.FloatField()
    invested = models.FloatField()
    trades_count = models.IntegerField(default=0)
    winning_trades = models.IntegerField(default=0)
    losing_trades = models.IntegerField(default=0)
    win_rate = models.FloatField(default=0)
    equity_curve = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        name = self.strategy_name or (self.strategy.name if self.strategy else "Backtest")
        return f"{name} - {self.user.email} ({self.created_at.date()})"
