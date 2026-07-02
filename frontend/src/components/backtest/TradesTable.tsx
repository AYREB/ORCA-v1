import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, List, Layers } from "lucide-react";
import { TradeEntry } from "@/lib/api";
import { detectDirection, isEntryTrade, isExitTrade, calculatePnl } from "@/lib/tradeUtils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface TradesTableProps {
  trades: TradeEntry[];
}

interface RoundTripTrade {
  id: number;
  ticker: string;
  direction: "long" | "short";
  entries: TradeEntry[];
  exit: TradeEntry | null;
  totalShares: number;
  avgEntryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  isOpen: boolean;
}

type ViewMode = "chronological" | "grouped";

const TradesTable = ({ trades }: TradesTableProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>("chronological");

  const directions = useMemo(() => detectDirection(trades), [trades]);

  // Group trades into round-trips
  const roundTripTrades = useMemo(() => {
    const roundTrips: RoundTripTrade[] = [];
    const openPositions: Map<string, { entries: TradeEntry[], totalShares: number, totalCost: number }> = new Map();
    let tradeId = 1;

    for (const trade of trades) {
      const dir = directions.get(trade.ticker) || "long";

      if (isEntryTrade(trade, dir)) {
        const existing = openPositions.get(trade.ticker) || { entries: [], totalShares: 0, totalCost: 0 };
        existing.entries.push(trade);
        existing.totalShares += trade.shares;
        existing.totalCost += trade.shares * trade.price;
        openPositions.set(trade.ticker, existing);
      } else if (isExitTrade(trade, dir)) {
        const position = openPositions.get(trade.ticker);
        if (position && position.entries.length > 0) {
          const avgEntryPrice = position.totalCost / position.totalShares;
          const { pnl, pnlPercent } = calculatePnl(avgEntryPrice, trade.price, position.totalShares, dir);
          
          roundTrips.push({
            id: tradeId++,
            ticker: trade.ticker,
            direction: dir,
            entries: [...position.entries],
            exit: trade,
            totalShares: position.totalShares,
            avgEntryPrice,
            exitPrice: trade.price,
            pnl,
            pnlPercent,
            isOpen: false,
          });
          
          openPositions.delete(trade.ticker);
        }
      }
    }

    // Add remaining open positions
    openPositions.forEach((position, ticker) => {
      const avgEntryPrice = position.totalCost / position.totalShares;
      const dir = directions.get(ticker) || "long";
      roundTrips.push({
        id: tradeId++,
        ticker,
        direction: dir,
        entries: position.entries,
        exit: null,
        totalShares: position.totalShares,
        avgEntryPrice,
        exitPrice: null,
        pnl: null,
        pnlPercent: null,
        isOpen: true,
      });
    });

    return roundTrips;
  }, [trades, directions]);

  const totalFees = useMemo(
    () => trades.reduce((sum, t) => sum + (t.fee ?? 0), 0),
    [trades],
  );
  const hasFees = totalFees > 0;

  const renderTradeRow = (trade: TradeEntry, index: number) => {
    const dir = directions.get(trade.ticker) || "long";
    const isEntry = isEntryTrade(trade, dir);

    return (
      <TableRow key={index} className="border-border">
        <TableCell className="font-mono text-sm">
          {new Date(trade.timestamp).toLocaleString()}
        </TableCell>
        <TableCell className="font-semibold">{trade.ticker}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            {isEntry ? (
              <ArrowUpRight className="h-4 w-4 text-success" />
            ) : (
              <ArrowDownRight className="h-4 w-4 text-destructive" />
            )}
            <span className={isEntry ? "text-success" : "text-destructive"}>
              {trade.type}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-xs">
            {dir === "long" ? "Long" : "Short"}
          </Badge>
        </TableCell>
        <TableCell className="text-right font-mono">
          {trade.shares.toFixed(1)}
        </TableCell>
        <TableCell className="text-right font-mono">
          ${trade.price.toFixed(2)}
        </TableCell>
        {hasFees && (
          <TableCell className="text-right font-mono text-xs text-muted-foreground">
            {(trade.fee ?? 0) > 0 ? `$${(trade.fee ?? 0).toFixed(2)}` : "-"}
          </TableCell>
        )}
        <TableCell className="text-right font-mono">
          ${trade.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {trade.close_reason || "-"}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <h3 className="text-lg font-semibold">Trade Log</h3>
          {hasFees && (
            <span className="text-xs text-muted-foreground">
              Total fees paid: <span className="font-mono text-foreground/80">${totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "chronological" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("chronological")}
            className="gap-1.5"
          >
            <List className="h-4 w-4" />
            Timeline
          </Button>
          <Button
            variant={viewMode === "grouped" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("grouped")}
            className="gap-1.5"
          >
            <Layers className="h-4 w-4" />
            Round Trips
          </Button>
        </div>
      </div>

      {viewMode === "chronological" ? (
        <ScrollArea className="h-[300px]">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Time</TableHead>
                <TableHead className="text-muted-foreground">Ticker</TableHead>
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Side</TableHead>
                <TableHead className="text-muted-foreground text-right">Shares</TableHead>
                <TableHead className="text-muted-foreground text-right">Price</TableHead>
                {hasFees && <TableHead className="text-muted-foreground text-right">Fee</TableHead>}
                <TableHead className="text-muted-foreground text-right">Balance</TableHead>
                <TableHead className="text-muted-foreground">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade, index) => renderTradeRow(trade, index))}
            </TableBody>
          </Table>
        </ScrollArea>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-3">
            {roundTripTrades.map((rt) => (
              <div
                key={rt.id}
                className={`p-4 rounded-lg border ${
                  rt.isOpen 
                    ? "border-warning/30 bg-warning/5" 
                    : rt.pnl && rt.pnl >= 0 
                      ? "border-success/30 bg-success/5" 
                      : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-lg">{rt.ticker}</span>
                    <Badge variant="outline" className="text-xs">
                      {rt.direction === "long" ? "Long" : "Short"}
                    </Badge>
                    {rt.isOpen ? (
                      <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                        Open Position
                      </Badge>
                    ) : (
                      <Badge 
                        variant="outline" 
                        className={rt.pnl && rt.pnl >= 0 
                          ? "bg-success/10 text-success border-success/30" 
                          : "bg-destructive/10 text-destructive border-destructive/30"
                        }
                      >
                        {rt.pnl && rt.pnl >= 0 ? "Profit" : "Loss"}
                      </Badge>
                    )}
                  </div>
                  {!rt.isOpen && rt.pnl !== null && (
                    <div className="text-right">
                      <div className={`font-bold font-mono ${rt.pnl >= 0 ? "text-success" : "text-destructive"}`}>
                        {rt.pnl >= 0 ? "+" : ""}${rt.pnl.toFixed(2)}
                      </div>
                      <div className={`text-sm font-mono ${rt.pnlPercent && rt.pnlPercent >= 0 ? "text-success" : "text-destructive"}`}>
                        {rt.pnlPercent && rt.pnlPercent >= 0 ? "+" : ""}{rt.pnlPercent?.toFixed(2)}%
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Entry Side */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
                      <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                      <span>
                        {rt.direction === "long" ? "BUY" : "SELL"} ({rt.entries.length} order{rt.entries.length > 1 ? "s" : ""})
                      </span>
                    </div>
                    {rt.entries.map((entry, i) => (
                      <div key={i} className="flex items-center justify-between text-sm bg-background/50 rounded px-2 py-1">
                        <div className="flex items-center gap-2">
                          <ArrowUpRight className="h-3 w-3 text-success" />
                          <span className="text-muted-foreground text-xs">
                            {new Date(entry.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="font-mono">
                          {entry.shares.toFixed(1)} @ ${entry.price.toFixed(2)}
                        </div>
                      </div>
                    ))}
                    <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
                      Avg: <span className="font-mono font-medium text-foreground">${rt.avgEntryPrice.toFixed(2)}</span>
                      <span className="mx-2">•</span>
                      Total: <span className="font-mono font-medium text-foreground">{rt.totalShares.toFixed(1)} shares</span>
                    </div>
                  </div>

                  {/* Exit Side */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
                      <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />
                      <span>{rt.direction === "long" ? "SELL" : "BUY"}</span>
                    </div>
                    {rt.exit ? (
                      <>
                        <div className="flex items-center justify-between text-sm bg-background/50 rounded px-2 py-1">
                          <div className="flex items-center gap-2">
                            <ArrowDownRight className="h-3 w-3 text-destructive" />
                            <span className="text-muted-foreground text-xs">
                              {new Date(rt.exit.timestamp).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="font-mono">
                            {rt.exit.shares.toFixed(1)} @ ${rt.exit.price.toFixed(2)}
                          </div>
                        </div>
                        {rt.exit.close_reason && (
                          <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
                            Reason: <span className="font-medium text-foreground">{rt.exit.close_reason}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-warning italic">
                        Position still open
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </motion.div>
  );
};

export default TradesTable;
