import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Clock, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardBacktest } from "@/lib/api";

interface RecentBacktestsProps {
  backtests: DashboardBacktest[];
  isLoading?: boolean;
}

const RecentBacktests = ({ backtests, isLoading = false }: RecentBacktestsProps) => {
  const hasData = backtests && backtests.length > 0;

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
        <Button variant="ghost" size="sm" disabled>
          View All
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-16 rounded-lg border border-border bg-secondary/30 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && !hasData && (
          <div className="p-4 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Run a backtest to see your most recent results here.
          </div>
        )}

        {!isLoading &&
          hasData &&
          backtests.map((backtest, index) => {
            const isProfit = (backtest.pct_change || 0) >= 0;
            const profitLabel = `${isProfit ? "+" : ""}${(backtest.pct_change ?? 0).toFixed(2)}%`;
            const winRateLabel = `${(backtest.win_rate ?? 0).toFixed(1)}% win rate`;
            const tradesLabel = `${backtest.trades ?? 0} trades`;
            const dateLabel = backtest.created_at
              ? new Date(backtest.created_at).toLocaleString()
              : "—";

            return (
              <motion.div
                key={backtest.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.4 + index * 0.05 }}
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`p-2 rounded-lg ${
                      isProfit ? "bg-success/10 border border-success/20" : "bg-destructive/10 border border-destructive/20"
                    }`}
                  >
                    {isProfit ? (
                      <TrendingUp className="h-4 w-4 text-success" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium group-hover:text-primary transition-colors">
                      {backtest.strategy_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tradesLabel} • {winRateLabel}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={`font-mono font-semibold ${
                      isProfit ? "text-success" : "text-destructive"
                    }`}
                  >
                    {profitLabel}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                    {dateLabel}
                  </p>
                </div>
              </motion.div>
            );
          })}
      </div>
    </motion.div>
  );
};

export default RecentBacktests;
