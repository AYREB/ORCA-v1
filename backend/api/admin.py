from django.contrib import admin

from .models import (
    AIInteractionLog,
    BacktestRun,
    CustomIndicator,
    FeedbackLead,
    OptimizationRun,
    Strategy,
    UsageCounter,
    UserProfile,
)


@admin.register(Strategy)
class StrategyAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "user", "created_at", "updated_at")
    search_fields = ("name", "user__email")
    list_filter = ("created_at",)


@admin.register(BacktestRun)
class BacktestRunAdmin(admin.ModelAdmin):
    list_display = (
        "id", "strategy_name", "user", "source", "pct_change",
        "win_rate", "trades_count", "created_at",
    )
    list_filter = ("source", "created_at")
    search_fields = ("strategy_name", "user__email")
    readonly_fields = ("created_at",)


@admin.register(CustomIndicator)
class CustomIndicatorAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "user", "created_at", "updated_at")
    search_fields = ("name", "user__email")
    list_filter = ("created_at",)


@admin.register(AIInteractionLog)
class AIInteractionLogAdmin(admin.ModelAdmin):
    list_display = (
        "id", "kind", "user", "provider", "model", "success",
        "latency_ms", "total_tokens", "created_at",
    )
    list_filter = ("kind", "provider", "success", "created_at")
    search_fields = ("user__email", "model", "response_text")
    readonly_fields = ("created_at",)


@admin.register(OptimizationRun)
class OptimizationRunAdmin(admin.ModelAdmin):
    list_display = ("id", "method", "algorithm", "user", "total_runs", "created_at")
    list_filter = ("method", "algorithm", "created_at")
    search_fields = ("user__email", "strategy_name")
    readonly_fields = ("created_at",)


@admin.register(FeedbackLead)
class FeedbackLeadAdmin(admin.ModelAdmin):
    list_display = ("id", "email", "user", "source", "created_at")
    list_filter = ("source", "created_at")
    search_fields = ("email", "user__email", "message")
    readonly_fields = ("created_at",)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "plan", "plan_status", "current_period_end", "updated_at")
    list_filter = ("plan", "plan_status")
    search_fields = ("user__email",)
    list_editable = ("plan",)  # flip a user's plan straight from the list


@admin.register(UsageCounter)
class UsageCounterAdmin(admin.ModelAdmin):
    list_display = ("user", "metric", "period", "count", "updated_at")
    list_filter = ("metric", "period")
    search_fields = ("user__email",)
