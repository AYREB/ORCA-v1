import { TradeEntry } from "@/lib/api";

export interface DailyEquityPoint {
  dateKey: string;
  label: string;
  portfolio: number;
  drawdown: number;
}

/**
 * Reconstruct a daily equity curve from the trade log.
 *
 * The backend does NOT emit `open_positions_value` per trade — only the cash
 * `balance` after each trade fires. To get the true portfolio value we walk
 * the trades in order, maintain signed share counts per ticker, and price open
 * positions at the last traded price for that ticker.  At the end of each
 * calendar day (last trade of the day) we emit one equity snapshot, giving an
 * evenly-spaced date series regardless of how many intra-day trades fire.
 */
export function buildDailyEquityCurve(
  trades: TradeEntry[],
  startEquity: number,
): DailyEquityPoint[] {
  if (trades.length === 0) return [];

  const direction = detectDirection(trades);
  // signed shares: positive = long shares held, negative = short obligation
  const positions = new Map<string, number>();
  const lastPrice = new Map<string, number>();
  const byDate = new Map<string, { dateKey: string; label: string; portfolio: number }>();

  for (const trade of trades) {
    const dir = direction.get(trade.ticker) ?? "long";
    lastPrice.set(trade.ticker, trade.price);

    const prev = positions.get(trade.ticker) ?? 0;
    if (isEntryTrade(trade, dir)) {
      // long entry: +shares; short entry: -shares (liability)
      positions.set(trade.ticker, prev + (dir === "long" ? trade.shares : -trade.shares));
    } else {
      // long exit: -shares; short cover: +shares (reduce liability)
      positions.set(trade.ticker, prev + (dir === "long" ? -trade.shares : trade.shares));
    }

    // sum signed open position value at last known price per ticker
    let positionValue = 0;
    positions.forEach((signedShares, ticker) => {
      positionValue += signedShares * (lastPrice.get(ticker) ?? 0);
    });

    const portfolio = trade.balance + positionValue;

    const d = new Date(trade.timestamp);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDate.set(dateKey, {
      dateKey,
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      portfolio,
    });
  }

  const sorted = Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  let peak = startEquity;
  return sorted.map((p) => {
    peak = Math.max(peak, p.portfolio);
    return {
      ...p,
      drawdown: peak > 0 ? ((p.portfolio - peak) / peak) * 100 : 0,
    };
  });
}
/**
 * Detect strategy direction per ticker from trade sequence.
 * The first trade for a ticker determines direction:
 * - First trade is BUY → Long (BUY opens, SELL closes)
 * - First trade is SELL → Short (SELL opens, BUY closes)
 */
export function detectDirection(trades: TradeEntry[]): Map<string, "long" | "short"> {
  const directions = new Map<string, "long" | "short">();
  for (const trade of trades) {
    // Recurring_Entry (DCA add) never opens a position, so it can't define
    // direction — only the first BUY/SELL does.
    if (trade.type !== "Recurring_Entry" && !directions.has(trade.ticker)) {
      directions.set(trade.ticker, trade.type === "BUY" ? "long" : "short");
    }
  }
  return directions;
}
/**
 * Check if a trade is an "entry" (opening) trade based on direction.
 * Recurring_Entry is a DCA add to an open position — always an entry,
 * regardless of direction.
 */
export function isEntryTrade(trade: TradeEntry, direction: "long" | "short"): boolean {
  if (trade.type === "Recurring_Entry") return true;
  return direction === "long" ? trade.type === "BUY" : trade.type === "SELL";
}
/**
 * Check if a trade is an "exit" (closing) trade based on direction.
 * Recurring_Entry adds to a position and is never an exit.
 */
export function isExitTrade(trade: TradeEntry, direction: "long" | "short"): boolean {
  if (trade.type === "Recurring_Entry") return false;
  return direction === "long" ? trade.type === "SELL" : trade.type === "BUY";
}

export function calculatePnl(
  avgEntryPrice: number,
  exitPrice: number,
  shares: number,
  direction: "long" | "short"
): { pnl: number; pnlPercent: number } {
  const pnl = direction === "long"
    ? (exitPrice - avgEntryPrice) * shares
    : (avgEntryPrice - exitPrice) * shares;
  const pnlPercent = direction === "long"
    ? ((exitPrice - avgEntryPrice) / avgEntryPrice) * 100
    : ((avgEntryPrice - exitPrice) / avgEntryPrice) * 100;
  return { pnl, pnlPercent };
}