import pandas as pd
from .BacktesterHelpers.ConditionEvaluation import evaluate_condition, evaluate_condition_capture
from .BacktesterHelpers.DSLArgumentParser import get_long_short_conditions, get_open_args, get_close_args
from .BacktesterHelpers.CalculateShares import calculate_shares
from core.parsing.extractingTickers import extract_execution_timeframe, extract_data_timeframes

# ---------------- EXECUTION HELPERS ---------------- #

def apply_buy_spread(price, half_spread):
    return price * (1 + half_spread)

def apply_sell_spread(price, half_spread):
    return price * (1 - half_spread)

# ---------------- BACKTESTER ---------------- #

def backtester(parsed_dsl, data_dict, indicator_functions, initial_balance=10000,
               allow_fractional=True, fractional_precision=1):

    cash = initial_balance
    positions = {ticker: 0 for ticker in data_dict.keys()}
    trade_log = []

    execution_tf = extract_execution_timeframe(parsed_dsl)
    if isinstance(execution_tf, list):
        execution_tf = execution_tf[0]

    allowed_timeframes = extract_data_timeframes(parsed_dsl)
    print(f"Running backtest on timeframe: {execution_tf}")

    exec_dfs = {t: data_dict[t].get(execution_tf) for t in data_dict.keys()}
    max_rows = max(len(df) for df in exec_dfs.values())

    open_cond, close_cond = get_long_short_conditions(parsed_dsl)
    open_args = get_open_args(parsed_dsl)
    close_args = get_close_args(parsed_dsl)

    # -------- SPREAD FROM DSL -------- #
    spread_pct = open_args.get("spread", 0) / 100.0
    half_spread = spread_pct / 2

    last_recurring_index = {ticker: -float("inf") for ticker in data_dict.keys()}
    recurring_count = {ticker: 0 for ticker in data_dict.keys()}

    for i in range(max_rows):
        current_prices = {
            t: data_dict[t][execution_tf].iloc[min(i, len(data_dict[t][execution_tf]) - 1)]["Close"]
            for t in data_dict.keys()
        }

        for ticker in data_dict.keys():
            exec_df = exec_dfs[ticker]
            row = exec_df.iloc[min(i, len(exec_df) - 1)]
            timestamp_str = row.name.isoformat()

            can_buy = positions[ticker] == 0
            can_recurring = open_args.get("recurring", False) and positions[ticker] > 0
            max_recurs = open_args.get("maxRecurringCount", 0)

            # ---------------- OPEN POSITION ---------------- #
            if can_buy and open_cond and evaluate_condition(
                open_cond, row, indicator_functions, data_dict, ticker,
                context_index=i, allowed_timeframes=allowed_timeframes,
                execution_tf=execution_tf
            ):
                result, *_ = evaluate_condition_capture(
                    open_cond, row, indicator_functions, data_dict, ticker,
                    context_index=i, allowed_timeframes=allowed_timeframes,
                    execution_tf=execution_tf
                )

                if result:
                    market_price = current_prices[ticker]
                    execution_price = apply_buy_spread(market_price, half_spread)

                    invest_type = open_args.get("initialOpenPositionInvestType", "fixedValue")
                    invest_amount = open_args.get("initialOpenPositionInvestAmount", 0.2)

                    shares = calculate_shares(
                        cash, execution_price, invest_type, invest_amount,
                        allow_fractional, fractional_precision
                    )

                    if shares > 0:
                        cash -= shares * execution_price
                        positions[ticker] += shares
                        last_recurring_index[ticker] = i
                        recurring_count[ticker] = 0

                        sl_pct = open_args.get("stopLossPercent")
                        tp_pct = open_args.get("takeProfitPercent")

                        sl_price = execution_price * (1 - sl_pct / 100) if sl_pct else None
                        tp_price = execution_price * (1 + tp_pct / 100) if tp_pct else None

                        trade_log.append({
                            "type": "BUY",
                            "ticker": ticker,
                            "raw_price": market_price,
                            "price": execution_price,
                            "shares": shares,
                            "balance": cash,
                            "timestamp": timestamp_str,
                            "sl_price": sl_price,
                            "tp_price": tp_price
                        })

            # ---------------- RECURRING BUY ---------------- #
            if can_recurring:
                period = open_args.get("recurringPeriod", 1)
                if i - last_recurring_index[ticker] >= period:
                    if max_recurs == 0 or recurring_count[ticker] < max_recurs:
                        market_price = current_prices[ticker]
                        execution_price = apply_buy_spread(market_price, half_spread)

                        rec_type = open_args.get("recurringInvestType", "percentCashBalance")
                        rec_amt = open_args.get("recurringInvestAmount", 0.1)

                        shares = calculate_shares(
                            cash, execution_price, rec_type, rec_amt,
                            allow_fractional, fractional_precision
                        )

                        if shares > 0:
                            cash -= shares * execution_price
                            positions[ticker] += shares
                            last_recurring_index[ticker] = i
                            recurring_count[ticker] += 1

                            sl_pct = open_args.get("stopLossPercent")
                            tp_pct = open_args.get("takeProfitPercent")

                            sl_price = execution_price * (1 - sl_pct / 100) if sl_pct else None
                            tp_price = execution_price * (1 + tp_pct / 100) if tp_pct else None

                            trade_log.append({
                                "type": "RECURRING_BUY",
                                "ticker": ticker,
                                "raw_price": market_price,
                                "price": execution_price,
                                "shares": shares,
                                "balance": cash,
                                "timestamp": timestamp_str,
                                "sl_price": sl_price,
                                "tp_price": tp_price
                            })

            # ---------------- CLOSE / SL / TP ---------------- #
            if positions[ticker] > 0:
                last_trade = next(
                    (t for t in reversed(trade_log)
                     if t["ticker"] == ticker and t["type"] in ("BUY", "RECURRING_BUY")),
                    None
                )

                if last_trade:
                    close_price = None
                    reason = None

                    if last_trade["sl_price"] and row["Low"] <= last_trade["sl_price"]:
                        close_price = last_trade["sl_price"]
                        reason = "SL"

                    elif last_trade["tp_price"] and row["High"] >= last_trade["tp_price"]:
                        close_price = last_trade["tp_price"]
                        reason = "TP"

                    elif close_cond and evaluate_condition(
                        close_cond, row, indicator_functions, data_dict, ticker,
                        context_index=i, allowed_timeframes=allowed_timeframes,
                        execution_tf=execution_tf
                    ):
                        close_price = current_prices[ticker]
                        reason = "CLOSE_CONDITION"

                    if close_price is not None:
                        execution_price = apply_sell_spread(close_price, half_spread)
                        shares = positions[ticker]

                        cash += shares * execution_price
                        positions[ticker] = 0

                        trade_log.append({
                            "type": "SELL",
                            "ticker": ticker,
                            "raw_price": close_price,
                            "price": execution_price,
                            "shares": shares,
                            "balance": cash,
                            "timestamp": timestamp_str,
                            "close_reason": reason
                        })

    total_value = cash + sum(
        positions[t] * current_prices[t] for t in positions
    )

    pct_change = (total_value - initial_balance) / initial_balance * 100
    return trade_log, cash, positions, pct_change