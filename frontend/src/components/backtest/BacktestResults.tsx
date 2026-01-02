import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  DollarSign, 
  Wallet,
  Percent,
  Scale,
  CheckCircle,
  XCircle,
  ArrowLeftRight,
  FolderOpen,
  Filter
} from "lucide-react";
import { BacktestResult } from "@/lib/api";
import TradesTable from "./TradesTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BacktestResultsProps {
  results: BacktestResult;
}

const BacktestResults = ({ results }: BacktestResultsProps) => {
  const [selectedTicker, setSelectedTicker] = useState<string>("all");

  // Extract unique tickers
  const availableTickers = useMemo(() => {
    return [...new Set(results.trades.map(t => t.ticker))];
  }, [results.trades]);

  // Reset ticker filter when results change
  useEffect(() => {
    setSelectedTicker("all");
  }, [results]);

  // Filter trades by selected ticker
  const filteredTrades = useMemo(() => {
    if (selectedTicker === "all") return results.trades;
    return results.trades.filter(t => t.ticker === selectedTicker);
  }, [results.trades, selectedTicker]);

  // Calculate detailed win/loss analytics
  const detailedMetrics = useMemo(() => {
    const completedTrades: { entryPrice: number; exitPrice: number; shares: number }[] = [];
    const openPositions: Map<string, { price: number; shares: number }[]> = new Map();
    
    let entries = 0;
    let exits = 0;

    for (const trade of filteredTrades) {
      if (trade.type === "BUY" || trade.type === "RECURRING_BUY") {
        entries++;
        const positions = openPositions.get(trade.ticker) || [];
        positions.push({ price: trade.price, shares: trade.shares });
        openPositions.set(trade.ticker, positions);
      } else if (trade.type === "SELL") {
        exits++;
        const positions = openPositions.get(trade.ticker) || [];
        if (positions.length > 0) {
          const entry = positions.shift()!;
          completedTrades.push({
            entryPrice: entry.price,
            exitPrice: trade.price,
            shares: Math.min(entry.shares, trade.shares),
          });
          openPositions.set(trade.ticker, positions);
        }
      }
    }

    // Count remaining open positions
    let openCount = 0;
    openPositions.forEach(positions => {
      openCount += positions.length;
    });

    const wins = completedTrades.filter(t => t.exitPrice > t.entryPrice);
    const losses = completedTrades.filter(t => t.exitPrice <= t.entryPrice);

    const winRate = completedTrades.length > 0 
      ? (wins.length / completedTrades.length) * 100 
      : 0;

    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100, 0) / wins.length
      : 0;

    const avgLoss = losses.length > 0
      ? losses.reduce((sum, t) => sum + ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100, 0) / losses.length
      : 0;

    const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss) : 0;

    return {
      completedTrades: completedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      entries,
      exits,
      openPositions: openCount,
    };
  }, [filteredTrades]);

  const metrics = useMemo(() => {
    return [
      // Row 1: Portfolio Overview (Global)
      {
        icon: Wallet,
        label: "Total Portfolio",
        value: `$${results.total_portfolio.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        color: "text-primary",
      },
      {
        icon: TrendingUp,
        label: "Total Return",
        value: `${results.pct_change >= 0 ? "+" : ""}${results.pct_change.toFixed(2)}%`,
        color: results.pct_change >= 0 ? "text-success" : "text-destructive",
      },
      {
        icon: DollarSign,
        label: "Final Cash",
        value: `$${results.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        color: "text-foreground",
      },
      {
        icon: BarChart3,
        label: "Invested",
        value: `$${results.invested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        color: "text-accent",
      },
      // Row 2: Trade Analytics (Filtered)
      {
        icon: CheckCircle,
        label: "Completed Trades",
        value: detailedMetrics.completedTrades.toString(),
        color: "text-foreground",
      },
      {
        icon: Percent,
        label: "Win Rate",
        value: `${detailedMetrics.winRate.toFixed(1)}%`,
        color: detailedMetrics.winRate >= 50 ? "text-success" : "text-destructive",
      },
      {
        icon: TrendingUp,
        label: "Avg Win",
        value: `+${detailedMetrics.avgWin.toFixed(2)}%`,
        color: "text-success",
      },
      {
        icon: TrendingDown,
        label: "Avg Loss",
        value: `${detailedMetrics.avgLoss.toFixed(2)}%`,
        color: "text-destructive",
      },
      // Row 3: Details (Filtered)
      {
        icon: Scale,
        label: "Profit Factor",
        value: detailedMetrics.profitFactor > 0 ? `${detailedMetrics.profitFactor.toFixed(2)}x` : "N/A",
        color: detailedMetrics.profitFactor >= 1 ? "text-success" : "text-destructive",
      },
      {
        icon: XCircle,
        label: "Wins / Losses",
        value: `${detailedMetrics.wins} / ${detailedMetrics.losses}`,
        color: "text-muted-foreground",
      },
      {
        icon: ArrowLeftRight,
        label: "Entries / Exits",
        value: `${detailedMetrics.entries} / ${detailedMetrics.exits}`,
        color: "text-muted-foreground",
      },
      {
        icon: FolderOpen,
        label: "Open Positions",
        value: detailedMetrics.openPositions.toString(),
        color: detailedMetrics.openPositions > 0 ? "text-warning" : "text-muted-foreground",
      },
    ];
  }, [results, detailedMetrics]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="space-y-6"
    >
      {/* Ticker Filter */}
      {availableTickers.length > 1 && (
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filter by ticker:</span>
          <Select value={selectedTicker} onValueChange={setSelectedTicker}>
            <SelectTrigger className="w-[140px] bg-secondary border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tickers</SelectItem>
              {availableTickers.map(ticker => (
                <SelectItem key={ticker} value={ticker}>{ticker}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Metrics Grid - 4 columns, 3 rows */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: 0.3 + index * 0.03 }}
            className="p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 mb-2">
              <metric.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{metric.label}</span>
            </div>
            <p className={`text-xl font-bold font-mono ${metric.color}`}>{metric.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Trades Table */}
      <TradesTable trades={filteredTrades} />
    </motion.div>
  );
};

export default BacktestResults;
