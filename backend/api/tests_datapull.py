"""Tests for market-data fetching cache behavior (core.data_pulling.datapull).

The launch-critical property: an empty yfinance result (Yahoo throttling the
server's shared IP) must never be cached, and a previously cached empty frame
must be treated as a cache miss — otherwise one throttled fetch serves
"no data found" to every user for up to 24 hours.
"""

from unittest.mock import patch

import pandas as pd
from django.core.cache import cache
from django.test import TestCase

from core.data_pulling import datapull


def _frame(rows=3):
    idx = pd.date_range("2026-01-01", periods=rows, freq="D")
    return pd.DataFrame({"Open": 1.0, "High": 1.0, "Low": 1.0, "Close": 1.0, "Volume": 100}, index=idx)


ARGS = dict(ticker="TEST", start="2026-01-01", end="2026-02-01", interval="1D")


class DatapullCacheTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_empty_fetch_is_retried_once_and_not_cached(self):
        results = [pd.DataFrame(), _frame()]  # throttled once, then fine
        with patch.object(datapull.yf, "download", side_effect=lambda *a, **k: results.pop(0)) as dl, \
             patch.object(datapull.time, "sleep"):
            df = datapull.get_data_with_indicator(**ARGS)
        self.assertEqual(len(df), 3)
        self.assertEqual(dl.call_count, 2)

    def test_persistently_empty_fetch_returns_empty_without_caching(self):
        with patch.object(datapull.yf, "download", return_value=pd.DataFrame()), \
             patch.object(datapull.time, "sleep"):
            df = datapull.get_data_with_indicator(**ARGS)
        self.assertTrue(df.empty)
        self.assertIsNone(cache.get(datapull.get_cache_key("TEST", "2026-01-01", "2026-02-01", "1D")))

    def test_poisoned_cache_entry_is_ignored_and_refetched(self):
        # Simulate the old code having cached an empty frame.
        key = datapull.get_cache_key("TEST", "2026-01-01", "2026-02-01", "1D")
        cache.set(key, pd.DataFrame().to_json(orient="split"), timeout=3600)
        with patch.object(datapull.yf, "download", return_value=_frame()) as dl:
            df = datapull.get_data_with_indicator(**ARGS)
        self.assertEqual(len(df), 3)
        self.assertEqual(dl.call_count, 1)  # refetched despite "cached" entry

    def test_good_data_is_cached_and_served_from_cache(self):
        with patch.object(datapull.yf, "download", return_value=_frame()) as dl:
            datapull.get_data_with_indicator(**ARGS)
            df2 = datapull.get_data_with_indicator(**ARGS)
        self.assertEqual(dl.call_count, 1)  # second call served from cache
        self.assertEqual(len(df2), 3)
