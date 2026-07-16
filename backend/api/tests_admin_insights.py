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
