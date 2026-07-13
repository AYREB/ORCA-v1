"""Runtime plan enforcement — the bridge between plans.py and the views.

Views call these helpers to gate metered features:

    consume_quota(user, "backtest")        # atomically reserve one use, else raise 402
    refund_quota(user, "backtest")         # give it back if the metered work then failed
    enforce_count_cap(user, "strategies", current_count)

Always enforce a quota with ``consume_quota`` (a concurrency-safe reserve),
NOT the older ``check_quota`` + ``record_usage`` pair — that read-then-increment
has a race that lets parallel requests overshoot the limit. ``check_quota`` remains
only as a cheap soft pre-check for friendly early failures.
    enforce_optimizer_method(user, "genetic")
    optimize_intensity_cap(user)           # max backtests allowed in one optimization
    plan_summary(user)                     # plan + limits + usage, for /api/plan/

Each metered metric resets on its own cadence (see plans.py): Free AI is an
all-time lifetime cap, backtests/optimizer runs reset weekly, and paid AI resets
monthly. ``period_key`` maps a metric's cadence to the string stored on the
``UsageCounter`` row, so a new week/month/lifetime naturally starts a fresh row.

A ``PlanLimitError`` is a 402 that the view error boundary renders as JSON with
an ``upgrade`` hint so the frontend can show an "upgrade to unlock" prompt.
"""

from __future__ import annotations

from django.db.models import F
from django.utils import timezone

from . import plans


class PlanLimitError(Exception):
    """User hit a plan wall. Rendered as HTTP 402 with an upgrade hint."""

    def __init__(self, message: str, *, current_plan: str, upgrade_to: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = 402
        self.code = "plan_limit"
        self.current_plan = current_plan
        self.upgrade_to = upgrade_to

    def to_dict(self) -> dict:
        return {
            "error": self.message,
            "code": self.code,
            "current_plan": self.current_plan,
            "upgrade_to": self.upgrade_to,
        }


def enforcement_enabled() -> bool:
    """Master switch (settings.PLAN_ENFORCEMENT). False on QA/staging makes
    every gate below a no-op so testing isn't blocked by Free-tier limits."""
    from django.conf import settings

    return bool(getattr(settings, "PLAN_ENFORCEMENT", True))


def period_key(period: str) -> str:
    """Map a quota cadence to the ``UsageCounter.period`` string it counts under.

    all_time -> "all"           (one row forever — a lifetime cap)
    weekly   -> "2026-W28"      (ISO year + week — resets every week)
    monthly  -> "2026-07"       (calendar month — resets every month)
    """
    now = timezone.now()
    if period == plans.ALL_TIME:
        return "all"
    if period == plans.WEEKLY:
        return now.strftime("%G-W%V")
    return now.strftime("%Y-%m")


def current_period() -> str:
    """Legacy calendar-month key, kept for the /api/plan/ ``period`` field."""
    return period_key(plans.MONTHLY)


def get_profile(user):
    """Fetch (or lazily create) the user's profile. New users default to Free."""
    from .models import UserProfile

    profile, _ = UserProfile.objects.get_or_create(user=user)
    return profile


def plan_of(user) -> str:
    if user is None:
        return plans.DEFAULT_PLAN
    return plans.normalize_plan(get_profile(user).plan)


def config_of(user) -> dict:
    return plans.plan_config(plan_of(user))


# --------------------------------------------------------------------------
# Metered usage quotas (per-metric reset cadence)
# --------------------------------------------------------------------------
def metric_period_of(user, metric: str) -> str:
    return plans.metric_period(plan_of(user), metric)


def monthly_limit(user, metric: str):
    """The user's current allowance for ``metric`` (None = unlimited)."""
    if not enforcement_enabled():
        return plans.UNLIMITED
    return plans.metric_limit(plan_of(user), metric)


def usage_count(user, metric: str) -> int:
    from .models import UsageCounter

    row = UsageCounter.objects.filter(
        user=user, metric=metric, period=period_key(metric_period_of(user, metric))
    ).first()
    return row.count if row else 0


def _quota_exceeded_error(user, metric: str, limit: int) -> "PlanLimitError":
    plan = plan_of(user)
    label = plans.METRIC_LABELS.get(metric, metric)
    period = plans.metric_period(plan, metric)
    window = plans.PERIOD_LABELS.get(period, "this month")
    upgrade = plans.min_plan_unlocking(
        lambda cfg, m=metric, l=limit: _allows_more(cfg, m, l)
    )
    return PlanLimitError(
        f"You've used all {limit} {label} {window} on the "
        f"{plans.plan_config(plan)['label']} plan. Upgrade for more.",
        current_plan=plan,
        upgrade_to=upgrade,
    )


def check_quota(user, metric: str) -> None:
    """Raise if the user has no allowance left for ``metric``.

    This is only a *soft* pre-check for a fast, friendly failure. It is NOT the
    authoritative gate — a read here followed by a later ``record_usage`` has a
    check-then-act race that lets concurrent requests all slip past the same
    remaining allowance. Use ``consume_quota`` (atomic reserve) to actually
    enforce the limit.
    """
    limit = monthly_limit(user, metric)
    if limit is None:  # unlimited
        return
    if usage_count(user, metric) >= limit:
        raise _quota_exceeded_error(user, metric, limit)


def consume_quota(user, metric: str, n: int = 1) -> None:
    """Atomically reserve ``n`` uses of ``metric``, raising 402 if that would
    exceed the current allowance.

    Concurrency-safe: the reservation is a single conditional ``UPDATE ... WHERE
    count <= limit - n`` that the database serializes on the counter row, so
    parallel requests can never both consume the last unit of quota (the
    check-then-act window that ``check_quota`` + ``record_usage`` leaves open).
    Reserve BEFORE doing the metered work; if that work then fails, call
    ``refund_quota`` so the user isn't charged for it.
    """
    limit = monthly_limit(user, metric)
    if limit is None:  # unlimited
        return
    from .models import UsageCounter

    period = period_key(metric_period_of(user, metric))
    UsageCounter.objects.get_or_create(user=user, metric=metric, period=period)
    reserved = UsageCounter.objects.filter(
        user=user, metric=metric, period=period, count__lte=limit - n
    ).update(count=F("count") + n)
    if not reserved:
        raise _quota_exceeded_error(user, metric, limit)


def refund_quota(user, metric: str, n: int = 1) -> None:
    """Return ``n`` previously-reserved uses of ``metric`` (metered work failed).

    Clamps at zero so a double refund or a period rollover can't drive the
    counter negative.
    """
    from .models import UsageCounter

    period = period_key(metric_period_of(user, metric))
    UsageCounter.objects.filter(
        user=user, metric=metric, period=period, count__gte=n
    ).update(count=F("count") - n)


def _allows_more(cfg: dict, metric: str, current_limit: int) -> bool:
    """True if ``cfg``'s allowance for ``metric`` beats current_limit
    (or is unlimited) — used to find the cheapest unlocking plan."""
    lim = cfg.get("quotas", {}).get(metric, {}).get("limit", plans.UNLIMITED)
    return lim is None or lim > current_limit


def record_usage(user, metric: str, n: int = 1) -> None:
    """Tally ``n`` uses of ``metric`` in the current period. Call AFTER the
    metered work succeeds so failures aren't charged against the quota."""
    from .models import UsageCounter

    period = period_key(metric_period_of(user, metric))
    obj, created = UsageCounter.objects.get_or_create(
        user=user, metric=metric, period=period, defaults={"count": n}
    )
    if not created:
        UsageCounter.objects.filter(pk=obj.pk).update(count=F("count") + n)


# --------------------------------------------------------------------------
# Absolute count caps (strategies / paper accounts / custom indicators)
# --------------------------------------------------------------------------
def count_cap(user, resource: str):
    if not enforcement_enabled():
        return plans.UNLIMITED
    return config_of(user).get("caps", {}).get(resource, plans.UNLIMITED)


def enforce_count_cap(user, resource: str, current_count: int) -> None:
    """Raise if creating one more ``resource`` would exceed the plan cap."""
    enforce_total_count(user, resource, current_count + 1)


def enforce_total_count(user, resource: str, total: int) -> None:
    """Raise if a resource total (e.g. the whole paper-account list on a bulk
    save) would exceed the plan cap."""
    cap = count_cap(user, resource)
    if cap is None:  # unlimited
        return
    if total > cap:
        plan = plan_of(user)
        label = plans.CAP_LABELS.get(resource, resource)
        upgrade = plans.min_plan_unlocking(
            lambda cfg, r=resource, c=cap: _cap_allows_more(cfg, r, c)
        )
        raise PlanLimitError(
            f"The {plans.plan_config(plan)['label']} plan allows up to "
            f"{cap} {label}. Upgrade to add more.",
            current_plan=plan,
            upgrade_to=upgrade,
        )


def _cap_allows_more(cfg: dict, resource: str, current_cap: int) -> bool:
    cap = cfg.get("caps", {}).get(resource, plans.UNLIMITED)
    return cap is None or cap > current_cap


# --------------------------------------------------------------------------
# Optimizer method + intensity gating
# --------------------------------------------------------------------------
def allowed_optimizer_methods(user) -> list:
    return list(config_of(user).get("optimizer_methods", []))


def enforce_optimizer_method(user, method: str) -> None:
    if not enforcement_enabled():
        return
    if method in allowed_optimizer_methods(user):
        return
    plan = plan_of(user)
    label = plans.METHOD_LABELS.get(method, method)
    upgrade = plans.min_plan_unlocking(
        lambda cfg, m=method: m in cfg.get("optimizer_methods", [])
    )
    raise PlanLimitError(
        f"The {label} optimizer isn't available on the "
        f"{plans.plan_config(plan)['label']} plan. Upgrade to unlock it.",
        current_plan=plan,
        upgrade_to=upgrade,
    )


def optimize_intensity_cap(user) -> int:
    return int(config_of(user).get("optimize_intensity", 100))


def enforce_optimize_intensity(user, total_runs: int) -> None:
    """Reject an optimization that would run more backtests than the plan allows."""
    if not enforcement_enabled():
        return
    cap = optimize_intensity_cap(user)
    if total_runs > cap:
        plan = plan_of(user)
        upgrade = plans.min_plan_unlocking(
            lambda cfg, t=total_runs: cfg.get("optimize_intensity", 0) >= t
        )
        raise PlanLimitError(
            f"This optimization would run {total_runs} backtests, over the "
            f"{plans.plan_config(plan)['label']} plan's limit of {cap}. "
            f"Reduce the parameter grid / population×generations, or upgrade.",
            current_plan=plan,
            upgrade_to=upgrade,
        )


# --------------------------------------------------------------------------
# Summary for the frontend (/api/plan/ and /api/me/)
# --------------------------------------------------------------------------
def _quota_view(cfg: dict) -> dict:
    """Serialize a plan's quotas as {metric: {limit, period}} for the frontend."""
    return {
        metric: {"limit": q.get("limit"), "period": q.get("period", plans.MONTHLY)}
        for metric, q in cfg.get("quotas", {}).items()
    }


def plan_summary(user) -> dict:
    """Everything the UI needs: current plan, its limits, and usage this period."""
    plan = plan_of(user)
    cfg = plans.plan_config(plan)
    period = current_period()

    usage = {m: usage_count(user, m) for m in cfg.get("quotas", {})}

    if not enforcement_enabled():
        # QA/staging: report what is actually enforced (nothing), so the
        # frontend doesn't render upgrade walls the backend would never raise.
        pro = plans.PLANS[plans.PRO]
        return {
            "plan": plan,
            "label": cfg["label"],
            "price_usd": cfg["price_usd"],
            "period": period,
            "limits": {
                "quotas": {
                    m: {"limit": plans.UNLIMITED, "period": q.get("period", plans.MONTHLY)}
                    for m, q in cfg.get("quotas", {}).items()
                },
                "caps": {c: plans.UNLIMITED for c in cfg.get("caps", {})},
                "optimizer_methods": pro["optimizer_methods"],
                "optimize_intensity": pro["optimize_intensity"],
                "timeframes": "*",
            },
            "usage": usage,
        }

    return {
        "plan": plan,
        "label": cfg["label"],
        "price_usd": cfg["price_usd"],
        "period": period,
        "limits": {
            "quotas": _quota_view(cfg),
            "caps": cfg.get("caps", {}),
            "optimizer_methods": cfg.get("optimizer_methods", []),
            "optimize_intensity": cfg.get("optimize_intensity"),
            "timeframes": cfg.get("timeframes"),
        },
        "usage": usage,
    }


def all_plans_public() -> list:
    """The full pricing table, for the marketing/Plans page."""
    out = []
    for slug in (plans.FREE, plans.PLUS, plans.PRO):
        cfg = plans.PLANS[slug]
        out.append({
            "plan": slug,
            "label": cfg["label"],
            "price_usd": cfg["price_usd"],
            "quotas": _quota_view(cfg),
            "caps": cfg["caps"],
            "optimizer_methods": cfg["optimizer_methods"],
            "optimize_intensity": cfg["optimize_intensity"],
            "timeframes": cfg["timeframes"],
        })
    return out
