// Pre-computed demo backtests for the landing page "try it" widget.
// These are REAL results from the actual Orca engine, generated offline
// (see the strategies' DSL in git history) — never invent these numbers.
// The landing demo replays them so anonymous visitors never hit the
// backtest engine or the Modal GPU.

export interface DemoFixture {
  prompt: string;
  summary: {
    direction: string;
    ticker: string;
    timeframe: string;
    entry: string;
    exit: string;
    stopLoss: string;
    takeProfit: string;
    period: string;
  };
  stats: {
    returnPct: number;
    trades: number;
    winRate: number;
    finalBalance: number;
    initialBalance: number;
  };
  equityCurve: { t: string; v: number }[];
  recentTrades: { date: string; type: string; price: number }[];
}

export const DEMO_FIXTURES: Record<string, DemoFixture> = {
  "nvda": {
    "prompt": "Buy NVDA when the 20-day average crosses above the 50-day, sell when it crosses back below. 12% stop loss, 40% take profit.",
    "summary": {
      "direction": "LONG",
      "ticker": "NVDA",
      "timeframe": "Daily",
      "entry": "SMA(20) crosses above SMA(50)",
      "exit": "SMA(20) crosses below SMA(50)",
      "stopLoss": "12%",
      "takeProfit": "40%",
      "period": "Jun 2022 \u2192 Jul 2026"
    },
    "stats": {
      "returnPct": 151.38,
      "trades": 42,
      "winRate": 61.9,
      "finalBalance": 25137.79,
      "initialBalance": 10000
    },
    "equityCurve": [
      {
        "t": "2022-08-04",
        "v": 10000.0
      },
      {
        "t": "2022-08-09",
        "v": 9400.08
      },
      {
        "t": "2022-08-10",
        "v": 9400.08
      },
      {
        "t": "2022-08-29",
        "v": 8836.15
      },
      {
        "t": "2022-08-30",
        "v": 8836.15
      },
      {
        "t": "2022-09-01",
        "v": 8306.02
      },
      {
        "t": "2022-09-02",
        "v": 8306.02
      },
      {
        "t": "2022-09-07",
        "v": 8327.65
      },
      {
        "t": "2022-11-10",
        "v": 8327.65
      },
      {
        "t": "2023-01-11",
        "v": 8395.08
      },
      {
        "t": "2023-01-26",
        "v": 8395.08
      },
      {
        "t": "2023-03-31",
        "v": 10073.73
      },
      {
        "t": "2023-04-03",
        "v": 10073.73
      },
      {
        "t": "2023-05-25",
        "v": 12087.55
      },
      {
        "t": "2023-05-26",
        "v": 12087.55
      },
      {
        "t": "2023-09-27",
        "v": 12635.32
      },
      {
        "t": "2023-11-15",
        "v": 12635.32
      },
      {
        "t": "2024-02-05",
        "v": 15161.05
      },
      {
        "t": "2024-02-06",
        "v": 15161.05
      },
      {
        "t": "2024-03-08",
        "v": 18192.95
      },
      {
        "t": "2024-03-11",
        "v": 18192.95
      },
      {
        "t": "2024-04-30",
        "v": 18259.53
      },
      {
        "t": "2024-05-20",
        "v": 18259.53
      },
      {
        "t": "2024-06-14",
        "v": 21907.94
      },
      {
        "t": "2024-06-17",
        "v": 21907.94
      },
      {
        "t": "2024-07-24",
        "v": 20594.54
      },
      {
        "t": "2024-07-25",
        "v": 20594.54
      },
      {
        "t": "2024-08-02",
        "v": 20135.38
      },
      {
        "t": "2024-09-06",
        "v": 20135.38
      },
      {
        "t": "2024-09-19",
        "v": 21607.86
      },
      {
        "t": "2024-10-02",
        "v": 21607.86
      },
      {
        "t": "2024-12-17",
        "v": 22657.18
      },
      {
        "t": "2025-05-14",
        "v": 22657.18
      },
      {
        "t": "2025-09-17",
        "v": 25583.68
      },
      {
        "t": "2025-10-03",
        "v": 25583.68
      },
      {
        "t": "2025-12-02",
        "v": 25164.1
      },
      {
        "t": "2026-01-15",
        "v": 25164.1
      },
      {
        "t": "2026-03-02",
        "v": 24856.92
      },
      {
        "t": "2026-03-06",
        "v": 24856.92
      },
      {
        "t": "2026-03-10",
        "v": 25342.13
      },
      {
        "t": "2026-04-22",
        "v": 25342.13
      },
      {
        "t": "2026-06-24",
        "v": 25137.79
      }
    ],
    "recentTrades": [
      {
        "date": "2025-12-02",
        "type": "SELL",
        "price": 181.23
      },
      {
        "date": "2026-03-02",
        "type": "SELL",
        "price": 182.26
      },
      {
        "date": "2026-03-10",
        "type": "SELL",
        "price": 184.54
      },
      {
        "date": "2026-06-24",
        "type": "SELL",
        "price": 199.0
      }
    ]
  },
  "qqq": {
    "prompt": "Go long QQQ while price holds above its 100-day average and RSI is under 70. Exit if it drops below. 8% stop, 15% take profit.",
    "summary": {
      "direction": "LONG",
      "ticker": "QQQ",
      "timeframe": "Daily",
      "entry": "Price above SMA(100) and RSI(14) below 70",
      "exit": "Price drops below SMA(100)",
      "stopLoss": "8%",
      "takeProfit": "15%",
      "period": "Jan 2023 \u2192 Jul 2026"
    },
    "stats": {
      "returnPct": 48.28,
      "trades": 43,
      "winRate": 47.6,
      "finalBalance": 14827.7,
      "initialBalance": 10000
    },
    "equityCurve": [
      {
        "t": "2023-01-13",
        "v": 10000.0
      },
      {
        "t": "2023-01-18",
        "v": 9945.19
      },
      {
        "t": "2023-01-20",
        "v": 9945.19
      },
      {
        "t": "2023-05-10",
        "v": 10688.99
      },
      {
        "t": "2023-05-11",
        "v": 10688.99
      },
      {
        "t": "2023-07-13",
        "v": 11486.2
      },
      {
        "t": "2023-07-20",
        "v": 11486.2
      },
      {
        "t": "2023-09-21",
        "v": 11206.16
      },
      {
        "t": "2023-10-06",
        "v": 11206.16
      },
      {
        "t": "2023-10-13",
        "v": 11215.07
      },
      {
        "t": "2023-10-16",
        "v": 11215.07
      },
      {
        "t": "2023-10-18",
        "v": 11123.52
      },
      {
        "t": "2023-11-03",
        "v": 11123.52
      },
      {
        "t": "2024-01-22",
        "v": 11954.13
      },
      {
        "t": "2024-01-30",
        "v": 11954.13
      },
      {
        "t": "2024-04-19",
        "v": 11812.59
      },
      {
        "t": "2024-04-23",
        "v": 11812.59
      },
      {
        "t": "2024-04-30",
        "v": 11805.95
      },
      {
        "t": "2024-05-02",
        "v": 11805.95
      },
      {
        "t": "2024-07-03",
        "v": 12685.4
      },
      {
        "t": "2024-07-11",
        "v": 12685.4
      },
      {
        "t": "2024-08-02",
        "v": 12179.1
      },
      {
        "t": "2024-08-13",
        "v": 12179.1
      },
      {
        "t": "2024-09-04",
        "v": 12153.17
      },
      {
        "t": "2024-09-05",
        "v": 12153.17
      },
      {
        "t": "2024-09-06",
        "v": 11990.62
      },
      {
        "t": "2024-09-11",
        "v": 11990.62
      },
      {
        "t": "2024-12-16",
        "v": 12887.99
      },
      {
        "t": "2024-12-17",
        "v": 12887.99
      },
      {
        "t": "2025-02-27",
        "v": 12471.61
      },
      {
        "t": "2025-05-12",
        "v": 12471.61
      },
      {
        "t": "2025-09-10",
        "v": 13403.06
      },
      {
        "t": "2025-09-11",
        "v": 13403.06
      },
      {
        "t": "2025-11-20",
        "v": 13429.03
      },
      {
        "t": "2025-11-21",
        "v": 13429.03
      },
      {
        "t": "2026-02-04",
        "v": 13615.99
      },
      {
        "t": "2026-02-09",
        "v": 13615.99
      },
      {
        "t": "2026-02-10",
        "v": 13584.43
      },
      {
        "t": "2026-02-25",
        "v": 13584.43
      },
      {
        "t": "2026-02-26",
        "v": 13502.78
      },
      {
        "t": "2026-04-09",
        "v": 13502.78
      },
      {
        "t": "2026-05-08",
        "v": 14508.49
      },
      {
        "t": "2026-05-18",
        "v": 14508.49
      }
    ],
    "recentTrades": [
      {
        "date": "2026-02-04",
        "type": "SELL",
        "price": 604.32
      },
      {
        "date": "2026-02-10",
        "type": "SELL",
        "price": 610.03
      },
      {
        "date": "2026-02-26",
        "type": "SELL",
        "price": 607.8
      },
      {
        "date": "2026-05-08",
        "type": "SELL",
        "price": 700.95
      }
    ]
  },
  "aapl": {
    "prompt": "Buy the dip on AAPL when daily RSI drops under 35, sell when it recovers above 65. 8% stop loss.",
    "summary": {
      "direction": "LONG",
      "ticker": "AAPL",
      "timeframe": "Daily",
      "entry": "RSI(14) drops below 35",
      "exit": "RSI(14) rises above 65",
      "stopLoss": "8%",
      "takeProfit": "15%",
      "period": "Jan 2023 \u2192 Jul 2026"
    },
    "stats": {
      "returnPct": 18.9,
      "trades": 21,
      "winRate": 60.0,
      "finalBalance": 11890.23,
      "initialBalance": 10000
    },
    "equityCurve": [
      {
        "t": "2023-01-03",
        "v": 10000.0
      },
      {
        "t": "2023-01-26",
        "v": 10748.96
      },
      {
        "t": "2023-08-04",
        "v": 10748.96
      },
      {
        "t": "2023-10-26",
        "v": 10319.66
      },
      {
        "t": "2023-10-27",
        "v": 10319.66
      },
      {
        "t": "2023-11-10",
        "v": 10883.72
      },
      {
        "t": "2024-01-03",
        "v": 10883.72
      },
      {
        "t": "2024-03-06",
        "v": 10449.38
      },
      {
        "t": "2024-03-07",
        "v": 10449.38
      },
      {
        "t": "2024-05-03",
        "v": 10893.58
      },
      {
        "t": "2025-01-13",
        "v": 10893.58
      },
      {
        "t": "2025-03-12",
        "v": 10459.44
      },
      {
        "t": "2025-03-13",
        "v": 10459.44
      },
      {
        "t": "2025-04-04",
        "v": 10042.28
      },
      {
        "t": "2025-04-07",
        "v": 10042.28
      },
      {
        "t": "2025-04-14",
        "v": 10794.99
      },
      {
        "t": "2026-01-06",
        "v": 10794.99
      },
      {
        "t": "2026-02-04",
        "v": 11085.53
      },
      {
        "t": "2026-03-13",
        "v": 11085.53
      },
      {
        "t": "2026-04-20",
        "v": 11591.82
      },
      {
        "t": "2026-06-25",
        "v": 11591.82
      }
    ],
    "recentTrades": [
      {
        "date": "2025-04-04",
        "type": "SELL",
        "price": 191.89
      },
      {
        "date": "2025-04-14",
        "type": "SELL",
        "price": 207.58
      },
      {
        "date": "2026-02-04",
        "type": "SELL",
        "price": 275.98
      },
      {
        "date": "2026-04-20",
        "type": "SELL",
        "price": 272.8
      }
    ]
  }
};

export const DEMO_ORDER = ["nvda", "qqq", "aapl"] as const;
