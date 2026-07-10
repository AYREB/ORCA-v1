"""Subscription plans — the single source of truth for tier limits.

Phase 1 gates every metered feature against these numbers and lets a plan be
switched manually (staff endpoint / admin). Phase 2 wires Stripe Checkout +
webhooks to flip `UserProfile.plan` automatically; nothing in this file changes.

Metrics (monthly-resetting usage quotas):
    "ai"        — NL->strategy parsing + the strategy/indicator AI assistants
    "backtest"  — backtest runs
    "optimize"  — optimizer runs (one per optimization request, not per sub-run)

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

# Optimizer method identifiers
GRID = "grid"
GENETIC = "genetic"
META = "meta"

PLANS = {
    FREE: {
        "label": "Free",
        "price_usd": 0,
        "monthly": {"ai": 3, "backtest": 15, "optimize": 3},
        "caps": {"strategies": 3, "paper_accounts": 1, "custom_indicators": 1},
        "optimizer_methods": [GRID],
        "optimize_intensity": 100,        # max backtests inside a single optimization
        "timeframes": ["1D", "1h"],       # allowed execution timeframes ([] / "*" = all)
    },
    PLUS: {
        "label": "Plus",
        "price_usd": 10,
        "monthly": {"ai": 150, "backtest": 300, "optimize": 40},
        "caps": {"strategies": 30, "paper_accounts": 5, "custom_indicators": 15},
        "optimizer_methods": [GRID, GENETIC],
        "optimize_intensity": 300,
        "timeframes": "*",
    },
    PRO: {
        "label": "Pro",
        "price_usd": 20,
        "monthly": {"ai": UNLIMITED, "backtest": UNLIMITED, "optimize": UNLIMITED},
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


def min_plan_unlocking(predicate) -> str | None:
    """The cheapest plan whose config satisfies ``predicate(config)`` — used to
    tell the user which upgrade removes the wall they just hit."""
    for slug in (FREE, PLUS, PRO):
        if predicate(PLANS[slug]):
            return slug
    return None
