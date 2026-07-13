import uuid as _uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from . import plans as _plans


class UserProfile(models.Model):
    """Per-user subscription state.

    Phase 1 only reads/writes ``plan`` (switched manually or via the staff
    endpoint). The Stripe fields are added now so Phase 2 (Checkout + webhooks)
    is a drop-in with no migration churn.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    plan = models.CharField(
        max_length=20,
        choices=_plans.PLAN_CHOICES,
        default=_plans.DEFAULT_PLAN,
    )
    # --- Stripe (Phase 2) -------------------------------------------------
    stripe_customer_id = models.CharField(max_length=255, blank=True, default="")
    stripe_subscription_id = models.CharField(max_length=255, blank=True, default="")
    plan_status = models.CharField(max_length=32, blank=True, default="")  # active / past_due / canceled
    current_period_end = models.DateTimeField(null=True, blank=True)
    # ---------------------------------------------------------------------
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"UserProfile({self.user_id}, plan={self.plan})"


class UsageCounter(models.Model):
    """Monthly-resetting usage tally for a metered metric.

    One row per (user, metric, period) where ``period`` is a "YYYY-MM" calendar
    month. A fresh month = a fresh row = the quota resets. Phase 2 can key the
    period on the Stripe billing anniversary instead if desired.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="usage_counters",
    )
    metric = models.CharField(max_length=32)   # "ai" | "backtest" | "optimize"
    # Period key produced by entitlements.period_key(): "all" (lifetime),
    # "YYYY-Www" (weekly) or "YYYY-MM" (monthly), depending on the metric's cadence.
    period = models.CharField(max_length=16)
    count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "metric", "period")
        indexes = [models.Index(fields=["user", "metric", "period"])]

    def __str__(self):
        return f"UsageCounter({self.user_id}, {self.metric}, {self.period}={self.count})"


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


class CustomIndicator(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="custom_indicators")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    parameters = models.JSONField(default=list, blank=True)
    code = models.TextField(blank=True)
    last_test_result = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "name")
        ordering = ["-updated_at"]

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
    # --- Full input capture (reproducibility + future training) -----------
    # The exact strategy definition + run config that produced this result, so
    # every recorded backtest can be replayed or mined later without guessing.
    dsl_json = models.JSONField(blank=True, null=True)
    dsl_text = models.TextField(blank=True, default="")
    config = models.JSONField(default=dict, blank=True)   # tickers, timeframe, dates, initial_balance, ...
    result = models.JSONField(blank=True, null=True)       # full engine result payload
    source = models.CharField(max_length=32, blank=True, default="")  # manual | text | optimizer | assistant
    # ---------------------------------------------------------------------
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "created_at"])]

    def __str__(self):
        name = self.strategy_name or (self.strategy.name if self.strategy else "Backtest")
        return f"{name} - {self.user.email} ({self.created_at.date()})"


class StrategyConversation(models.Model):
    """Tracks multi-turn strategy building conversations"""
    user = models.ForeignKey(
        'auth.User',
        on_delete=models.CASCADE,
        related_name='strategy_conversations'
    )
    session_id = models.CharField(max_length=64, unique=True)
    turns = models.JSONField(default=list)
    partial_strategy = models.JSONField(null=True, blank=True)
    missing_fields = models.JSONField(default=list)
    status = models.CharField(
        max_length=20,
        choices=[
            ('in_progress', 'In Progress'),
            ('complete', 'Complete'),
            ('abandoned', 'Abandoned'),
        ],
        default='in_progress'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def add_turn(self, role, content):
        self.turns.append({
            "role": role,
            "content": content,
            "timestamp": timezone.now().isoformat()
        })
        self.save(update_fields=["turns", "updated_at"])

    def get_conversation_history(self):
        return [
            {"role": t["role"], "content": t["content"]}
            for t in self.turns
        ]

    class Meta:
        ordering = ['-created_at']

class StrategyQueryLog(models.Model):
    """
    Logs every query sent to the strategy parser.
    Used for retraining and improving the model over time.
    """
    user = models.ForeignKey(
        'auth.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='query_logs'
    )
    # The raw input from the user
    raw_input = models.TextField()
    
    # The full conversation history (for multi-turn)
    conversation_history = models.JSONField(default=list)
    
    # What the model output
    model_output = models.JSONField(null=True, blank=True)
    
    # Whether it succeeded or needed clarification
    status = models.CharField(
        max_length=20,
        choices=[
            ('complete', 'Complete'),
            ('clarify', 'Clarify'),
            ('failed', 'Failed'),
            ('non_strategy', 'Non Strategy'),
        ],
        default='complete'
    )
    
    # Validation errors if any
    errors = models.JSONField(default=list)
    
    # How many turns it took
    turns_taken = models.IntegerField(default=1)
    
    # Was this a multi-turn conversation
    session_id = models.CharField(max_length=64, null=True, blank=True)
    
    # Track which field was missing if clarification needed
    missing_field = models.CharField(max_length=50, null=True, blank=True)

    # ---- Post-parse outcome (the "did the user agree with the parse?" signal) ----
    # None = user never ran it (abandoned); True = ran the backtest.
    ran_backtest = models.BooleanField(null=True, blank=True)
    # Which fields the user corrected on the review card before running
    # (e.g. ["timeframe", "stopLoss"]). Empty list + ran_backtest=True is the
    # strongest "the model got it right" signal available.
    edited_fields = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class PaperAccountState(models.Model):
    """
    Server-side persistence for a user's paper-trading workspace.

    The frontend manages a rich, evolving shape (accounts -> applied strategies,
    runs, equity history), so we store the whole workspace as one JSON document
    per user rather than normalising it into many tables. This keeps the client
    the single source of truth for shape while guaranteeing the data survives
    browser clears and follows the user across devices.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="paper_account_state",
    )
    accounts = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        count = len(self.accounts) if isinstance(self.accounts, list) else 0
        return f"PaperAccountState({self.user_id}, {count} accounts)"


class PasswordResetToken(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="password_reset_tokens",
    )
    token = models.UUIDField(default=_uuid.uuid4, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    used = models.BooleanField(default=False)

    def is_valid(self) -> bool:
        age = (timezone.now() - self.created_at).total_seconds()
        return not self.used and age < 3600  # 1-hour window

    def __str__(self):
        return f"PasswordResetToken({self.user.email}, used={self.used})"


class AIInteractionLog(models.Model):
    """Durable record of every AI prompt/response and how it performed.

    One row per model call across all AI surfaces (the strategy/indicator
    assistants and the NL->strategy parser). Captures the full input (system
    prompt + context + messages) and the output plus performance signals
    (latency, tokens, success/error). Stored verbatim so the data can later be
    viewed, audited, and mined/curated into training sets — pair it with the
    ``export_ai_interactions`` management command.
    """

    KIND_CHOICES = [
        ("strategy_assistant", "Strategy Assistant"),
        ("indicator_assistant", "Indicator Assistant"),
        ("nl_parse", "NL Strategy Parse"),
        ("nl_chat", "NL Strategy Chat"),
        ("other", "Other"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_interactions",
    )
    kind = models.CharField(max_length=32, choices=KIND_CHOICES, default="other")
    provider = models.CharField(max_length=32, blank=True, default="")   # openai | ollama | modal | ...
    model = models.CharField(max_length=120, blank=True, default="")

    # --- Full input ------------------------------------------------------
    system_prompt = models.TextField(blank=True, default="")
    context_text = models.TextField(blank=True, default="")
    messages = models.JSONField(default=list, blank=True)   # [{role, content}, ...]
    request_meta = models.JSONField(default=dict, blank=True)  # strategy/indicator context, mode, etc.

    # --- Output ----------------------------------------------------------
    response_text = models.TextField(blank=True, default="")
    response_meta = models.JSONField(default=dict, blank=True)  # raw finish reason, mode, etc.

    # --- Performance / quality signals -----------------------------------
    success = models.BooleanField(default=True)
    error = models.TextField(blank=True, default="")
    latency_ms = models.IntegerField(null=True, blank=True)
    prompt_tokens = models.IntegerField(null=True, blank=True)
    completion_tokens = models.IntegerField(null=True, blank=True)
    total_tokens = models.IntegerField(null=True, blank=True)
    # Optional post-hoc quality label (thumbs up/down, edits, etc.) for curation.
    user_rating = models.SmallIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["kind", "created_at"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self):
        who = self.user.email if self.user else "anon"
        return f"AIInteractionLog({self.kind}, {who}, ok={self.success})"


class OptimizationRun(models.Model):
    """Durable record of an optimizer run: what was optimized, the winning
    strategy, and the results — so the admin can inspect every optimization and
    the data can be mined later.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="optimization_runs",
    )
    method = models.CharField(max_length=16)                       # grid | genetic | meta
    algorithm = models.CharField(max_length=32, blank=True, default="")  # pso|annealing|differential|random
    strategy_name = models.CharField(max_length=255, blank=True, default="")

    input_dsl = models.JSONField(blank=True, null=True)            # base strategy that was optimized
    parameter_space = models.JSONField(default=dict, blank=True)   # what was optimized (parameter_choice)
    config = models.JSONField(default=dict, blank=True)            # initial_balance, tickers, etc.

    best_params = models.JSONField(blank=True, null=True)          # winning parameter values
    best_dsl = models.JSONField(blank=True, null=True)             # resulting optimized strategy
    best_result = models.JSONField(blank=True, null=True)          # metrics of the winner
    top_results = models.JSONField(default=list, blank=True)       # leaderboard (capped)

    total_runs = models.IntegerField(default=0)
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "created_at"]),
            models.Index(fields=["method", "created_at"]),
        ]

    def __str__(self):
        who = self.user.email if self.user else "anon"
        return f"OptimizationRun({self.method}, {who}, {self.created_at.date()})"


class FeedbackLead(models.Model):
    """Email captured from the 'give feedback for discounts/giveaways' CTA on the
    Plans page, plus any message left. Stored server-side so the list can be
    exported and followed up on later."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feedback_leads",
    )
    email = models.EmailField()
    message = models.TextField(blank=True, default="")
    source = models.CharField(max_length=64, blank=True, default="plans_page")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["email", "created_at"])]

    def __str__(self):
        return f"FeedbackLead({self.email}, {self.source})"
