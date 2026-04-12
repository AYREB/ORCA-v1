import { TradeEntry } from "@/lib/api";
/**
 * Detect strategy direction per ticker from trade sequence.
 * The first trade for a ticker determines direction:
 * - First trade is BUY → Long (BUY opens, SELL closes)
 * - First trade is SELL → Short (SELL opens, BUY closes)
 */
export function detectDirection(trades: TradeEntry[]): Map<string, "long" | "short"> {
  const directions = new Map<string, "long" | "short">();
  for (const trade of trades) {
    if (!directions.has(trade.ticker)) {
      directions.set(trade.ticker, trade.type === "BUY" ? "long" : "short");
    }
  }
  return directions;
}
/**
 * Check if a trade is an "entry" (opening) trade based on direction.
 */
export function isEntryTrade(trade: TradeEntry, direction: "long" | "short"): boolean {
  return direction === "long" ? trade.type === "BUY" : trade.type === "SELL";
}
/**
 * Check if a trade is an "exit" (closing) trade based on direction.
 */
export function isExitTrade(trade: TradeEntry, direction: "long" | "short"): boolean {
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