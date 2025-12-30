import pandas as pd
from .BacktesterHelpers.ConditionEvaluation import evaluate_condition, evaluate_condition_capture
from .BacktesterHelpers.DSLArgumentParser import get_long_short_conditions, get_open_args, get_close_args
from .BacktesterHelpers.CalculateShares import calculate_shares
from core.parsing.extractingTickers import extract_execution_timeframe, extract_data_timeframes

def backtester(parsed_dsl, data_dict, indicator_functions, initial_balance=10000,
               allow_fractional=True, fractional_precision=1):
    """
    Run a backtest given parsed DSL and data dictionary.
    fractional_precision limits how many decimal places fractional shares can have.
    Supports optional SL/TP in OPEN arguments.
    """
    cash = initial_balance
    positions = {ticker: 0 for ticker in data_dict.keys()}
    trade_log = []

    # Determine execution timeframe once
    execution_tf = extract_execution_timeframe(parsed_dsl)
    if isinstance(execution_tf, list):
        execution_tf = execution_tf[0]
    allowed_timeframes= extract_data_timeframes(parsed_dsl)
    print(f"Running backtest on timeframe: {execution_tf}")

    # Precompute max rows per ticker for execution timeframe
    exec_dfs = {t: data_dict[t].get(execution_tf, None) for t in data_dict.keys()}
    for t, df in exec_dfs.items():
        if df is None or df.empty:
            raise ValueError(f"No execution data for ticker '{t}' on timeframe '{execution_tf}'")
    max_rows = max(len(df) for df in exec_dfs.values())

    open_cond, close_cond = get_long_short_conditions(parsed_dsl)
    open_args = get_open_args(parsed_dsl)
    close_args = get_close_args(parsed_dsl)

    last_recurring_index = {ticker: -float('inf') for ticker in data_dict.keys()}
    recurring_count = {ticker: 0 for ticker in data_dict.keys()}

    # Loop over execution timeframe
    for i in range(max_rows):
        current_prices = {t: data_dict[t][execution_tf].iloc[min(i, len(data_dict[t][execution_tf])-1)]["Close"]
                          for t in data_dict.keys()}

        for ticker in data_dict.keys():
            exec_df = exec_dfs[ticker]
            row = exec_df.iloc[min(i, len(exec_df)-1)]
            timestamp_str = row.name.isoformat()

            can_buy = positions[ticker] == 0
            can_recurring = open_args.get("recurring", False) and positions[ticker] > 0
            max_recurs = open_args.get("maxRecurringCount", 0)

            # --- OPEN POSITION ---
            if can_buy and open_cond and evaluate_condition(open_cond, row, indicator_functions, data_dict, ticker, context_index=i, allowed_timeframes=allowed_timeframes, execution_tf=execution_tf):
                result, left_val, right_val, used_tf = evaluate_condition_capture(
                    open_cond, row, indicator_functions, data_dict, ticker,
                    context_index=i, allowed_timeframes=allowed_timeframes, execution_tf=execution_tf
                )
                if result:
                    print(f"[OPEN POSITION] Ticker: {ticker}, Time: {row.name}, RSI ({used_tf}): {left_val}")

                    invest_type = open_args.get("initialOpenPositionInvestType", "fixedValue")
                    invest_amount = open_args.get("initialOpenPositionInvestAmount", 0.2)
                    shares_to_buy = calculate_shares(
                        cash, current_prices[ticker], invest_type, invest_amount,
                        allow_fractional, fractional_precision
                    )

                    if shares_to_buy > 0:
                        cost = shares_to_buy * current_prices[ticker]
                        cash -= cost
                        positions[ticker] += shares_to_buy
                        last_recurring_index[ticker] = i
                        recurring_count[ticker] = 0

                        # --- SL/TP Calculation ---
                        sl_percent = open_args.get("stopLossPercent", None)
                        tp_percent = open_args.get("takeProfitPercent", None)
                        execution_price = current_prices[ticker]
                        sl_price = execution_price * (1 - sl_percent/100) if sl_percent is not None else None
                        tp_price = execution_price * (1 + tp_percent/100) if tp_percent is not None else None

                        trade_log.append({
                            "type": "BUY",
                            "ticker": ticker,
                            "price": execution_price,
                            "shares": shares_to_buy,
                            "balance": cash,
                            "open_positions_value": sum(positions[t]*current_prices[t] for t in positions),
                            "timestamp": timestamp_str,
                            "sl_price": sl_price,
                            "tp_price": tp_price
                        })

            # --- RECURRING BUY ---
            if can_recurring and open_args.get("recurring", False):
                period = open_args.get("recurringPeriod", 1)
                if i - last_recurring_index[ticker] >= period:
                    if max_recurs == 0 or recurring_count[ticker] < max_recurs:
                        rec_invest_type = open_args.get("recurringInvestType", "percentCashBalance")
                        rec_invest_amount = open_args.get("recurringInvestAmount", 0.1)
                        shares_to_buy = calculate_shares(
                            cash, current_prices[ticker], rec_invest_type, rec_invest_amount,
                            allow_fractional, fractional_precision
                        )

                        if shares_to_buy > 0:
                            cost = shares_to_buy * current_prices[ticker]
                            cash -= cost
                            positions[ticker] += shares_to_buy
                            last_recurring_index[ticker] = i
                            recurring_count[ticker] += 1

                            # --- SL/TP for recurring buy ---
                            sl_percent = open_args.get("stopLossPercent", None)
                            tp_percent = open_args.get("takeProfitPercent", None)
                            execution_price = current_prices[ticker]
                            sl_price = execution_price * (1 - sl_percent/100) if sl_percent is not None else None
                            tp_price = execution_price * (1 + tp_percent/100) if tp_percent is not None else None

                            trade_log.append({
                                "type": "RECURRING_BUY",
                                "ticker": ticker,
                                "price": execution_price,
                                "shares": shares_to_buy,
                                "balance": cash,
                                "open_positions_value": sum(positions[t]*current_prices[t] for t in positions),
                                "timestamp": timestamp_str,
                                "sl_price": sl_price,
                                "tp_price": tp_price
                            })

            # --- CHECK SL/TP AND CLOSE CONDITIONS ---
            if positions[ticker] > 0:
                # Get last trade with SL/TP for this ticker
                last_trade = next((tr for tr in reversed(trade_log) if tr["ticker"] == ticker and tr["type"] in ("BUY", "RECURRING_BUY")), None)
                if last_trade:
                    sl_price = last_trade.get("sl_price")
                    tp_price = last_trade.get("tp_price")
                    close_price = None

                    # Check SL first
                    if sl_price is not None and row["Low"] <= sl_price:
                        close_price = sl_price
                        reason = "SL"
                    # Then TP
                    elif tp_price is not None and row["High"] >= tp_price:
                        close_price = tp_price
                        reason = "TP"
                    # Then dynamic CLOSE
                    elif close_cond and evaluate_condition(close_cond, row, indicator_functions, data_dict, ticker, context_index=i, allowed_timeframes=allowed_timeframes, execution_tf=execution_tf):
                        close_price = current_prices[ticker]
                        reason = "CLOSE_CONDITION"

                    if close_price is not None:
                        shares_to_sell = positions[ticker]
                        cash += shares_to_sell * close_price
                        positions[ticker] = 0
                        print(f"[SELL POSITION] Ticker: {ticker}, Time: {row.name}, Reason: {reason}, Price: {close_price}")
                        trade_log.append({
                            "type": "SELL",
                            "ticker": ticker,
                            "price": close_price,
                            "shares": shares_to_sell,
                            "balance": cash,
                            "open_positions_value": sum(positions[t]*current_prices[t] for t in positions),
                            "timestamp": timestamp_str,
                            "close_reason": reason
                        })
                        continue  # skip recurring buy for this iteration if we just closed

    total_value = cash + sum(positions[t]*current_prices[t] for t in positions)
    pct_change = (total_value - initial_balance) / initial_balance * 100
    return trade_log, cash, positions, pct_change
