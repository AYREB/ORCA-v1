"""Tests for the admin conversion funnel (/api/admin/funnel/) and the
AI parser quality board (/api/admin/ai-quality/)."""

import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from .models import BacktestRun, PageView, StrategyQueryLog

User = get_user_model()


def make_run(user, days_ago=0):
    run = BacktestRun.objects.create(
        user=user, pct_change=1.0, final_balance=10100, cash=10100, invested=0)
    if days_ago:
        BacktestRun.objects.filter(id=run.id).update(
            created_at=timezone.now() - timedelta(days=days_ago))
    return run


class AdminInsightsTestBase(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            username="admin", email="admin@orca.com", password="pw12345!", is_superuser=True)
        self.token = Token.objects.create(user=self.admin)

    def get(self, path):
        return self.client.get(path, HTTP_AUTHORIZATION=f"Token {self.token.key}")


class AdminFunnelTests(AdminInsightsTestBase):
    def test_requires_superuser(self):
        pleb = User.objects.create_user(username="p", email="p@x.com", password="pw12345!")
        token = Token.objects.create(user=pleb)
        resp = self.client.get("/api/admin/funnel/", HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(resp.status_code, 403)

    def test_funnel_stages(self):
        # 2 anonymous visitors.
        PageView.objects.create(anon_id="a" * 8, session_id="s1", path="/")
        PageView.objects.create(anon_id="b" * 8, session_id="s2", path="/")
        # 3 signups in window: one never ran, one ran once, one ran on 2 days.
        u1 = User.objects.create_user(username="u1", email="u1@x.com", password="pw12345!")
        u2 = User.objects.create_user(username="u2", email="u2@x.com", password="pw12345!")
        User.objects.create_user(username="u3", email="u3@x.com", password="pw12345!")
        make_run(u1)
        make_run(u2)
        make_run(u2, days_ago=2)
        # Superuser (self.admin) must not count as a signup.

        data = json.loads(self.get("/api/admin/funnel/?days=30").content)
        stages = {s["key"]: s for s in data["stages"]}
        self.assertEqual(stages["visitors"]["count"], 2)
        self.assertEqual(stages["signups"]["count"], 3)
        self.assertEqual(stages["activated"]["count"], 2)
        self.assertEqual(stages["retained"]["count"], 1)
        self.assertAlmostEqual(data["signup_to_activated"], 2 / 3, places=3)
        self.assertAlmostEqual(data["activated_to_retained"], 0.5, places=3)


class AdminAiQualityTests(AdminInsightsTestBase):
    def test_quality_metrics(self):
        u = User.objects.create_user(username="u4", email="u4@x.com", password="pw12345!")
        # 3 complete: one ran clean, one ran with edits, one abandoned.
        StrategyQueryLog.objects.create(
            user=u, raw_input="buy aapl rsi<30", status="complete",
            ran_backtest=True, edited_fields=[])
        StrategyQueryLog.objects.create(
            user=u, raw_input="long tsla sma cross", status="complete",
            ran_backtest=True, edited_fields=["timeframe", "stopLoss"])
        StrategyQueryLog.objects.create(
            user=u, raw_input="short spy macd", status="complete")
        # 1 clarify (missing timeframe), 1 failed, 1 non_strategy.
        StrategyQueryLog.objects.create(
            user=u, raw_input="buy the dip", status="clarify", missing_field="timeframe")
        StrategyQueryLog.objects.create(
            user=u, raw_input="???", status="failed", errors=["could not parse"])
        StrategyQueryLog.objects.create(
            user=u, raw_input="hello", status="non_strategy")

        data = json.loads(self.get("/api/admin/ai-quality/?days=30").content)
        t = data["totals"]
        self.assertEqual(t["attempts"], 5)          # non_strategy excluded
        self.assertEqual(t["complete"], 3)
        self.assertEqual(t["clarify"], 1)
        self.assertEqual(t["failed"], 1)
        self.assertEqual(t["non_strategy"], 1)
        self.assertAlmostEqual(t["parse_success_rate"], 3 / 5, places=3)
        self.assertEqual(t["ran"], 2)
        self.assertEqual(t["ran_clean"], 1)
        self.assertEqual(t["edited_then_ran"], 1)
        self.assertEqual(t["abandoned"], 1)
        self.assertAlmostEqual(t["clean_run_rate"], 0.5, places=3)

        self.assertEqual(data["corrected_fields"], {"timeframe": 1, "stopLoss": 1})
        self.assertEqual(data["missing_fields"], {"timeframe": 1})

        statuses = {p["status"] for p in data["problems"]}
        self.assertEqual(statuses, {"failed", "clarify"})
        prompts = {p["prompt"] for p in data["problems"]}
        self.assertIn("???", prompts)

    def test_empty_window_returns_nulls_not_errors(self):
        data = json.loads(self.get("/api/admin/ai-quality/?days=7").content)
        self.assertIsNone(data["totals"]["parse_success_rate"])
        self.assertIsNone(data["totals"]["clean_run_rate"])
        self.assertEqual(data["problems"], [])


class AdminAiCostsTests(AdminInsightsTestBase):
    def test_cost_model_per_provider(self):
        from .models import AIInteractionLog
        u = User.objects.create_user(username="c1", email="c1@x.com", password="pw12345!")
        # Modal: 10 GPU-seconds at the default rate.
        AIInteractionLog.objects.create(
            user=u, kind="nl_parse", provider="modal", latency_ms=10_000, success=True)
        # OpenAI: 1M input + 1M output tokens at default rates -> 0.15 + 0.60.
        AIInteractionLog.objects.create(
            user=u, kind="indicator_assistant", provider="openai", success=True,
            prompt_tokens=1_000_000, completion_tokens=1_000_000, total_tokens=2_000_000)
        # Ollama: free.
        AIInteractionLog.objects.create(
            user=u, kind="indicator_assistant", provider="ollama", success=True,
            total_tokens=500, latency_ms=2000)

        data = json.loads(self.get("/api/admin/ai-costs/?days=30").content)
        self.assertEqual(data["totals"]["calls"], 3)
        self.assertEqual(data["totals"]["tokens"], 2_000_500)
        self.assertAlmostEqual(data["by_provider"]["modal"]["cost"], 10 * 0.000306, places=4)
        self.assertAlmostEqual(data["by_provider"]["openai"]["cost"], 0.75, places=4)
        self.assertEqual(data["by_provider"]["ollama"]["cost"], 0)
        self.assertAlmostEqual(
            data["totals"]["cost"], 10 * 0.000306 + 0.75, places=4)
        self.assertEqual(data["top_users"][0]["email"], "c1@x.com")
        self.assertIn("modal_gpu_per_second", data["rates"])

    def test_requires_superuser(self):
        pleb = User.objects.create_user(username="c2", email="c2@x.com", password="pw12345!")
        token = Token.objects.create(user=pleb)
        resp = self.client.get("/api/admin/ai-costs/", HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(resp.status_code, 403)


class AdminStrategyInsightsTests(AdminInsightsTestBase):
    def test_mines_dsl_for_usage_and_performance(self):
        u = User.objects.create_user(username="s1", email="s1@x.com", password="pw12345!")
        dsl = {
            "LONG": {
                "context": {"tickers": ["AAPL", "MSFT"], "execution_timeframe": "1h"},
                "OPEN": {"CONDITIONS": {
                    "left": {"func": "RSI", "arg": {"period": 14, "timeframe": "1h"}},
                    "operator": "<", "right": {"value": 30}}},
                # Same indicator twice in one run must still count once.
                "CLOSE": {"CONDITIONS": {
                    "left": {"func": "RSI", "arg": {"period": 14, "timeframe": "4h"}},
                    "operator": ">", "right": {"value": 70}}},
            }
        }
        BacktestRun.objects.create(
            user=u, pct_change=5.0, final_balance=10500, cash=10500, invested=0,
            dsl_json=dsl, config={"tickers": ["AAPL", "MSFT"]})
        short_dsl = {
            "SHORT": {
                "context": {"tickers": ["SPY"], "execution_timeframe": "1D"},
                "OPEN": {"CONDITIONS": {
                    "left": {"func": "SMA", "arg": {"period": 50, "timeframe": "1D"}},
                    "operator": "<", "right": {"value": 400}}},
            }
        }
        BacktestRun.objects.create(
            user=u, pct_change=-2.0, final_balance=9800, cash=9800, invested=0,
            dsl_json=short_dsl, config={"tickers": ["SPY"]})

        data = json.loads(self.get("/api/admin/strategy-insights/?days=30").content)
        self.assertEqual(data["total_runs"], 2)
        self.assertEqual(data["tickers"], {"AAPL": 1, "MSFT": 1, "SPY": 1})
        self.assertEqual(data["indicators"], {"RSI": 1, "SMA": 1})
        # Counted once per run: run 1 uses 1h+4h, run 2 uses 1D (in context and
        # indicator args, still one run).
        self.assertEqual(data["timeframes"], {"1h": 1, "4h": 1, "1D": 1})
        self.assertEqual(data["directions"], {"LONG": 1, "SHORT": 1})

        perf = {t["ticker"]: t for t in data["ticker_performance"]}
        self.assertEqual(perf["AAPL"]["runs"], 1)
        self.assertEqual(perf["AAPL"]["profitable_rate"], 1.0)
        self.assertEqual(perf["AAPL"]["avg_return_pct"], 5.0)
        self.assertEqual(perf["SPY"]["profitable_rate"], 0.0)
        self.assertEqual(perf["SPY"]["avg_return_pct"], -2.0)
