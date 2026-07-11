import json
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token

from core.analysis.parameter_optimiser import build_param_grid, build_param_values, extract_optimizable_parameters

from .assistant import _context_text, build_strategy_brief, prepare_strategy_market_data


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


class EntitlementQuotaTests(TestCase):
    """Atomic monthly-quota enforcement (the reserve/refund gate)."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="quota@example.com",
            email="quota@example.com",
            password="P@ssword123!",
        )

    def test_consume_quota_enforces_limit_atomically(self):
        from api import entitlements
        from api.entitlements import PlanLimitError
        from api.models import UsageCounter

        # Free plan allows 3 AI generations/month. Reserve exactly the limit.
        for _ in range(3):
            entitlements.consume_quota(self.user, "ai")

        with self.assertRaises(PlanLimitError):
            entitlements.consume_quota(self.user, "ai")

        row = UsageCounter.objects.get(
            user=self.user, metric="ai", period=entitlements.current_period()
        )
        # A rejected reservation must NOT have incremented the counter past the cap.
        self.assertEqual(row.count, 3)

    def test_refund_restores_a_reserved_use(self):
        from api import entitlements

        entitlements.consume_quota(self.user, "ai")
        entitlements.consume_quota(self.user, "ai")
        entitlements.refund_quota(self.user, "ai")

        self.assertEqual(entitlements.usage_count(self.user, "ai"), 1)

    def test_refund_never_drives_counter_negative(self):
        from api import entitlements

        entitlements.refund_quota(self.user, "ai")
        self.assertEqual(entitlements.usage_count(self.user, "ai"), 0)

    def test_unlimited_plan_never_blocks(self):
        from api import entitlements

        profile = entitlements.get_profile(self.user)
        profile.plan = "pro"
        profile.save(update_fields=["plan", "updated_at"])

        for _ in range(50):
            entitlements.consume_quota(self.user, "ai")  # must not raise


class PlanSwitchAuthorizationTests(TestCase):
    """Self-service plan changes must be gated by PLAN_SELF_SERVICE in prod."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="switch@example.com",
            email="switch@example.com",
            password="P@ssword123!",
        )
        self.token = Token.objects.create(user=self.user)

    def _switch(self, plan, email=None):
        payload = {"plan": plan}
        if email is not None:
            payload["email"] = email
        return self.client.post(
            "/api/plan/switch/",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

    @override_settings(PLAN_SELF_SERVICE=False)
    def test_self_upgrade_blocked_without_self_service(self):
        response = self._switch("pro")
        self.assertEqual(response.status_code, 403)
        self.user.refresh_from_db()
        from api import entitlements
        self.assertEqual(entitlements.plan_of(self.user), "free")

    @override_settings(PLAN_SELF_SERVICE=True)
    def test_self_upgrade_allowed_when_self_service_on(self):
        response = self._switch("pro")
        self.assertEqual(response.status_code, 200)
        from api import entitlements
        self.assertEqual(entitlements.plan_of(self.user), "pro")

    @override_settings(PLAN_SELF_SERVICE=False)
    def test_staff_can_switch_despite_self_service_off(self):
        self.user.is_staff = True
        self.user.save(update_fields=["is_staff"])
        response = self._switch("pro")
        self.assertEqual(response.status_code, 200)

    @override_settings(PLAN_SELF_SERVICE=True)
    def test_non_staff_cannot_target_another_user(self):
        victim = User.objects.create_user(
            username="victim@example.com",
            email="victim@example.com",
            password="P@ssword123!",
        )
        response = self._switch("pro", email="victim@example.com")
        self.assertEqual(response.status_code, 403)
        from api import entitlements
        self.assertEqual(entitlements.plan_of(victim), "free")


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

    def test_strategy_market_data_preparation_warms_missing_cache(self):
        context = self._sample_context()
        context["markets"]["executionTimeframe"] = "15m"
        context["markets"]["dateStart"] = "2025-01-01"
        context["markets"]["dateEnd"] = "2025-01-03"

        def fake_download(ticker, start, end, interval, save_path, **kwargs):
            rows = []
            start_at = datetime(2025, 1, 1)
            for index in range(20):
                rows.append(
                    {
                        "Datetime": start_at + timedelta(minutes=15 * index),
                        "Open": 100 + index,
                        "High": 101 + index,
                        "Low": 99 + index,
                        "Close": 100.5 + index,
                        "Volume": 1000 + index,
                    }
                )
            df = pd.DataFrame(rows).set_index("Datetime")
            Path(save_path).mkdir(parents=True, exist_ok=True)
            df.to_csv(Path(save_path) / f"{ticker}_{interval}.csv")
            return df

        with tempfile.TemporaryDirectory() as tmpdir:
            with override_settings(ORCA_ASSISTANT_MARKET_DATA_DIR=tmpdir):
                with patch("core.data_pulling.datapull.get_data_with_indicator", side_effect=fake_download):
                    prepared = prepare_strategy_market_data(context["markets"])
                brief = build_strategy_brief(context)

        self.assertEqual(prepared[0]["status"], "cache_warmed")
        self.assertEqual(prepared[0]["source_file"], "AAPL_15m.csv")
        self.assertEqual(brief["market_data"][0]["status"], "available")

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


class CrossAssetBacktestTests(TestCase):
    """Signal (watch-only) tickers: conditions may reference another symbol via
    a `ticker` arg; its data loads but it is never traded."""

    DATES = pd.date_range("2025-01-01", periods=12, freq="D")
    CLOSES = {
        # UKX drops >5% on 01-05, rebounds >7% on 01-08
        "UKX": [100, 100, 100, 100, 94, 94, 94, 101, 101, 101, 101, 101],
        "SPX": [50 + i for i in range(12)],
    }

    def _fake_download(self, ticker, start, end, interval):
        closes = pd.Series(self.CLOSES[ticker], index=self.DATES, dtype=float)
        return pd.DataFrame(
            {
                "Open": closes,
                "High": closes * 1.001,
                "Low": closes * 0.999,
                "Close": closes,
                "Volume": 1000,
            },
            index=self.DATES,
        )

    @staticmethod
    def _price(ticker=None, offset=0):
        arg = {"OHLC": "close", "offset": offset}
        if ticker:
            arg["ticker"] = ticker
        return {"func": "PRICE", "arg": arg}

    def _dsl(self):
        return {
            "LONG": {
                "context": {
                    "tickers": ["SPX"],
                    "signal_tickers": ["UKX"],
                    "execution_timeframe": "1d",
                    "data_timeframes": ["1d"],
                    "dateframe": {"start": "2025-01-01", "end": "2025-01-12"},
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": self._price("UKX"),
                        "operator": "<",
                        "right": {"op": "*", "left": self._price("UKX", offset=1), "right": {"value": 0.95}},
                    },
                    "ARGUMENTS": {
                        "initialOpenPositionInvestType": "numberShares",
                        "initialOpenPositionInvestAmount": 100,
                    },
                },
                "CLOSE": {
                    "CONDITIONS": {
                        "left": self._price("UKX"),
                        "operator": ">",
                        "right": {"op": "*", "left": self._price("UKX", offset=1), "right": {"value": 1.07}},
                    },
                    "ARGUMENTS": {},
                },
            }
        }

    def test_signal_ticker_drives_trades_but_is_never_traded(self):
        from core.main import main as run_backtest

        with patch("core.main.datapull.get_data_with_indicator", side_effect=self._fake_download):
            result = run_backtest(self._dsl(), initial_balance=100000)

        trades = result["trades"]
        self.assertTrue(trades, "cross-asset condition never fired")
        self.assertTrue(all(t["ticker"] == "SPX" for t in trades), "watch-only ticker was traded")

        buys = [t for t in trades if t["type"] == "BUY"]
        self.assertEqual(len(buys), 1)
        self.assertEqual(buys[0]["shares"], 100)
        self.assertTrue(buys[0]["timestamp"].startswith("2025-01-05"))

        sells = [t for t in trades if t["type"] == "SELL"]
        self.assertEqual(len(sells), 1)
        self.assertTrue(sells[0]["timestamp"].startswith("2025-01-08"))

        # Watch-only data is still returned for charting
        self.assertIn("UKX", result["data"])

    def test_unknown_condition_ticker_raises_friendly_error(self):
        from core.main import BacktestError, main as run_backtest

        dsl = self._dsl()
        dsl["LONG"]["context"]["signal_tickers"] = []

        with patch("core.main.datapull.get_data_with_indicator", side_effect=self._fake_download):
            with self.assertRaises(BacktestError) as ctx:
                run_backtest(dsl, initial_balance=100000)

        self.assertEqual(ctx.exception.code, "unknown_condition_ticker")
        self.assertIn("UKX", ctx.exception.message)

    def test_ticker_arg_survives_default_merging(self):
        from core.main import merge_indicator_defaults

        merged = merge_indicator_defaults(self._dsl())
        left_args = merged["LONG"]["OPEN"]["CONDITIONS"]["left"]["arg"]
        self.assertEqual(left_args.get("ticker"), "UKX")

    def test_text_dsl_parses_signal_tickers(self):
        from core.parsing.parser import parse_dsl

        parsed = parse_dsl(
            """
            :TICKER(SPX)
            :SIGNAL_TICKER(UKX)
            :EXECUTION_TIMEFRAME(1d)
            :DATA_TIMEFRAMES(1d)
            :DATEFRAME(2025-01-01, 2025-06-01)
            :LONG(
               OPEN{ CONDITIONS{ RSI() < 30 } }
               |CLOSE{ CONDITIONS{ RSI() > 70 } }
            )
            """
        )
        self.assertEqual(parsed["LONG"]["context"]["tickers"], ["SPX"])
        self.assertEqual(parsed["LONG"]["context"]["signal_tickers"], ["UKX"])


class TickerSearchTests(TestCase):
    """Yahoo-backed symbol autocomplete + full-name resolution."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="search@example.com",
            email="search@example.com",
            password="P@ssword123!",
        )
        self.token = Token.objects.create(user=self.user)

    @staticmethod
    def _fake_yahoo_response(quotes):
        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {"quotes": quotes}

        return FakeResponse()

    def _search(self, q):
        return self.client.get(
            f"/api/tickers/search/?q={q}",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

    def test_search_requires_auth(self):
        response = self.client.get("/api/tickers/search/?q=apple")
        self.assertEqual(response.status_code, 401)

    def test_search_merges_registry_and_yahoo(self):
        quotes = [
            {"symbol": "APLE", "shortname": "Apple Hospitality REIT", "exchDisp": "NYSE", "quoteTypeDisp": "Equity"},
            {"symbol": "AAPL", "shortname": "Apple Inc.", "exchDisp": "NASDAQ", "quoteTypeDisp": "Equity"},
        ]
        with patch("api.views.requests.get", return_value=self._fake_yahoo_response(quotes)):
            response = self._search("apple")

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        symbols = [r["symbol"] for r in results]

        # Registry match (AAPL, local data) first and deduped against Yahoo's AAPL
        self.assertIn("AAPL", symbols)
        self.assertEqual(symbols.count("AAPL"), 1)
        aapl = next(r for r in results if r["symbol"] == "AAPL")
        self.assertTrue(aapl["local"])
        self.assertEqual(aapl["name"], "Apple Inc.")
        # Yahoo-only match included with its full name
        aple = next(r for r in results if r["symbol"] == "APLE")
        self.assertFalse(aple["local"])
        self.assertEqual(aple["name"], "Apple Hospitality REIT")

    def test_search_degrades_when_yahoo_down(self):
        with patch("api.views.requests.get", side_effect=OSError("network down")):
            response = self._search("apple")

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        # Registry matches still returned
        self.assertTrue(any(r["symbol"] == "AAPL" for r in results))

    def test_resolve_ticker_names_registry_yahoo_and_fallback(self):
        from api.views import resolve_ticker_names

        quotes = [{"symbol": "APLE", "shortname": "Apple Hospitality REIT", "quoteTypeDisp": "Equity"}]
        with patch("api.views.requests.get", return_value=self._fake_yahoo_response(quotes)):
            names = resolve_ticker_names(["AAPL", "APLE"])

        self.assertEqual(names["AAPL"], "Apple Inc.")               # registry, no network needed
        self.assertEqual(names["APLE"], "Apple Hospitality REIT")   # live Yahoo lookup

        # Unknown symbol + Yahoo down -> falls back to the symbol itself
        cache.clear()
        with patch("api.views.requests.get", side_effect=OSError("down")):
            names = resolve_ticker_names(["ZZZUNKNOWN"])
        self.assertEqual(names["ZZZUNKNOWN"], "ZZZUNKNOWN")


class BacktestTextEndpointErrorTests(TestCase):
    """The text endpoint must map engine failures to friendly 400s (it used to
    surface them as generic 500s) and share the JSON endpoint's guards."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="text@example.com", email="text@example.com", password="P@ssword123!"
        )
        self.token = Token.objects.create(user=self.user)

    def _post(self, dsl_text):
        return self.client.post(
            "/api/backtestDSLText/",
            data=json.dumps({"dsl_text": dsl_text}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

    VALID_TEXT = """
:TICKER(AAPL)
:EXECUTION_TIMEFRAME(1h)
:DATEFRAME(2024-01-01, 2024-06-01)
:LONG(
   OPEN{
       CONDITIONS{
           RSI() < 30
       }
   }
)
"""

    def test_engine_failure_returns_friendly_400_and_refunds_quota(self):
        from api import entitlements
        from core.main import BacktestError

        with patch(
            "api.views.dslJSONBacktest",
            side_effect=BacktestError("No market data found for 'AAPL'.", code="no_data"),
        ):
            response = self._post(self.VALID_TEXT)

        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["code"], "no_data")
        self.assertIn("No market data", body["error"])
        # The failed run must not be charged against the monthly quota.
        self.assertEqual(entitlements.usage_count(self.user, "backtest"), 0)

    def test_unparseable_text_returns_400_not_500(self):
        response = self._post(":DATEFRAME(not-even-close)")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "dsl_parse_error")

    def test_text_endpoint_enforces_ticker_cap(self):
        many = ",".join(f"T{i}" for i in range(10))
        dsl = self.VALID_TEXT.replace(":TICKER(AAPL)", f":TICKER({many})")
        response = self._post(dsl)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "too_many_tickers")


class StrategyToDslBacktestQuotaTests(TestCase):
    """strategy_to_dsl's run_backtest flag must be metered like a normal backtest."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="nlp@example.com", email="nlp@example.com", password="P@ssword123!"
        )
        self.token = Token.objects.create(user=self.user)
        self.strategy = {
            "LONG": {
                "context": {
                    "tickers": ["AAPL"],
                    "execution_timeframe": "1h",
                    "dateframe": {"start": "2024-01-01", "end": "2024-06-01"},
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14}},
                        "operator": "<",
                        "right": {"value": 30},
                    },
                    "ARGUMENTS": {},
                },
            }
        }

    def _post(self):
        return self.client.post(
            "/api/strategy-to-dsl/",
            data=json.dumps({"message": "buy AAPL when RSI under 30", "run_backtest": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

    def test_run_backtest_consumes_backtest_quota(self):
        from api import entitlements

        fake_result = {"cash": 10000, "invested": 0, "total_portfolio": 10000, "pct_change": 0, "trades": [], "data": {}}
        with patch("api.views.parse_strategy", return_value=self.strategy), patch(
            "api.views.dslJSONBacktest", return_value=fake_result
        ):
            response = self._post()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(entitlements.usage_count(self.user, "backtest"), 1)

    def test_run_backtest_over_quota_returns_plan_limit_not_free_run(self):
        from api import entitlements

        limit = entitlements.monthly_limit(self.user, "backtest")
        entitlements.consume_quota(self.user, "backtest", n=limit)

        with patch("api.views.parse_strategy", return_value=self.strategy), patch(
            "api.views.dslJSONBacktest"
        ) as engine:
            response = self._post()

        self.assertEqual(response.status_code, 200)
        engine.assert_not_called()  # no free ride past the quota
        body = response.json()
        self.assertEqual(body["backtest"]["code"], "plan_limit")


class OptimizerQuotaRefundTests(TestCase):
    """A failed optimization must refund the optimize quota."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="opt@example.com", email="opt@example.com", password="P@ssword123!"
        )
        self.token = Token.objects.create(user=self.user)

    def test_sync_grid_failure_refunds_optimize_quota(self):
        from api import entitlements

        dsl = {
            "LONG": {
                "context": {
                    "tickers": ["AAPL"],
                    "execution_timeframe": "1h",
                    "dateframe": {"start": "2024-01-01", "end": "2024-06-01"},
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14}},
                        "operator": "<",
                        "right": {"value": 30},
                    },
                    "ARGUMENTS": {},
                },
            }
        }
        choice = {"LONG.OPEN.CONDITIONS.left.arg.period": {"mode": "manual", "values": [10, 14]}}

        with patch("api.views.optimizer", side_effect=ValueError("all runs failed")):
            response = self.client.post(
                "/api/dslParameterOptimiser/",
                data=json.dumps({"dsl_json": dsl, "parameter_choice": choice}),
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Token {self.token.key}",
            )

        # A ValueError from the optimizer is user-actionable, so it maps to a
        # friendly 400 (not a raw 500), and the quota is refunded.
        self.assertEqual(response.status_code, 400)
        self.assertIn("all runs failed", response.json().get("error", ""))
        self.assertEqual(entitlements.usage_count(self.user, "optimize"), 0)


class OptimizerDataPipelineTests(TestCase):
    """The optimizer must normalise market data exactly like core.main so the
    backtester never hits 'Cannot compare tz-naive and tz-aware' (the bug that
    made every optimizer run fail while the standalone backtest worked)."""

    def test_prepare_normalizes_tz_aware_index_to_naive(self):
        import pandas as pd
        import core.analysis.parameter_optimiser as opt

        idx = pd.date_range("2025-01-01", periods=120, freq="D", tz="America/New_York")
        aware = pd.DataFrame(
            {
                "Open": range(120), "High": range(1, 121), "Low": range(120),
                "Close": range(1, 121), "Volume": [1000] * 120,
            },
            index=idx,
        )

        dsl = {
            "LONG": {
                "context": {
                    "tickers": ["AAPL"],
                    "execution_timeframe": "1D",
                    "dateframe": {"start": "2025-01-01", "end": "2025-04-01"},
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14}},
                        "operator": "<",
                        "right": {"value": 30},
                    },
                    "ARGUMENTS": {},
                },
            }
        }

        with patch.object(opt, "get_data_with_indicator", return_value=aware.copy()):
            _, data_dict, _ = opt._prepare(dict(dsl))

        # Every loaded frame must be tz-naive after _prepare.
        for tf_map in data_dict.values():
            for frame in tf_map.values():
                self.assertIsNone(frame.index.tz)

    def test_optimizer_runs_end_to_end_on_tz_aware_source(self):
        import pandas as pd
        import core.analysis.parameter_optimiser as opt

        idx = pd.date_range("2025-01-01", periods=200, freq="D", tz="UTC")
        # Oscillating close so RSI actually crosses thresholds and trades fire.
        closes = [100 + (i % 15) - 7 for i in range(200)]
        aware = pd.DataFrame(
            {
                "Open": closes, "High": [c + 2 for c in closes],
                "Low": [c - 2 for c in closes], "Close": closes, "Volume": [1000] * 200,
            },
            index=idx,
        )
        dsl = {
            "LONG": {
                "context": {
                    "tickers": ["AAPL"],
                    "execution_timeframe": "1D",
                    "dateframe": {"start": "2025-01-01", "end": "2025-06-01"},
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14}},
                        "operator": "<",
                        "right": {"value": 40},
                    },
                    "ARGUMENTS": {},
                },
            }
        }
        choice = {"LONG.OPEN.CONDITIONS.left.arg.period": {"mode": "manual", "values": [10, 14, 20]}}

        with patch.object(opt, "get_data_with_indicator", return_value=aware.copy()):
            result = opt.optimizer(parsed_dsl=dict(dsl), param_choices=choice, initial_balance=10000)

        # No run should fail with the tz comparison error.
        self.assertEqual(result["total_runs"], 3)
        self.assertEqual(result["errors"], [])


class SsoAccountManagementTests(TestCase):
    """Google-SSO users (no usable password) must still be able to delete their
    account and set a first password."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="sso@example.com", email="sso@example.com", password=None
        )
        self.token = Token.objects.create(user=self.user)

    def _post(self, path, payload):
        return self.client.post(
            path,
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

    def test_me_reports_has_password_false_for_sso(self):
        response = self.client.get("/api/me/", HTTP_AUTHORIZATION=f"Token {self.token.key}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["has_password"])

    def test_sso_delete_with_matching_email_succeeds(self):
        response = self._post("/api/delete-account/", {"confirm_email": "SSO@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(email="sso@example.com").exists())

    def test_sso_delete_with_wrong_email_fails(self):
        response = self._post("/api/delete-account/", {"confirm_email": "wrong@example.com"})
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(email="sso@example.com").exists())

    def test_password_holder_still_requires_password_to_delete(self):
        user = User.objects.create_user(
            username="pw@example.com", email="pw@example.com", password="P@ssword123!"
        )
        token = Token.objects.create(user=user)
        response = self.client.post(
            "/api/delete-account/",
            data=json.dumps({"confirm_email": "pw@example.com"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(email="pw@example.com").exists())

    def test_sso_can_set_first_password_without_current(self):
        response = self._post("/api/change-password/", {"new_password": "N3wS3cret!pass"})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.has_usable_password())
        self.assertTrue(self.user.check_password("N3wS3cret!pass"))
