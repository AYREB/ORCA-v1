def calculate_shares(cash, price, invest_type="fixedValue", invest_amount=0.2,
                     allow_fractional=True, fractional_precision=3, sl_pct=None):
    """
    Determine number of shares to buy based on DSL arguments.
    fractional_precision limits fractional share depth.
    If insufficient cash, trade is skipped.

    Risk-based types (riskFixedAmount / riskPercentBalance) require sl_pct.
    Formula: shares = risk_amount / (price * sl_pct / 100)
    e.g. entry=$100, SL=5%, risk=$50 → risk/share=$5 → 10 shares ($1,000 position)
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
    elif invest_type in ("riskFixedAmount", "riskPercentBalance"):
        if not sl_pct or sl_pct <= 0:
            # Cannot size by risk without a stop loss — skip the trade
            return 0.0
        risk_amount = (cash * invest_amount) if invest_type == "riskPercentBalance" else float(invest_amount)
        risk_per_share = price * sl_pct / 100.0
        if risk_per_share <= 0:
            return 0.0
        amount_to_invest = (risk_amount / risk_per_share) * price
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