import pandas as pd
from Backtesting.BacktesterHelpers.ConditionEvaluation import evaluate_condition, evaluate_condition_capture
from Backtesting.BacktesterHelpers.DSLArgumentParser import get_long_short_conditions, get_open_args, get_close_args
from Backtesting.BacktesterHelpers.CalculateShares import calculate_shares
from Parsing.extractingTickers import extract_execution_timeframe

def backtester(parsed_dsl, data_dict, indicator_functions, initial_balance=10000,
               allow_fractional=True, fractional_precision=1, allowed_timeframes=None, execution_tf=None):
    """
    Run a backtest given parsed DSL and data dictionary.
    fractional_precision limits how many decimal places fractional shares can have.
    """
    cash = initial_balance
    positions = {ticker: 0 for ticker in data_dict.keys()}
    trade_log = []


   # Determine execution timeframe once
    execution_tf = extract_execution_timeframe(parsed_dsl)
    if isinstance(execution_tf, list):
       execution_tf = execution_tf[0]

    print(f"Running backtest on timeframe: {execution_tf}")


   # Precompute max rows per ticker for execution timeframe
    print(data_dict.keys())
    exec_dfs = {t: data_dict[t].get(execution_tf, None) for t in data_dict.keys()}
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

            if can_buy and open_cond and evaluate_condition(open_cond, row, indicator_functions, data_dict, ticker, context_index=i,  allowed_timeframes=allowed_timeframes, execution_tf=execution_tf):
                if can_buy and open_cond: result, left_val, right_val, used_tf = evaluate_condition_capture(
                                                                            open_cond, row, indicator_functions, data_dict, ticker,
                                                                            context_index=i, allowed_timeframes=allowed_timeframes,
                                                                            execution_tf=execution_tf
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
                    trade_log.append({
                        "type": "BUY",
                        "ticker": ticker,
                        "price": current_prices[ticker],
                        "shares": shares_to_buy,
                        "balance": cash,
                        "open_positions_value": sum(positions[t]*current_prices[t] for t in positions),
                        "timestamp": timestamp_str
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
                            trade_log.append({
                                "type": "RECURRING_BUY",
                                "ticker": ticker,
                                "price": current_prices[ticker],
                                "shares": shares_to_buy,
                                "balance": cash,
                                "open_positions_value": sum(positions[t]*current_prices[t] for t in positions),
                                "timestamp": timestamp_str
                            })

            # --- CLOSE POSITIONS ---
            if positions[ticker] > 0 and close_cond and evaluate_condition(close_cond, row, indicator_functions, data_dict, ticker, context_index=i, allowed_timeframes=allowed_timeframes, execution_tf=execution_tf):
            # Inside your backtesting loop where you check for CLOSE conditions
                # Capture RSI or other indicator value and its timeframe
                if positions[ticker] > 0 and close_cond: result, left_val, right_val, used_tf = evaluate_condition_capture(
                                                                            close_cond, row, indicator_functions, data_dict, ticker,
                                                                            context_index=i, allowed_timeframes=allowed_timeframes,
                                                                            execution_tf=execution_tf
                                                                        )
                if result:
                          print(f"[CLOSE POSITION] Ticker: {ticker}, Time: {row.name}, RSI ({used_tf}): {left_val}")


                shares_to_sell = positions[ticker]
                cash += shares_to_sell * current_prices[ticker]
                positions[ticker] = 0
                trade_log.append({
                    "type": "SELL",
                    "ticker": ticker,
                    "price": current_prices[ticker],
                    "shares": shares_to_sell,
                    "balance": cash,
                    "open_positions_value": sum(positions[t]*current_prices[t] for t in positions),
                    "timestamp": timestamp_str
                })

    total_value = cash + sum(positions[t]*current_prices[t] for t in positions)
    pct_change = (total_value - initial_balance) / initial_balance * 100
    return trade_log, cash, positions, pct_change