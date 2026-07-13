"""Subscription plans — the single source of truth for tier limits.

Phase 1 gates every metered feature against these numbers and lets a plan be
switched manually (staff endpoint / admin). Phase 2 wires Stripe Checkout +
webhooks to flip `UserProfile.plan` automatically; nothing in this file changes.

Metered quotas each carry their own reset ``period`` so different features can
reset on different cadences:
    "ai"        — NL->strategy parsing + the strategy/indicator AI assistants
    "backtest"  — backtest runs
    "optimize"  — optimizer runs (one per optimization request, not per sub-run)

Quota periods:
    "all_time"  — a hard lifetime cap that never resets (used for Free AI so the
                  only way past it is to upgrade)
    "weekly"    — resets every ISO week
    "monthly"   — resets every calendar month

Caps (absolute counts, checked at create time):
    "strategies", "paper_accounts", "custom_indicators"

Optimizer methods:
    "grid"    — parameter / grid search  (dslParameterOptimiser)
    "genetic" — genetic algorithm         (dslGeneticOptimiser)
    "meta"    — metaheuristics (PSO/SA/DE/random)  (dslOptimiser)

A limit of ``None`` means unlimited (fair-use per-minute rate limits in
views.py still apply as abuse protection).
"""

FREE = "free"
PLUS = "plus"
PRO = "pro"

DEFAULT_PLAN = FREE

PLAN_CHOICES = [(FREE, "Free"), (PLUS, "Plus"), (PRO, "Pro")]

UNLIMITED = None

# Quota reset cadences
ALL_TIME = "all_time"
WEEKLY = "weekly"
MONTHLY = "monthly"

# Optimizer method identifiers
GRID = "grid"
GENETIC = "genetic"
META = "meta"


def _q(limit, period):
    """Shorthand for a metered quota entry."""
    return {"limit": limit, "period": period}


PLANS = {
    FREE: {
        "label": "Free",
        "price_usd": 0,
        "quotas": {
            "ai": _q(5, ALL_TIME),          # 5 AI generations, lifetime — upgrade to reset
            "backtest": _q(20, WEEKLY),
            "optimize": _q(5, WEEKLY),
        },
        "caps": {"strategies": 3, "paper_accounts": 1, "custom_indicators": 1},
        # All optimizer methods available on every plan (no method gating).
        "optimizer_methods": [GRID, GENETIC, META],
        "optimize_intensity": 100,        # max backtests inside a single optimization
        "timeframes": ["1D", "1h"],       # allowed execution timeframes ([] / "*" = all)
    },
    PLUS: {
        "label": "Plus",
        "price_usd": 10,
        "quotas": {
            "ai": _q(30, MONTHLY),
            "backtest": _q(30, WEEKLY),
            "optimize": _q(10, WEEKLY),
        },
        "caps": {"strategies": 30, "paper_accounts": 5, "custom_indicators": 15},
        "optimizer_methods": [GRID, GENETIC, META],
        "optimize_intensity": 300,
        "timeframes": "*",
    },
    PRO: {
        "label": "Pro",
        "price_usd": 20,
        "quotas": {
            "ai": _q(100, MONTHLY),
            "backtest": _q(UNLIMITED, WEEKLY),
            "optimize": _q(UNLIMITED, WEEKLY),
        },
        "caps": {
            "strategies": UNLIMITED,
            "paper_accounts": UNLIMITED,
            "custom_indicators": UNLIMITED,
        },
        "optimizer_methods": [GRID, GENETIC, META],
        "optimize_intensity": 1000,
        "timeframes": "*",
    },
}

# Human-readable labels for the UI / error messages.
METRIC_LABELS = {
    "ai": "AI generations",
    "backtest": "backtests",
    "optimize": "optimizer runs",
}
PERIOD_LABELS = {
    ALL_TIME: "all-time",
    WEEKLY: "this week",
    MONTHLY: "this month",
}
CAP_LABELS = {
    "strategies": "saved strategies",
    "paper_accounts": "paper-trading accounts",
    "custom_indicators": "custom indicators",
}
METHOD_LABELS = {GRID: "Grid search", GENETIC: "Genetic", META: "Metaheuristics"}


def plan_config(plan: str) -> dict:
    """Return the config dict for a plan slug, falling back to Free."""
    return PLANS.get(plan, PLANS[DEFAULT_PLAN])


def normalize_plan(plan) -> str:
    slug = str(plan or "").strip().lower()
    return slug if slug in PLANS else DEFAULT_PLAN


def metric_quota(plan: str, metric: str) -> dict:
    """The {limit, period} quota entry for a metric on a plan (empty if none)."""
    return plan_config(plan).get("quotas", {}).get(metric, {})


def metric_limit(plan: str, metric: str):
    return metric_quota(plan, metric).get("limit", UNLIMITED)


def metric_period(plan: str, metric: str) -> str:
    return metric_quota(plan, metric).get("period", MONTHLY)


def min_plan_unlocking(predicate) -> str | None:
    """The cheapest plan whose config satisfies ``predicate(config)`` — used to
    tell the user which upgrade removes the wall they just hit."""
    for slug in (FREE, PLUS, PRO):
        if predicate(PLANS[slug]):
            return slug
    return None
