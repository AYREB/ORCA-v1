import pandas as pd
from .BacktesterHelpers.ConditionEvaluation import evaluate_condition_capture
from .BacktesterHelpers.DSLArgumentParser import get_long_short_conditions, get_open_args, get_close_args
from .BacktesterHelpers.CalculateShares import calculate_shares
from core.parsing.extractingTickers import extract_execution_timeframe, extract_data_timeframes

# ---------------- SPREAD HELPERS ---------------- #

def apply_buy_spread(price, half_spread):
    return price * (1 + half_spread)

def apply_sell_spread(price, half_spread):
    return price * (1 - half_spread)

# ---------------- ENTRY TYPE CONSTANTS ---------------- #

ENTRY_TYPES = ("BUY", "SELL", "Recurring_Entry")

# ---------------- BACKTESTER ---------------- #

def backtester(parsed_dsl, data_dict, indicator_functions, initial_balance=10000,
               allow_fractional=True, fractional_precision=1):

    # -------- STRATEGY SETUP -------- #
    strategy_type = "LONG" if "LONG" in parsed_dsl else "SHORT"
    is_long = strategy_type == "LONG"

    execution_tf = extract_execution_timeframe(parsed_dsl)
    if isinstance(execution_tf, list):
        execution_tf = execution_tf[0]

    allowed_timeframes = extract_data_timeframes(parsed_dsl)

    open_cond, close_cond = get_long_short_conditions(parsed_dsl, strategy_type)
    open_args = get_open_args(parsed_dsl, strategy_type)

    half_spread = open_args.get("spread", 0) / 200.0  # divide by 100 for pct, then by 2 for half

    invest_type   = open_args.get("initialOpenPositionInvestType", "percentCashBalance")
    invest_amount = open_args.get("initialOpenPositionInvestAmount", 0.2)
    sl_pct        = open_args.get("stopLossPercent")
    tp_pct        = open_args.get("takeProfitPercent")
    is_recurring  = open_args.get("recurring", False)
    rec_period    = open_args.get("recurringPeriod", 1)
    rec_type      = open_args.get("recurringInvestType", "percentCashBalance")
    rec_amt       = open_args.get("recurringInvestAmount", 0.1)
    max_recurs    = open_args.get("maxRecurringCount", 0)

    # -------- DATA SETUP -------- #
    exec_dfs = {
        t: data_dict[t][execution_tf]
        for t in data_dict
        if execution_tf in data_dict[t]
    }

    if not exec_dfs:
        raise ValueError(f"No data found for execution timeframe '{execution_tf}'")

    max_rows = max(len(df) for df in exec_dfs.values())

    # -------- STATE -------- #
    cash = initial_balance
    positions = {ticker: 0 for ticker in exec_dfs}
    trade_log = []
    last_recurring_index = {ticker: -float("inf") for ticker in exec_dfs}
    recurring_count = {ticker: 0 for ticker in exec_dfs}

    # -------- SHARED CONDITION EVAL KWARGS -------- #
    eval_kwargs = dict(
        indicator_functions=indicator_functions,
        data_dict=data_dict,
        allowed_timeframes=allowed_timeframes,
        execution_tf=execution_tf
    )

    # ---------------- MAIN LOOP ---------------- #
    for i in range(max_rows):

        current_prices = {
            t: exec_dfs[t].iloc[i]["Close"]
            for t in exec_dfs
            if i < len(exec_dfs[t])
        }

        for ticker, exec_df in exec_dfs.items():
            if i >= len(exec_df):
                continue

            row = exec_df.iloc[i]
            position = positions[ticker]
            in_position = (is_long and position > 0) or (not is_long and position < 0)

            # ---------------- OPEN ---------------- #
            if position == 0 and open_cond:
                result, *_ = evaluate_condition_capture(
                    open_cond, row, ticker=ticker, context_index=i, **eval_kwargs
                )
                if result:
                    market_price = current_prices[ticker]
                    exec_price = (apply_buy_spread if is_long else apply_sell_spread)(market_price, half_spread)

                    shares = calculate_shares(cash, exec_price, invest_type, invest_amount,
                                              allow_fractional, fractional_precision)
                    if shares > 0:
                        cash += shares * exec_price * (-1 if is_long else 1)
                        positions[ticker] += shares * (1 if is_long else -1)
                        last_recurring_index[ticker] = i
                        recurring_count[ticker] = 0

                        sl_price = exec_price * (1 + (-1 if is_long else 1) * sl_pct / 100) if sl_pct else None
                        tp_price = exec_price * (1 + (1 if is_long else -1) * tp_pct / 100) if tp_pct else None

                        trade_log.append({
                            "type": "BUY" if is_long else "SELL",
                            "ticker": ticker,
                            "raw_price": market_price,
                            "price": exec_price,
                            "shares": shares,
                            "balance": cash,
                            "timestamp": row.name.isoformat(),
                            "sl_price": sl_price,
                            "tp_price": tp_price,
                        })
                        in_position = True

            # ---------------- RECURRING ---------------- #
            elif in_position and is_recurring:
                if (i - last_recurring_index[ticker] >= rec_period and
                        (max_recurs == 0 or recurring_count[ticker] < max_recurs)):

                    market_price = current_prices[ticker]
                    exec_price = (apply_buy_spread if is_long else apply_sell_spread)(market_price, half_spread)

                    shares = calculate_shares(cash, exec_price, rec_type, rec_amt,
                                              allow_fractional, fractional_precision)
                    if shares > 0:
                        cash += shares * exec_price * (-1 if is_long else 1)
                        positions[ticker] += shares * (1 if is_long else -1)
                        last_recurring_index[ticker] = i
                        recurring_count[ticker] += 1

                        trade_log.append({
                            "type": "Recurring_Entry",
                            "ticker": ticker,
                            "raw_price": market_price,
                            "price": exec_price,
                            "shares": shares,
                            "balance": cash,
                            "timestamp": row.name.isoformat(),
                        })

            # ---------------- CLOSE ---------------- #
            if in_position:
                last_entry = next(
                    (t for t in reversed(trade_log)
                     if t["ticker"] == ticker and t["type"] in ENTRY_TYPES),
                    None
                )

                close_price = None
                reason = None

                if last_entry:
                    if is_long:
                        if last_entry.get("sl_price") and row["Low"] <= last_entry["sl_price"]:
                            close_price, reason = last_entry["sl_price"], "SL"
                        elif last_entry.get("tp_price") and row["High"] >= last_entry["tp_price"]:
                            close_price, reason = last_entry["tp_price"], "TP"
                    else:
                        if last_entry.get("sl_price") and row["High"] >= last_entry["sl_price"]:
                            close_price, reason = last_entry["sl_price"], "SL"
                        elif last_entry.get("tp_price") and row["Low"] <= last_entry["tp_price"]:
                            close_price, reason = last_entry["tp_price"], "TP"

                if close_price is None and close_cond:
                    result, *_ = evaluate_condition_capture(
                        close_cond, row, ticker=ticker, context_index=i, **eval_kwargs
                    )
                    if result:
                        close_price, reason = current_prices[ticker], "CLOSE_CONDITION"

                if close_price is not None:
                    shares = abs(positions[ticker])
                    exec_price = (apply_sell_spread if is_long else apply_buy_spread)(close_price, half_spread)
                    cash += shares * exec_price * (1 if is_long else -1)
                    positions[ticker] = 0

                    trade_log.append({
                        "type": "SELL" if is_long else "BUY",
                        "ticker": ticker,
                        "raw_price": close_price,
                        "price": exec_price,
                        "shares": shares,
                        "balance": cash,
                        "timestamp": row.name.isoformat(),
                        "close_reason": reason,
                    })

    # ---------------- FINAL VALUATION ---------------- #
    total_value = cash + sum(
        positions[t] * current_prices.get(t, 0)
        for t in positions
    )
    pct_change = (total_value - initial_balance) / initial_balance * 100

    return trade_log, cash, positions, pct_change