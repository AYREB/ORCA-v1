import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Shuffle, TrendingUp, TrendingDown, Target, Percent, Play, Info, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";
import { TradeEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

interface MonteCarloAnalysisProps {
  trades: TradeEntry[];
}

interface SimulationResults {
  paths: Array<{ trade: number; [key: string]: number }>;
  allFinalValues: number[];
  metrics: {
    expectedReturn: number;
    medianReturn: number;
    var95: number;
    cvar95: number;
    probPositive: number;
    probGt10: number;
    probGt20: number;
    probDrawdown20: number;
  };
  distribution: Array<{ return: number; frequency: number }>;
  params: {
    winRate: number;
    avgWin: number;
    avgLoss: number;
  };
}

// Extract returns from trade pairs
const extractReturns = (trades: TradeEntry[]): number[] => {
  const returns: number[] = [];
  let buyPrice: number | null = null;

  for (const trade of trades) {
    if (trade.type === 'BUY' || trade.type === 'RECURRING_BUY') {
      buyPrice = trade.price;
    } else if (trade.type === 'SELL' && buyPrice !== null) {
      const returnPct = ((trade.price - buyPrice) / buyPrice) * 100;
      returns.push(returnPct);
      buyPrice = null;
    }
  }

  return returns;
};

// Run Monte Carlo simulation with cooldown buffer
const runMonteCarloSimulation = (
  returns: number[],
  numSimulations: number,
  numTradesForward: number,
  cooldownBuffer: number,
  initialEquity: number = 10000
): SimulationResults => {
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r <= 0);
  const winRate = returns.length > 0 ? wins.length / returns.length : 0.5;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  const allFinalValues: number[] = [];
  const samplePaths: number[][] = [];
  const numSamplePaths = 15; // Keep 15 paths for visualization

  for (let sim = 0; sim < numSimulations; sim++) {
    let equity = initialEquity;
    const path: number[] = [equity];
    const recentlyUsed: number[] = [];

    for (let t = 0; t < numTradesForward; t++) {
      const isWin = Math.random() < winRate;
      const pool = isWin ? wins : losses;

      if (pool.length === 0) continue;

      // Filter out recently used returns (cooldown buffer)
      let available = pool.filter(r => !recentlyUsed.includes(r));
      if (available.length === 0) {
        available = pool; // Fallback if all used
      }

      // Pick random return from available pool
      const chosenReturn = available[Math.floor(Math.random() * available.length)];

      // Update cooldown buffer
      recentlyUsed.push(chosenReturn);
      if (recentlyUsed.length > cooldownBuffer) {
        recentlyUsed.shift();
      }

      // Apply return to equity
      equity *= (1 + chosenReturn / 100);
      path.push(equity);
    }

    allFinalValues.push(equity);

    // Store sample paths for visualization
    if (sim < numSamplePaths) {
      samplePaths.push(path);
    }
  }

  // Calculate metrics
  const sortedFinals = [...allFinalValues].sort((a, b) => a - b);
  const finalReturns = allFinalValues.map(v => ((v - initialEquity) / initialEquity) * 100);
  const sortedReturns = [...finalReturns].sort((a, b) => a - b);

  const expectedReturn = finalReturns.reduce((a, b) => a + b, 0) / finalReturns.length;
  const medianReturn = sortedReturns[Math.floor(sortedReturns.length / 2)];
  
  // VaR 95% - 5th percentile of returns
  const var95Index = Math.floor(sortedReturns.length * 0.05);
  const var95 = sortedReturns[var95Index];
  
  // CVaR 95% - average of returns below VaR
  const cvar95Returns = sortedReturns.slice(0, var95Index + 1);
  const cvar95 = cvar95Returns.length > 0 ? cvar95Returns.reduce((a, b) => a + b, 0) / cvar95Returns.length : var95;

  // Probability metrics
  const probPositive = (finalReturns.filter(r => r > 0).length / finalReturns.length) * 100;
  const probGt10 = (finalReturns.filter(r => r > 10).length / finalReturns.length) * 100;
  const probGt20 = (finalReturns.filter(r => r > 20).length / finalReturns.length) * 100;

  // Drawdown probability - check if any path had >20% drawdown
  let drawdownCount = 0;
  for (let sim = 0; sim < Math.min(numSimulations, 1000); sim++) {
    // Re-simulate for drawdown check on subset
    let equity = initialEquity;
    let peak = equity;
    let hadDrawdown = false;
    const recentlyUsed: number[] = [];

    for (let t = 0; t < numTradesForward && !hadDrawdown; t++) {
      const isWin = Math.random() < winRate;
      const pool = isWin ? wins : losses;
      if (pool.length === 0) continue;

      let available = pool.filter(r => !recentlyUsed.includes(r));
      if (available.length === 0) available = pool;

      const chosenReturn = available[Math.floor(Math.random() * available.length)];
      recentlyUsed.push(chosenReturn);
      if (recentlyUsed.length > cooldownBuffer) recentlyUsed.shift();

      equity *= (1 + chosenReturn / 100);
      peak = Math.max(peak, equity);
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > 20) hadDrawdown = true;
    }
    if (hadDrawdown) drawdownCount++;
  }
  const probDrawdown20 = (drawdownCount / Math.min(numSimulations, 1000)) * 100;

  // Build distribution data (binned histogram)
  const binSize = 10;
  const minReturn = Math.floor(Math.min(...finalReturns) / binSize) * binSize;
  const maxReturn = Math.ceil(Math.max(...finalReturns) / binSize) * binSize;
  const distribution: Array<{ return: number; frequency: number }> = [];

  for (let bin = minReturn; bin <= maxReturn; bin += binSize) {
    const count = finalReturns.filter(r => r >= bin && r < bin + binSize).length;
    distribution.push({ return: bin, frequency: count });
  }

  // Build paths data for chart
  const maxPathLength = Math.max(...samplePaths.map(p => p.length));
  const paths: Array<{ trade: number; [key: string]: number }> = [];

  // Calculate mean path
  for (let t = 0; t < maxPathLength; t++) {
    const point: { trade: number; [key: string]: number } = { trade: t };
    
    // Add sample paths
    samplePaths.forEach((path, i) => {
      if (t < path.length) {
        point[`path${i}`] = path[t];
      }
    });

    // Calculate mean across all sample paths at this trade
    const valuesAtT = samplePaths.filter(p => t < p.length).map(p => p[t]);
    point.mean = valuesAtT.reduce((a, b) => a + b, 0) / valuesAtT.length;

    paths.push(point);
  }

  return {
    paths,
    allFinalValues,
    metrics: {
      expectedReturn,
      medianReturn,
      var95,
      cvar95,
      probPositive,
      probGt10,
      probGt20,
      probDrawdown20,
    },
    distribution,
    params: {
      winRate: winRate * 100,
      avgWin,
      avgLoss,
    },
  };
};

const MonteCarloAnalysis = ({ trades }: MonteCarloAnalysisProps) => {
  // Simulation parameters
  const [numSimulations, setNumSimulations] = useState(10000);
  const [numTradesForward, setNumTradesForward] = useState(100);
  const [cooldownBuffer, setCooldownBuffer] = useState(3);

  // Results state
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Extract returns from trades
  const returns = useMemo(() => extractReturns(trades), [trades]);

  // Calculate input trade stats
  const tradeStats = useMemo(() => {
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r <= 0);

    return {
      totalTrades: returns.length,
      winRate: returns.length > 0 ? (wins.length / returns.length) * 100 : 0,
      avgWin: wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    };
  }, [returns]);

  // Run simulation
  const runSimulation = useCallback(() => {
    if (returns.length < 2) {
      toast.error("Need at least 2 completed trades to run simulation");
      return;
    }

    setIsLoading(true);

    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      try {
        const result = runMonteCarloSimulation(
          returns,
          numSimulations,
          numTradesForward,
          cooldownBuffer
        );
        setResults(result);
        toast.success("Monte Carlo simulation complete");
      } catch (err) {
        toast.error("Simulation failed");
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }, 50);
  }, [returns, numSimulations, numTradesForward, cooldownBuffer]);

  // Auto-run on mount if we have trades
  useEffect(() => {
    if (returns.length >= 2) {
      runSimulation();
    }
  }, []); // Only on mount

  // Format metrics for display
  const mcMetrics = results ? [
    { icon: TrendingUp, label: "Expected Return", value: `${results.metrics.expectedReturn >= 0 ? '+' : ''}${results.metrics.expectedReturn.toFixed(1)}%`, color: results.metrics.expectedReturn >= 0 ? "text-success" : "text-destructive" },
    { icon: Target, label: "Median Return", value: `${results.metrics.medianReturn >= 0 ? '+' : ''}${results.metrics.medianReturn.toFixed(1)}%`, color: results.metrics.medianReturn >= 0 ? "text-success" : "text-destructive" },
    { icon: TrendingDown, label: "VaR (95%)", value: `${results.metrics.var95.toFixed(1)}%`, color: "text-destructive" },
    { icon: Percent, label: "CVaR (95%)", value: `${results.metrics.cvar95.toFixed(1)}%`, color: "text-destructive" },
  ] : [];

  const probabilityMetrics = results ? [
    { label: "P(Return > 0%)", value: `${results.metrics.probPositive.toFixed(1)}%` },
    { label: "P(Return > 10%)", value: `${results.metrics.probGt10.toFixed(1)}%` },
    { label: "P(Return > 20%)", value: `${results.metrics.probGt20.toFixed(1)}%` },
    { label: "P(Drawdown > 20%)", value: `${results.metrics.probDrawdown20.toFixed(1)}%` },
  ] : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Monte Carlo Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-accent/10 border border-accent/20">
          <Shuffle className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Monte Carlo Simulation</h3>
          <p className="text-sm text-muted-foreground">
            Bootstrap resampling with cooldown buffer
          </p>
        </div>
      </div>

      {/* Parameter Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="p-5 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
      >
        <h4 className="text-md font-semibold mb-4">Simulation Parameters</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Number of Simulations */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">Simulations</Label>
              <Input
                type="number"
                value={numSimulations}
                onChange={(e) => setNumSimulations(Math.max(1000, Math.min(50000, parseInt(e.target.value) || 1000)))}
                className="w-24 h-8 text-right font-mono"
                min={1000}
                max={50000}
              />
            </div>
            <Slider
              value={[numSimulations]}
              onValueChange={(v) => setNumSimulations(v[0])}
              min={1000}
              max={50000}
              step={1000}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">1,000 - 50,000</p>
          </div>

          {/* Trades Forward */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">Trades Forward</Label>
              <Input
                type="number"
                value={numTradesForward}
                onChange={(e) => setNumTradesForward(Math.max(25, Math.min(500, parseInt(e.target.value) || 25)))}
                className="w-24 h-8 text-right font-mono"
                min={25}
                max={500}
              />
            </div>
            <Slider
              value={[numTradesForward]}
              onValueChange={(v) => setNumTradesForward(v[0])}
              min={25}
              max={500}
              step={25}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">25 - 500 trades</p>
          </div>

          {/* Cooldown Buffer */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Label className="text-sm text-muted-foreground">Cooldown Buffer</Label>
                <TooltipProvider>
                  <UITooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[250px]">
                      <p>Prevents reusing the same return for X consecutive trades, ensuring more realistic path diversity.</p>
                    </TooltipContent>
                  </UITooltip>
                </TooltipProvider>
              </div>
              <Input
                type="number"
                value={cooldownBuffer}
                onChange={(e) => setCooldownBuffer(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                className="w-24 h-8 text-right font-mono"
                min={1}
                max={10}
              />
            </div>
            <Slider
              value={[cooldownBuffer]}
              onValueChange={(v) => setCooldownBuffer(v[0])}
              min={1}
              max={10}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">1 - 10 trades</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-6 pt-4 border-t border-border">
          {/* Input Trade Stats */}
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Trades:</span>
              <span className="ml-2 font-mono text-foreground">{tradeStats.totalTrades}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Win Rate:</span>
              <span className="ml-2 font-mono text-foreground">{tradeStats.winRate.toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg Win:</span>
              <span className="ml-2 font-mono text-success">+{tradeStats.avgWin.toFixed(2)}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg Loss:</span>
              <span className="ml-2 font-mono text-destructive">{tradeStats.avgLoss.toFixed(2)}%</span>
            </div>
          </div>

          <Button
            onClick={runSimulation}
            disabled={isLoading || returns.length < 2}
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Simulation
          </Button>
        </div>
      </motion.div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Running {numSimulations.toLocaleString()} simulations...
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {results && !isLoading && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {mcMetrics.map((metric, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
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

          {/* Simulation Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Simulation Paths */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
            >
              <h4 className="text-md font-semibold mb-4">Simulation Paths (Sample)</h4>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={results.paths}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="trade"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                      label={{ value: "Trades", position: "bottom", offset: -5 }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => [`$${value.toFixed(0)}`, "Equity"]}
                    />
                    {/* Render sample paths */}
                    {Array.from({ length: 15 }, (_, i) => (
                      <Line
                        key={`path${i}`}
                        type="monotone"
                        dataKey={`path${i}`}
                        stroke={`hsl(var(--primary) / ${0.2 + (i * 0.05)})`}
                        strokeWidth={1}
                        dot={false}
                      />
                    ))}
                    {/* Mean path */}
                    <Line
                      type="monotone"
                      dataKey="mean"
                      stroke="hsl(var(--success))"
                      strokeWidth={2}
                      dot={false}
                      name="Mean"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-4 mt-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-success" />
                  <span className="text-xs text-muted-foreground">Mean Path</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-primary/50" />
                  <span className="text-xs text-muted-foreground">Sample Paths</span>
                </div>
              </div>
            </motion.div>

            {/* Return Distribution */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
            >
              <h4 className="text-md font-semibold mb-4">Return Distribution</h4>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={results.distribution}>
                    <defs>
                      <linearGradient id="mcDist" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="return"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => [value, "Frequency"]}
                      labelFormatter={(label) => `Return: ${label}%`}
                    />
                    <Area
                      type="monotone"
                      dataKey="frequency"
                      stroke="hsl(var(--accent))"
                      strokeWidth={2}
                      fill="url(#mcDist)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* Probability Metrics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
          >
            <h4 className="text-md font-semibold mb-3">Probability Metrics</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {probabilityMetrics.map((metric, index) => (
                <div key={index} className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">{metric.label}</p>
                  <p className="text-lg font-bold font-mono text-primary">{metric.value}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Computed Statistics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
          >
            <h4 className="text-md font-semibold mb-3">Simulation Statistics</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Win Rate:</span>
                <span className="ml-2 font-mono text-foreground">{results.params.winRate.toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Avg Win:</span>
                <span className="ml-2 font-mono text-success">+{results.params.avgWin.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Avg Loss:</span>
                <span className="ml-2 font-mono text-destructive">{results.params.avgLoss.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cooldown:</span>
                <span className="ml-2 font-mono text-foreground">{cooldownBuffer} trades</span>
              </div>
            </div>
          </motion.div>
        </>
      )}

      {/* No Trades State */}
      {returns.length < 2 && !isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Shuffle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              Run a backtest with at least 2 completed trades to enable Monte Carlo simulation.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default MonteCarloAnalysis;
