import json
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token

from core.analysis.parameter_optimiser import build_param_grid, build_param_values, extract_optimizable_parameters

from .assistant import _context_text, build_strategy_brief


User = get_user_model()


class SecurityBehaviorTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_backtest_endpoint_requires_authentication(self):
        response = self.client.post(
            "/api/backtestDSLText/",
            data=json.dumps({"dsl_text": ":TICKER(AAPL)"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_login_rotates_existing_token(self):
        user = User.objects.create_user(
            username="user@example.com",
            email="user@example.com",
            password="P@ssword123!",
        )
        old_token = Token.objects.create(user=user)

        response = self.client.post(
            "/api/login/",
            data=json.dumps({"email": "user@example.com", "password": "P@ssword123!"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        new_token = response.json()["token"]
        self.assertNotEqual(new_token, old_token.key)
        self.assertFalse(Token.objects.filter(key=old_token.key).exists())

    @override_settings(GOOGLE_CLIENT_ID="google-client-id")
    def test_google_login_creates_account(self):
        with patch(
            "api.views.verify_google_id_token",
            return_value={
                "aud": "google-client-id",
                "iss": "https://accounts.google.com",
                "email": "google@example.com",
                "email_verified": "true",
                "name": "Google User",
            },
        ) as verifier:
            response = self.client.post(
                "/api/login/google/",
                data=json.dumps({"id_token": "google-token"}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        verifier.assert_called_once_with("google-token")
        body = response.json()
        user = User.objects.get(email="google@example.com")
        self.assertEqual(body["user"]["email"], "google@example.com")
        self.assertEqual(body["user"]["name"], "Google User")
        self.assertEqual(Token.objects.get(user=user).key, body["token"])

    def test_google_login_requires_token(self):
        response = self.client.post(
            "/api/login/google/",
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)

    @override_settings(
        API_RATE_LIMITS={
            "auth": {"max_requests": 1, "window_seconds": 60},
            "compute": {"max_requests": 10, "window_seconds": 60},
            "status": {"max_requests": 10, "window_seconds": 60},
            "general": {"max_requests": 10, "window_seconds": 60},
        }
    )
    def test_login_rate_limit_blocks_excess_attempts(self):
        first = self.client.post(
            "/api/login/",
            data=json.dumps({"email": "none@example.com", "password": "bad-password"}),
            content_type="application/json",
        )
        second = self.client.post(
            "/api/login/",
            data=json.dumps({"email": "none@example.com", "password": "bad-password"}),
            content_type="application/json",
        )

        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)


class StrategyAssistantDiagnosticsTests(TestCase):
    def _sample_context(self):
        return {
            "currentStage": "Open Setup",
            "strategyName": "RSI Pullback",
            "side": "LONG",
            "openConditions": [
                {
                    "left": {
                        "type": "indicator",
                        "func": "RSI",
                        "args": {"period": 14, "timeframe": "1h", "offset": 0},
                    },
                    "operator": "<",
                    "right": {"type": "value", "value": 30},
                    "nextLogicalOperator": "AND",
                }
            ],
            "closeConditions": [],
            "openArguments": {"initialOpenPositionInvestType": "percentCashBalance"},
            "closeArguments": {},
            "riskManagement": {"takeProfitPercent": 2, "stopLossPercent": 8, "spread": 0.1},
            "markets": {
                "tickers": ["AAPL"],
                "executionTimeframe": "5m",
                "dateStart": "2025-01-01",
                "dateEnd": "2025-02-01",
            },
            "account": {"initialBalance": 10000},
            "jsonDsl": {},
            "readOnly": True,
        }

    def test_strategy_brief_adds_trade_diagnostics(self):
        brief = build_strategy_brief(self._sample_context())
        flags = " ".join(brief["diagnostic_flags"])

        self.assertEqual(brief["rules"]["open_condition_count"], 1)
        self.assertEqual(brief["rules"]["close_condition_count"], 0)
        self.assertEqual(brief["risk_math"]["reward_to_risk"], 0.25)
        self.assertEqual(brief["risk_math"]["break_even_win_rate_before_spread_percent"], 80.0)
        self.assertIn("Reward is smaller than risk", flags)
        self.assertIn("No close condition is present", flags)
        self.assertIn("Minute-level execution", flags)

    def test_strategy_brief_includes_indicator_knowledge(self):
        brief = build_strategy_brief(self._sample_context())
        indicators = brief["rules"]["indicators_detected"]

        self.assertEqual(indicators[0]["name"], "RSI")
        self.assertEqual(indicators[0]["family"], "Momentum")
        self.assertIn("trend/regime filter", indicators[0]["watchout"])

    def test_strategy_brief_treats_zero_risk_values_as_disabled(self):
        context = self._sample_context()
        context["riskManagement"] = {"takeProfitPercent": 0, "stopLossPercent": 0, "spread": 0}

        brief = build_strategy_brief(context)
        flags = " ".join(brief["diagnostic_flags"])

        self.assertIn("No take-profit, stop-loss, or close condition is configured", flags)

    def test_strategy_brief_includes_cached_market_data_stats(self):
        context = self._sample_context()
        context["markets"]["executionTimeframe"] = "1h"
        context["markets"]["dateStart"] = "2025-01-01"
        context["markets"]["dateEnd"] = "2025-01-03"

        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "AAPL_1h.csv"
            rows = ["Datetime,Open,High,Low,Close,Volume"]
            start_at = datetime(2025, 1, 1)
            for index in range(30):
                close = 100 + index * 0.5 + (1 if index % 2 else -1)
                timestamp = (start_at + timedelta(hours=index)).strftime("%Y-%m-%d %H:%M:%S")
                rows.append(
                    f"{timestamp},"
                    f"{close - 0.5:.2f},{close + 2:.2f},{close - 2:.2f},{close:.2f},{1000 + index * 10}"
                )
            csv_path.write_text("\n".join(rows), encoding="utf-8")

            with override_settings(ORCA_ASSISTANT_MARKET_DATA_DIR=tmpdir):
                brief = build_strategy_brief(context)

        market_data = brief["market_data"][0]

        self.assertEqual(market_data["status"], "available")
        self.assertEqual(market_data["source_file"], "AAPL_1h.csv")
        self.assertEqual(market_data["price_action"]["latest_close"], 115.5)
        self.assertGreater(market_data["volatility"]["atr_14_percent_latest"], 0)
        self.assertTrue(market_data["parameter_suggestions"]["volatility_based_stop_loss_percent_tests"])
        self.assertTrue(market_data["parameter_suggestions"]["moving_average_period_tests"])

    def test_strategy_brief_reports_missing_cached_market_data(self):
        context = self._sample_context()
        context["markets"]["executionTimeframe"] = "1h"

        with tempfile.TemporaryDirectory() as tmpdir:
            with override_settings(ORCA_ASSISTANT_MARKET_DATA_DIR=tmpdir):
                brief = build_strategy_brief(context)

        market_data = brief["market_data"][0]

        self.assertEqual(market_data["status"], "unavailable")
        self.assertIn("No cached CSV", market_data["reason"])

    @override_settings(ORCA_ASSISTANT_MAX_CONTEXT_CHARS=5000)
    def test_context_text_prioritises_derived_brief(self):
        text = _context_text(self._sample_context())

        self.assertLessEqual(len(text), 5000)
        self.assertIn("Orca-derived strategy brief", text)
        self.assertIn('"reward_to_risk": 0.25', text)
        self.assertIn("Raw read-only strategy context", text)


class OptimizerParameterGuardTests(TestCase):
    def _dsl_with_spread(self):
        return {
            "LONG": {
                "context": {
                    "tickers": ["AAPL"],
                    "execution_timeframe": "1h",
                    "dateframe": {"start": "2025-01-01", "end": "2025-02-01"},
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14, "timeframe": "1h", "offset": 0}},
                        "operator": "<",
                        "right": {"value": 30},
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": 6,
                        "stopLossPercent": 3,
                        "spread": 0.2,
                    },
                },
            }
        }

    def test_optimizer_extraction_never_includes_spread(self):
        params = extract_optimizable_parameters(self._dsl_with_spread())

        self.assertIn("LONG.OPEN.ARGUMENTS.takeProfitPercent", params)
        self.assertIn("LONG.OPEN.ARGUMENTS.stopLossPercent", params)
        self.assertNotIn("LONG.OPEN.ARGUMENTS.spread", params)

    def test_grid_optimizer_ignores_spread_choice(self):
        grid, _ = build_param_grid(
            self._dsl_with_spread(),
            {
                "LONG.OPEN.ARGUMENTS.spread": {"mode": "manual", "values": [0, 0.1, 0.2]},
                "LONG.OPEN.ARGUMENTS.stopLossPercent": {"mode": "manual", "values": [2, 3]},
            },
        )

        self.assertEqual(set(grid.keys()), {"LONG.OPEN.ARGUMENTS.stopLossPercent"})

    def test_genetic_optimizer_values_ignore_spread_choice(self):
        values, _ = build_param_values(
            self._dsl_with_spread(),
            {"LONG.OPEN.ARGUMENTS.spread": {"mode": "manual", "values": [0, 0.1, 0.2]}},
        )

        self.assertEqual(values, {})
