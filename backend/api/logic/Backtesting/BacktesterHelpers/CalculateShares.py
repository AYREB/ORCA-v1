def calculate_shares(cash, price, invest_type="fixedValue", invest_amount=0.2,
                     allow_fractional=True, fractional_precision=3):
    """
    Determine number of shares to buy based on DSL arguments.
    fractional_precision limits fractional share depth.
    If insufficient cash, trade is skipped.
    """
    if price <= 0:
        return 0.0

    if invest_type == "percentCashBalance":
        amount_to_invest = cash * invest_amount
    elif invest_type == "fixedValue":
        amount_to_invest = invest_amount
    elif invest_type == "percentSharePrice":
        amount_to_invest = price * invest_amount
    elif invest_type == "numberShares":
        amount_to_invest = invest_amount * price
    else:
        raise ValueError(f"Unknown invest_type: {invest_type}")

    if amount_to_invest > cash:
        return 0.0

    shares = amount_to_invest / price

    if not allow_fractional:
        shares = int(shares)
    else:
        factor = 10 ** fractional_precision
        shares = int(shares * factor) / factor

    total_cost = shares * price
    if total_cost > cash or shares <= 0:
        return 0.0

    return shares