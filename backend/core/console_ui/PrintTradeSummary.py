def print_trade_summary(trade_log):
    from datetime import datetime

    open_trades = {}
    # Define column widths
    col_widths = {
        "Ticker": 6,
        "Open Time": 16,
        "Open Price": 12,
        "Close Time": 16,
        "Close Price": 12,
        "Shares": 8,
        "P/L": 10
    }

    # Print header
    header = f"{'Ticker':<{col_widths['Ticker']}} | " \
             f"{'Open Time':<{col_widths['Open Time']}} | " \
             f"{'Open Price':>{col_widths['Open Price']}} | " \
             f"{'Close Time':<{col_widths['Close Time']}} | " \
             f"{'Close Price':>{col_widths['Close Price']}} | " \
             f"{'Shares':>{col_widths['Shares']}} | " \
             f"{'P/L':>{col_widths['P/L']}}"
    print("\n📄 Trade Summary:")
    print(header)
    print("-" * len(header))

    for trade in trade_log:
        ticker = trade.get("ticker")
        ttype = trade.get("type")
        price = float(trade.get("price", 0))
        shares = float(trade.get("shares", 0))
        timestamp = trade.get("timestamp")

        if ticker is None:
            continue

        timestamp_fmt = datetime.fromisoformat(timestamp).strftime("%Y-%m-%d %H:%M") if timestamp else ""

        if ttype == "BUY":
            open_trades[ticker] = (timestamp_fmt, price, shares)
        elif ttype == "SELL" and ticker in open_trades:
            open_time, open_price, open_shares = open_trades.pop(ticker)
            pl = (price - open_price) * open_shares
            print(f"{ticker:<{col_widths['Ticker']}} | "
                  f"{open_time:<{col_widths['Open Time']}} | "
                  f"{open_price:>{col_widths['Open Price']}.2f} | "
                  f"{timestamp_fmt:<{col_widths['Close Time']}} | "
                  f"{price:>{col_widths['Close Price']}.2f} | "
                  f"{open_shares:>{col_widths['Shares']}.0f} | "
                  f"{pl:>{col_widths['P/L']}.2f}")

    # Print currently open trades
    if open_trades:
        print("\n🔹 Currently Open Trades:")
        header_open = f"{'Ticker':<{col_widths['Ticker']}} | " \
                      f"{'Open Time':<{col_widths['Open Time']}} | " \
                      f"{'Price':>{col_widths['Open Price']}} | " \
                      f"{'Shares':>{col_widths['Shares']}}"
        print(header_open)
        print("-" * len(header_open))
        for ticker, (open_time, price, shares) in open_trades.items():
            print(f"{ticker:<{col_widths['Ticker']}} | "
                  f"{open_time:<{col_widths['Open Time']}} | "
                  f"{price:>{col_widths['Open Price']}.2f} | "
                  f"{shares:>{col_widths['Shares']}.0f}")