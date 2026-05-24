# generate_training_data_complete.py
import json
import random

# ---------------- REGISTRIES ----------------
INDICATORS = {
    "PRICE": {"args": ["OHLC", "offset"], "defaults": {"OHLC": "close", "offset": 0}},
    "VOLUME": {"args": ["offset"], "defaults": {"offset": 0}},
    "SMA": {"args": ["period", "timeframe", "offset"], "defaults": {"period": 14, "timeframe": "1h", "offset": 0}},
    "EMA": {"args": ["period", "timeframe", "offset"], "defaults": {"period": 14, "timeframe": "1h", "offset": 0}},
    "RSI": {"args": ["period", "timeframe", "offset"], "defaults": {"period": 14, "timeframe": "1h", "offset": 0}},
    "MACD": {"args": ["fast", "slow", "signal", "timeframe", "offset"], "defaults": {"fast": 12, "slow": 26, "signal": 9, "timeframe": "1h", "offset": 0}},
    "BBANDS": {"args": ["period", "stddev", "timeframe", "offset"], "defaults": {"period": 20, "stddev": 2, "timeframe": "1h", "offset": 0}},
    "ATR": {"args": ["period", "timeframe", "offset"], "defaults": {"period": 14, "timeframe": "1h", "offset": 0}},
    "STOCH": {"args": ["k_period", "d_period", "slowing", "timeframe", "offset"], "defaults": {"k_period": 14, "d_period": 3, "slowing": 3, "timeframe": "1h", "offset": 0}},
    "CCI": {"args": ["period", "timeframe", "offset"], "defaults": {"period": 20, "timeframe": "1h", "offset": 0}},
    "OBV": {"args": ["timeframe", "offset"], "defaults": {"timeframe": "1h", "offset": 0}}
}

TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"]
TICKERS = ["AAPL", "MSFT", "GOOGL", "TSLA", "AMZN", "NVDA", "META", "SPY", "QQQ", "BTC-USD"]

# ---------------- CONDITION TEMPLATES ----------------
CONDITION_TEMPLATES = {
    "gap_up": {
        "template": "Buy {ticker} whenever it gaps up from yesterday's close to today's open by {pct}% or more, set TP at {tp}% and SL at {sl}% on the {tf} timeframe",
        "json_builder": lambda ticker, tf, pct, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 1}},
                        "operator": "<",
                        "right": {
                            "op": "*",
                            "left": {"func": "PRICE", "arg": {"OHLC": "open", "offset": 0}},
                            "right": {"value": 1 + pct / 100}
                        }
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "gap_down_short": {
        "template": "Short {ticker} when it gaps down {pct}% or more from previous close on {tf} candles, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, pct, tp, sl: {
            "SHORT": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "open", "offset": 0}},
                        "operator": "<",
                        "right": {
                            "op": "*",
                            "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 1}},
                            "right": {"value": 1 - pct / 100}
                        }
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "rsi_oversold": {
        "template": "Enter long on {ticker} when RSI {period} drops below {threshold} on {tf} timeframe, exit at {tp}% profit or {sl}% loss",
        "json_builder": lambda ticker, tf, period, threshold, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": period, "timeframe": tf, "offset": 0}},
                        "operator": "<",
                        "right": {"value": threshold}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "rsi_overbought_short": {
        "template": "Short {ticker} when RSI({period}) exceeds {threshold} on the {tf} chart, take profit {tp}%, stop loss {sl}%",
        "json_builder": lambda ticker, tf, period, threshold, tp, sl: {
            "SHORT": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": period, "timeframe": tf, "offset": 0}},
                        "operator": ">",
                        "right": {"value": threshold}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "sma_crossover": {
        "template": "Buy {ticker} when price crosses above {period}-period SMA on {tf} timeframe, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, period, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                        "operator": ">",
                        "right": {"func": "SMA", "arg": {"period": period, "timeframe": tf, "offset": 0}}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "sma_cross_below_short": {
        "template": "Short {ticker} on {tf} when price falls below SMA({period}), set take profit at {tp}% and stop at {sl}%",
        "json_builder": lambda ticker, tf, period, tp, sl: {
            "SHORT": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                        "operator": "<",
                        "right": {"func": "SMA", "arg": {"period": period, "timeframe": tf, "offset": 0}}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "golden_cross": {
        "template": "Enter {ticker} long when 50-day SMA crosses above 200-day SMA on {tf}, risk {sl}% for {tp}% reward",
        "json_builder": lambda ticker, tf, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "SMA", "arg": {"period": 50, "timeframe": tf, "offset": 0}},
                        "operator": ">",
                        "right": {"func": "SMA", "arg": {"period": 200, "timeframe": tf, "offset": 0}}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "macd_crossover": {
        "template": "Buy {ticker} when MACD crosses above zero on {tf} timeframe, profit target {tp}%, stop {sl}%",
        "json_builder": lambda ticker, tf, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "MACD", "arg": {"fast": 12, "slow": 26, "signal": 9, "timeframe": tf, "offset": 0}},
                        "operator": ">",
                        "right": {"value": 0}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "rsi_and_macd": {
        "template": "Long {ticker} when RSI is above {rsi_threshold} AND MACD is positive on {tf} chart, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, rsi_threshold, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "AND": [
                            {
                                "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                                "operator": ">",
                                "right": {"value": rsi_threshold}
                            },
                            {
                                "left": {"func": "MACD", "arg": {"fast": 12, "slow": 26, "signal": 9, "timeframe": tf, "offset": 0}},
                                "operator": ">",
                                "right": {"value": 0}
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "rsi_or_oversold": {
        "template": "Buy {ticker} on {tf} when RSI drops below {threshold1} OR stochastic is below {threshold2}, take profit {tp}%, stop loss {sl}%",
        "json_builder": lambda ticker, tf, threshold1, threshold2, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "OR": [
                            {
                                "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                                "operator": "<",
                                "right": {"value": threshold1}
                            },
                            {
                                "left": {"func": "STOCH", "arg": {"k_period": 14, "d_period": 3, "slowing": 3, "timeframe": tf, "offset": 0}},
                                "operator": "<",
                                "right": {"value": threshold2}
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "price_above_sma_and_rsi": {
        "template": "Enter long {ticker} when price is above {sma_period}-SMA AND RSI({rsi_period}) > {rsi_val} on {tf}, profit {tp}%, risk {sl}%",
        "json_builder": lambda ticker, tf, sma_period, rsi_period, rsi_val, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "AND": [
                            {
                                "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                                "operator": ">",
                                "right": {"func": "SMA", "arg": {"period": sma_period, "timeframe": tf, "offset": 0}}
                            },
                            {
                                "left": {"func": "RSI", "arg": {"period": rsi_period, "timeframe": tf, "offset": 0}},
                                "operator": ">",
                                "right": {"value": rsi_val}
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "recurring_dca": {
        "template": "Buy {ticker} when RSI < {threshold} on {tf}, invest {initial}% initially then {recurring}% every {period} candles up to {max_count} times, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, threshold, initial, recurring, period, max_count, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                        "operator": "<",
                        "right": {"value": threshold}
                    },
                    "ARGUMENTS": {
                        "initialOpenPositionInvestType": "percentCashBalance",
                        "initialOpenPositionInvestAmount": initial / 100,
                        "recurring": True,
                        "recurringPeriod": period,
                        "recurringInvestType": "percentCashBalance",
                        "recurringInvestAmount": recurring / 100,
                        "maxRecurringCount": max_count,
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "price_percent_below_sma": {
        "template": "Buy {ticker} when price is {pct}% or more below the {period}-day SMA on {tf}, target {tp}% gain, risk {sl}%",
        "json_builder": lambda ticker, tf, pct, period, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                        "operator": "<",
                        "right": {
                            "op": "*",
                            "left": {"func": "SMA", "arg": {"period": period, "timeframe": tf, "offset": 0}},
                            "right": {"value": 1 - pct / 100}
                        }
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "volume_spike": {
        "template": "Enter {ticker} long when volume exceeds {multiplier}x the average on {tf}, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, multiplier, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "VOLUME", "arg": {"offset": 0}},
                        "operator": ">",
                        "right": {
                            "op": "*",
                            "left": {"func": "SMA", "arg": {"period": 20, "timeframe": tf, "offset": 0}},
                            "right": {"value": multiplier}
                        }
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "close_condition_example": {
        "template": "Buy {ticker} when RSI < {open_rsi} on {tf}, close position when RSI > {close_rsi}, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, open_rsi, close_rsi, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                        "operator": "<",
                        "right": {"value": open_rsi}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                },
                "CLOSE": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                        "operator": ">",
                        "right": {"value": close_rsi}
                    },
                    "ARGUMENTS": {"test": 0.5}
                }
            }
        }
    },
    
    "simple_price_threshold": {
        "template": "Buy {ticker} when price drops below ${price} on {tf} timeframe, target {tp}% profit, stop at {sl}%",
        "json_builder": lambda ticker, tf, price, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                        "operator": "<",
                        "right": {"value": price}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "ema_crossover": {
        "template": "Go long {ticker} when {fast}-period EMA crosses above {slow}-period EMA on {tf}, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, fast, slow, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "EMA", "arg": {"period": fast, "timeframe": tf, "offset": 0}},
                        "operator": ">",
                        "right": {"func": "EMA", "arg": {"period": slow, "timeframe": tf, "offset": 0}}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "bollinger_breakout": {
        "template": "Enter {ticker} long when price breaks above upper Bollinger Band on {tf} chart, take profit {tp}%, stop {sl}%",
        "json_builder": lambda ticker, tf, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                        "operator": ">",
                        "right": {"func": "BBANDS", "arg": {"period": 20, "stddev": 2, "timeframe": tf, "offset": 0}}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "atr_trailing_stop": {
        "template": "Short {ticker} when RSI > {rsi_threshold} on {tf}, profit target {tp}%, stop loss {sl}%",
        "json_builder": lambda ticker, tf, rsi_threshold, tp, sl: {
            "SHORT": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                        "operator": ">",
                        "right": {"value": rsi_threshold}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "multi_timeframe": {
        "template": "Buy {ticker} when daily RSI is oversold below {daily_rsi} AND hourly RSI crosses above {hourly_rsi} on {tf}, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, daily_rsi, hourly_rsi, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "AND": [
                            {
                                "left": {"func": "RSI", "arg": {"period": 14, "timeframe": "1D", "offset": 0}},
                                "operator": "<",
                                "right": {"value": daily_rsi}
                            },
                            {
                                "left": {"func": "RSI", "arg": {"period": 14, "timeframe": "1h", "offset": 0}},
                                "operator": ">",
                                "right": {"value": hourly_rsi}
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "mean_reversion": {
        "template": "Long {ticker} when price is {pct}% below {period}-period EMA on {tf}, close when price returns to EMA, max risk {sl}%",
        "json_builder": lambda ticker, tf, pct, period, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                        "operator": "<",
                        "right": {
                            "op": "*",
                            "left": {"func": "EMA", "arg": {"period": period, "timeframe": tf, "offset": 0}},
                            "right": {"value": 1 - pct / 100}
                        }
                    },
                    "ARGUMENTS": {
                        "stopLossPercent": sl / 100
                    }
                },
                "CLOSE": {
                    "CONDITIONS": {
                        "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                        "operator": ">=",
                        "right": {"func": "EMA", "arg": {"period": period, "timeframe": tf, "offset": 0}}
                    },
                    "ARGUMENTS": {"test": 0.5}
                }
            }
        }
    },
    
    "breakout_volume_confirmation": {
        "template": "Enter {ticker} when price > {period}-SMA AND volume > {vol_mult}x average volume on {tf}, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, period, vol_mult, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "AND": [
                            {
                                "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                                "operator": ">",
                                "right": {"func": "SMA", "arg": {"period": period, "timeframe": tf, "offset": 0}}
                            },
                            {
                                "left": {"func": "VOLUME", "arg": {"offset": 0}},
                                "operator": ">",
                                "right": {
                                    "op": "*",
                                    "left": {"func": "SMA", "arg": {"period": 20, "timeframe": tf, "offset": 0}},
                                    "right": {"value": vol_mult}
                                }
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "triple_condition": {
        "template": "Buy {ticker} on {tf} when price is above {sma}-SMA AND RSI is between {rsi_low} and {rsi_high} AND MACD > 0, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, sma, rsi_low, rsi_high, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "AND": [
                            {
                                "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                                "operator": ">",
                                "right": {"func": "SMA", "arg": {"period": sma, "timeframe": tf, "offset": 0}}
                            },
                            {
                                "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                                "operator": ">",
                                "right": {"value": rsi_low}
                            },
                            {
                                "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                                "operator": "<",
                                "right": {"value": rsi_high}
                            },
                            {
                                "left": {"func": "MACD", "arg": {"fast": 12, "slow": 26, "signal": 9, "timeframe": tf, "offset": 0}},
                                "operator": ">",
                                "right": {"value": 0}
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "fixed_investment": {
        "template": "Buy {ticker} with ${amount} when RSI drops below {rsi} on {tf}, set TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, amount, rsi, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "RSI", "arg": {"period": 14, "timeframe": tf, "offset": 0}},
                        "operator": "<",
                        "right": {"value": rsi}
                    },
                    "ARGUMENTS": {
                        "initialOpenPositionInvestType": "fixedValue",
                        "initialOpenPositionInvestAmount": amount,
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "stochastic_oversold": {
        "template": "Enter {ticker} long when Stochastic is below {threshold} on {tf}, target {tp}% gain, risk {sl}%",
        "json_builder": lambda ticker, tf, threshold, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "STOCH", "arg": {"k_period": 14, "d_period": 3, "slowing": 3, "timeframe": tf, "offset": 0}},
                        "operator": "<",
                        "right": {"value": threshold}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "cci_strategy": {
        "template": "Go long {ticker} when CCI({period}) drops below {threshold} on {tf} timeframe, exit at {tp}% profit or {sl}% loss",
        "json_builder": lambda ticker, tf, period, threshold, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "left": {"func": "CCI", "arg": {"period": period, "timeframe": tf, "offset": 0}},
                        "operator": "<",
                        "right": {"value": threshold}
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "obv_divergence": {
        "template": "Buy {ticker} when OBV is rising while price is falling on {tf}, TP {tp}%, SL {sl}%",
        "json_builder": lambda ticker, tf, tp, sl: {
            "LONG": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "AND": [
                            {
                                "left": {"func": "OBV", "arg": {"timeframe": tf, "offset": 0}},
                                "operator": ">",
                                "right": {"func": "OBV", "arg": {"timeframe": tf, "offset": 1}}
                            },
                            {
                                "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                                "operator": "<",
                                "right": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 1}}
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    },
    
    "price_action_reversal": {
        "template": "Short {ticker} when current close is below open AND previous candle was bullish on {tf}, target {tp}%, risk {sl}%",
        "json_builder": lambda ticker, tf, tp, sl: {
            "SHORT": {
                "context": {
                    "tickers": [ticker],
                    "execution_timeframe": tf,
                    "dateframe": {"start": "2025-01-01", "end": "2026-01-01"}
                },
                "OPEN": {
                    "CONDITIONS": {
                        "AND": [
                            {
                                "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 0}},
                                "operator": "<",
                                "right": {"func": "PRICE", "arg": {"OHLC": "open", "offset": 0}}
                            },
                            {
                                "left": {"func": "PRICE", "arg": {"OHLC": "close", "offset": 1}},
                                "operator": ">",
                                "right": {"func": "PRICE", "arg": {"OHLC": "open", "offset": 1}}
                            }
                        ]
                    },
                    "ARGUMENTS": {
                        "takeProfitPercent": tp / 100,
                        "stopLossPercent": sl / 100
                    }
                }
            }
        }
    }
}

# ---------------- PARAMETER GENERATION ----------------

def generate_example(template_name):
    """Generate one training example from a template"""
    template_data = CONDITION_TEMPLATES[template_name]
    ticker = random.choice(TICKERS)
    tf = random.choice(TIMEFRAMES)
    
    # Generate parameters based on template type
    if template_name == "gap_up":
        pct = random.choice([3, 5, 7, 10])
        tp = random.choice([5, 7, 10, 15, 20])
        sl = random.choice([2, 3, 5, 7])
        text = template_data["template"].format(ticker=ticker, tf=tf, pct=pct, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, pct, tp, sl)
        
    elif template_name == "gap_down_short":
        pct = random.choice([3, 5, 7, 10])
        tp = random.choice([5, 7, 10, 15])
        sl = random.choice([2, 3, 5, 7])
        text = template_data["template"].format(ticker=ticker, tf=tf, pct=pct, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, pct, tp, sl)
        
    elif template_name == "rsi_oversold":
        period = random.choice([7, 14, 21])
        threshold = random.choice([20, 25, 30, 35])
        tp = random.choice([10, 15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, period=period, threshold=threshold, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, period, threshold, tp, sl)
        
    elif template_name == "rsi_overbought_short":
        period = random.choice([7, 14, 21])
        threshold = random.choice([65, 70, 75, 80])
        tp = random.choice([10, 15, 20])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, period=period, threshold=threshold, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, period, threshold, tp, sl)
        
    elif template_name == "sma_crossover":
        period = random.choice([20, 50, 100, 200])
        tp = random.choice([10, 15, 20, 30])
        sl = random.choice([5, 7, 10, 15])
        text = template_data["template"].format(ticker=ticker, tf=tf, period=period, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, period, tp, sl)
        
    elif template_name == "sma_cross_below_short":
        period = random.choice([20, 50, 100])
        tp = random.choice([10, 15, 20])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, period=period, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, period, tp, sl)
        
    elif template_name == "golden_cross":
        tp = random.choice([20, 30, 40, 50])
        sl = random.choice([10, 15, 20])
        text = template_data["template"].format(ticker=ticker, tf=tf, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, tp, sl)
        
    elif template_name == "macd_crossover":
        tp = random.choice([10, 15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, tp, sl)
        
    elif template_name == "rsi_and_macd":
        rsi_threshold = random.choice([40, 45, 50, 55])
        tp = random.choice([15, 20, 25, 30])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, rsi_threshold=rsi_threshold, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, rsi_threshold, tp, sl)
        
    elif template_name == "rsi_or_oversold":
        threshold1 = random.choice([25, 30, 35])
        threshold2 = random.choice([20, 25, 30])
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, threshold1=threshold1, threshold2=threshold2, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, threshold1, threshold2, tp, sl)
        
    elif template_name == "price_above_sma_and_rsi":
        sma_period = random.choice([20, 50, 100])
        rsi_period = random.choice([7, 14, 21])
        rsi_val = random.choice([40, 45, 50, 55])
        tp = random.choice([15, 20, 25, 30])
        sl = random.choice([5, 7, 10, 15])
        text = template_data["template"].format(ticker=ticker, tf=tf, sma_period=sma_period, rsi_period=rsi_period, rsi_val=rsi_val, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, sma_period, rsi_period, rsi_val, tp, sl)
        
    elif template_name == "recurring_dca":
        threshold = random.choice([30, 35, 40])
        initial = random.choice([10, 15, 20])
        recurring = random.choice([5, 10, 15])
        period = random.choice([5, 10, 20])
        max_count = random.choice([3, 5, 10])
        tp = random.choice([20, 30, 40])
        sl = random.choice([10, 15, 20])
        text = template_data["template"].format(ticker=ticker, tf=tf, threshold=threshold, initial=initial, recurring=recurring, period=period, max_count=max_count, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, threshold, initial, recurring, period, max_count, tp, sl)
        
    elif template_name == "price_percent_below_sma":
        pct = random.choice([5, 10, 15])
        period = random.choice([20, 50, 100, 200])
        tp = random.choice([10, 15, 20, 30])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, pct=pct, period=period, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, pct, period, tp, sl)
        
    elif template_name == "volume_spike":
        multiplier = random.choice([1.5, 2, 2.5, 3])
        tp = random.choice([10, 15, 20])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, multiplier=multiplier, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, multiplier, tp, sl)
        
    elif template_name == "close_condition_example":
        open_rsi = random.choice([25, 30, 35])
        close_rsi = random.choice([65, 70, 75])
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, open_rsi=open_rsi, close_rsi=close_rsi, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, open_rsi, close_rsi, tp, sl)
        
    elif template_name == "simple_price_threshold":
        price = random.choice([50, 100, 150, 200, 250, 300])
        tp = random.choice([10, 15, 20])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, price=price, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, price, tp, sl)
        
    elif template_name == "ema_crossover":
        fast = random.choice([9, 12, 20])
        slow = random.choice([26, 50, 100])
        tp = random.choice([15, 20, 30])
        sl = random.choice([5, 10, 15])
        text = template_data["template"].format(ticker=ticker, tf=tf, fast=fast, slow=slow, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, fast, slow, tp, sl)
        
    elif template_name == "bollinger_breakout":
        tp = random.choice([10, 15, 20])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, tp, sl)
        
    elif template_name == "atr_trailing_stop":
        rsi_threshold = random.choice([65, 70, 75, 80])
        tp = random.choice([10, 15, 20])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, rsi_threshold=rsi_threshold, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, rsi_threshold, tp, sl)
        
    elif template_name == "multi_timeframe":
        daily_rsi = random.choice([25, 30, 35])
        hourly_rsi = random.choice([40, 45, 50])
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, daily_rsi=daily_rsi, hourly_rsi=hourly_rsi, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, daily_rsi, hourly_rsi, tp, sl)
        
    elif template_name == "mean_reversion":
        pct = random.choice([3, 5, 7, 10])
        period = random.choice([20, 50, 100])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, pct=pct, period=period, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, pct, period, sl)
        
    elif template_name == "breakout_volume_confirmation":
        period = random.choice([20, 50, 100])
        vol_mult = random.choice([1.5, 2, 2.5, 3])
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, period=period, vol_mult=vol_mult, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, period, vol_mult, tp, sl)
        
    elif template_name == "triple_condition":
        sma = random.choice([20, 50, 100])
        rsi_low = random.choice([40, 45, 50])
        rsi_high = random.choice([60, 65, 70])
        tp = random.choice([20, 25, 30])
        sl = random.choice([5, 10, 15])
        text = template_data["template"].format(ticker=ticker, tf=tf, sma=sma, rsi_low=rsi_low, rsi_high=rsi_high, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, sma, rsi_low, rsi_high, tp, sl)
        
    elif template_name == "fixed_investment":
        amount = random.choice([500, 1000, 2000, 5000])
        rsi = random.choice([25, 30, 35])
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, amount=amount, rsi=rsi, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, amount, rsi, tp, sl)
        
    elif template_name == "stochastic_oversold":
        threshold = random.choice([20, 25, 30])
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, threshold=threshold, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, threshold, tp, sl)
        
    elif template_name == "cci_strategy":
        period = random.choice([14, 20, 30])
        threshold = random.choice([-200, -150, -100])
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, period=period, threshold=threshold, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, period, threshold, tp, sl)
        
    elif template_name == "obv_divergence":
        tp = random.choice([15, 20, 25])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, tp, sl)
        
    elif template_name == "price_action_reversal":
        tp = random.choice([10, 15, 20])
        sl = random.choice([5, 7, 10])
        text = template_data["template"].format(ticker=ticker, tf=tf, tp=tp, sl=sl)
        json_output = template_data["json_builder"](ticker, tf, tp, sl)
    
    else:
        raise ValueError(f"Unknown template: {template_name}")
    
    return text, json_output

# ---------------- MAIN GENERATION FUNCTION ----------------

def generate_dataset(num_examples=500, output_file="training_data.jsonl"):
    """Generate complete training dataset"""
    template_names = list(CONDITION_TEMPLATES.keys())
    
    with open(output_file, "w") as f:
        for i in range(num_examples):
            template = random.choice(template_names)
            
            text, json_output = generate_example(template)
            
            example = {
                "instruction": "Convert this trading strategy to JSON",
                "input": text,
                "output": json_output
            }
            
            f.write(json.dumps(example) + "\n")
            
            if (i + 1) % 50 == 0:
                print(f"Generated {i + 1}/{num_examples} examples...")
    
    print(f"\n✓ Dataset saved to {output_file}")
    print(f"\n✓ Total templates: {len(template_names)}")
    print("\nSample examples:")
    with open(output_file, "r") as f:
        for i, line in enumerate(f):
            if i < 3:
                ex = json.loads(line)
                print(f"\n--- Example {i+1} ---")
                print(f"Input: {ex['input']}")
                print(f"Output (truncated): {json.dumps(ex['output'], indent=2)[:300]}...")

if __name__ == "__main__":
    generate_dataset(500)