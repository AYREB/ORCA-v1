from django.contrib import admin

from .models import Strategy, UserProfile, UsageCounter


@admin.register(Strategy)
class StrategyAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "user", "created_at", "updated_at")
    search_fields = ("name", "user__email")
    list_filter = ("created_at",)


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
