import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const backtests = [
  {
    id: 1,
    name: "RSI Mean Reversion",
    asset: "BTC/USD",
    timeframe: "4H",
    profit: "+23.4%",
    isProfit: true,
    trades: 142,
    date: "2 hours ago",
  },
  {
    id: 2,
    name: "MACD Crossover",
    asset: "ETH/USD",
    timeframe: "1D",
    profit: "-5.2%",
    isProfit: false,
    trades: 38,
    date: "5 hours ago",
  },
  {
    id: 3,
    name: "Bollinger Breakout",
    asset: "SPY",
    timeframe: "1H",
    profit: "+12.8%",
    isProfit: true,
    trades: 256,
    date: "Yesterday",
  },
  {
    id: 4,
    name: "Moving Average Strategy",
    asset: "AAPL",
    timeframe: "1D",
    profit: "+8.1%",
    isProfit: true,
    trades: 24,
    date: "2 days ago",
  },
];

const RecentBacktests = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Recent Backtests</h3>
          <p className="text-sm text-muted-foreground">Your latest strategy tests</p>
        </div>
        <Button variant="ghost" size="sm">
          View All
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {backtests.map((backtest, index) => (
          <motion.div
            key={backtest.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.4 + index * 0.1 }}
            className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-4">
              <div
                className={`p-2 rounded-lg ${
                  backtest.isProfit ? "bg-success/10 border border-success/20" : "bg-destructive/10 border border-destructive/20"
                }`}
              >
                {backtest.isProfit ? (
                  <TrendingUp className="h-4 w-4 text-success" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
              </div>
              <div>
                <p className="font-medium group-hover:text-primary transition-colors">{backtest.name}</p>
                <p className="text-sm text-muted-foreground">
                  {backtest.asset} • {backtest.timeframe} • {backtest.trades} trades
                </p>
              </div>
            </div>
            <div className="text-right">
              <p
                className={`font-mono font-semibold ${
                  backtest.isProfit ? "text-success" : "text-destructive"
                }`}
              >
                {backtest.profit}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                <Clock className="h-3 w-3" />
                {backtest.date}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default RecentBacktests;
