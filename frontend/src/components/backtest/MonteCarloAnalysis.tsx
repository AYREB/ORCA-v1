import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Shuffle, TrendingUp, TrendingDown, Target, Percent, Play, Info, Loader2, ChevronDown, RotateCcw } from "lucide-react";
import { ComposedChart, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, ReferenceLine } from "recharts";
import { TradeEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";

interface MonteCarloAnalysisProps {
  trades: TradeEntry[];
}

interface SimulationResults {
  // Combined data with paths + percentile bands merged
  chartData: Array<{ trade: number; [key: string]: number }>;
  allFinalValues: number[];
  numSamplePaths: number;
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
    numWins: number;
    numLosses: number;
  };
}

// Extract returns from trade pairs
const extractReturns = (trades: TradeEntry[]): number[] => {
  const returns: number[] = [];
  // Detect direction from first trade
  const dirMap = new Map<string, "long" | "short">();
  for (const t of trades) {
    if (!dirMap.has(t.ticker)) {
      dirMap.set(t.ticker, t.type === "BUY" ? "long" : "short");
    }
  }

  let entryPrice: number | null = null;
  let currentDir: "long" | "short" = "long";

  for (const trade of trades) {
    const dir = dirMap.get(trade.ticker) || "long";
    const isEntry = dir === "long" ? trade.type === "BUY" : trade.type === "SELL";
    const isExit = dir === "long" ? trade.type === "SELL" : trade.type === "BUY";

    if (isEntry) {
      entryPrice = trade.price;
      currentDir = dir;
    } else if (isExit && entryPrice !== null) {
      const returnPct = currentDir === "long"
        ? ((trade.price - entryPrice) / entryPrice) * 100
        : ((entryPrice - trade.price) / entryPrice) * 100;
      returns.push(returnPct);
      entryPrice = null;
    }
  }

  return returns;
};

// Calculate percentile from sorted array
const getPercentile = (sortedArr: number[], p: number): number => {
  const index = Math.floor((p / 100) * sortedArr.length);
  return sortedArr[Math.min(index, sortedArr.length - 1)];
};

// Generate color for path based on final return (red to green gradient)
const getPathColor = (finalReturn: number, opacity: number = 0.4): string => {
  // Clamp return between -50% and +100% for color mapping
  const normalized = Math.max(-50, Math.min(100, finalReturn));
  // Map to 0-1 range (0 = -50%, 0.33 = 0%, 1 = +100%)
  const t = (normalized + 50) / 150;
  
  // HSL interpolation: red (0) -> yellow (60) -> green (120)
  const hue = t * 120;
  return `hsla(${hue}, 70%, 50%, ${opacity})`;
};

// Run Monte Carlo simulation with cooldown buffer
const runMonteCarloSimulation = (
  returns: number[],
  numSimulations: number,
  numTradesForward: number,
  cooldownBuffer: number,
  initialEquity: number = 10000,
  numSamplePaths: number = 500
): SimulationResults => {
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r <= 0);
  const winRate = returns.length > 0 ? wins.length / returns.length : 0.5;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  const allFinalValues: number[] = [];
  const samplePaths: number[][] = [];
  const sampleFinalReturns: number[] = [];
  
  // Store all paths for percentile calculation
  const allPaths: number[][] = [];

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

    const finalReturn = ((equity - initialEquity) / initialEquity) * 100;
    allFinalValues.push(equity);
    allPaths.push(path);

    // Store sample paths for visualization (first N paths)
    if (sim < numSamplePaths) {
      samplePaths.push(path);
      sampleFinalReturns.push(finalReturn);
    }
  }

  // Calculate percentile bands at each trade step
  const maxPathLength = numTradesForward + 1;

  // Build combined chart data with paths AND percentile bands
  const chartData: Array<{ trade: number; [key: string]: number }> = [];

  for (let t = 0; t < maxPathLength; t++) {
    const valuesAtT = allPaths.map(p => p[Math.min(t, p.length - 1)]).sort((a, b) => a - b);
    const mean = valuesAtT.reduce((a, b) => a + b, 0) / valuesAtT.length;
    
    const point: { trade: number; [key: string]: number } = {
      trade: t,
      p5: getPercentile(valuesAtT, 5),
      p25: getPercentile(valuesAtT, 25),
      p50: getPercentile(valuesAtT, 50),
      p75: getPercentile(valuesAtT, 75),
      p95: getPercentile(valuesAtT, 95),
      mean,
    };

    // Add all sample paths to this point
    samplePaths.forEach((path, i) => {
      if (t < path.length) {
        point[`path${i}`] = path[t];
        point[`pathReturn${i}`] = sampleFinalReturns[i]; // Store final return for coloring
      }
    });

    chartData.push(point);
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

  return {
    chartData,
    allFinalValues,
    numSamplePaths,
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
      numWins: wins.length,
      numLosses: losses.length,
    },
  };
};

const MonteCarloAnalysis = ({ trades }: MonteCarloAnalysisProps) => {
  // Simulation parameters
  const [numSimulations, setNumSimulations] = useState(10000);
  const [numTradesForward, setNumTradesForward] = useState(100);
  const [cooldownBuffer, setCooldownBuffer] = useState(3);

  // Display settings
  const [numDisplayPaths, setNumDisplayPaths] = useState<string>("100");
  const [selectedPath, setSelectedPath] = useState<number | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);

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
          cooldownBuffer,
          10000,
          500 // Store 500 sample paths for rich visualization
        );
        setResults(result);
        setSelectedPath(null);
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

  // Get number of paths to display
  const displayPathCount = useMemo(() => {
    return parseInt(numDisplayPaths) || 50;
  }, [numDisplayPaths]);

  // Calculate selected path stats
  const selectedPathStats = useMemo(() => {
    if (selectedPath === null || !results) return null;
    
    const pathData = results.chartData.map(p => p[`path${selectedPath}`]).filter(v => v !== undefined);
    if (pathData.length === 0) return null;

    const finalValue = pathData[pathData.length - 1];
    const initialValue = pathData[0];
    const returnPct = ((finalValue - initialValue) / initialValue) * 100;

    // Calculate max drawdown
    let peak = initialValue;
    let maxDrawdown = 0;
    for (const value of pathData) {
      peak = Math.max(peak, value);
      const drawdown = ((peak - value) / peak) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return {
      finalValue,
      returnPct,
      maxDrawdown,
    };
  }, [selectedPath, results]);

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

      {/* Algorithm Explainer */}
      <Collapsible open={showExplainer} onOpenChange={setShowExplainer}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="gap-2 text-muted-foreground hover:text-foreground w-full justify-start px-3">
            <Info className="h-4 w-4" />
            <span>How does this work?</span>
            <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showExplainer ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 rounded-lg border border-border bg-muted/30 mt-2"
          >
            <h4 className="font-semibold mb-3 text-sm">Monte Carlo Bootstrap Algorithm</h4>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                <span className="text-foreground">Flip a weighted coin</span> based on your historical win rate ({tradeStats.winRate.toFixed(1)}%)
              </li>
              <li>
                <span className="text-foreground">If WIN:</span> Randomly select from your {returns.filter(r => r > 0).length} historical winning trade returns
              </li>
              <li>
                <span className="text-foreground">If LOSS:</span> Randomly select from your {returns.filter(r => r <= 0).length} historical losing trade returns
              </li>
              <li>
                <span className="text-foreground">Cooldown buffer:</span> Prevents reusing the same return for {cooldownBuffer} consecutive trades
              </li>
              <li>
                <span className="text-foreground">Repeat</span> for {numTradesForward} trades across {numSimulations.toLocaleString()} simulations
              </li>
            </ol>
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
              This approach preserves the realistic distribution of your actual trade outcomes while exploring many possible future scenarios.
            </p>
          </motion.div>
        </CollapsibleContent>
      </Collapsible>

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

          {/* Full-Width Simulation Paths Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
          >
            {/* Chart Header with Controls */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <div>
                <h4 className="text-md font-semibold">Monte Carlo Equity Paths</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {numSimulations.toLocaleString()} simulations, showing {displayPathCount} sample paths
                </p>
              </div>
              <div className="flex items-center gap-3">
                {selectedPath !== null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPath(null)}
                    className="gap-1 text-xs"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset Selection
                  </Button>
                )}
                <ToggleGroup
                  type="single"
                  value={numDisplayPaths}
                  onValueChange={(v) => v && setNumDisplayPaths(v)}
                  className="bg-muted/50 rounded-lg p-1"
                >
                  <ToggleGroupItem value="100" className="text-xs px-3 py-1 h-7">
                    100
                  </ToggleGroupItem>
                  <ToggleGroupItem value="250" className="text-xs px-3 py-1 h-7">
                    250
                  </ToggleGroupItem>
                  <ToggleGroupItem value="500" className="text-xs px-3 py-1 h-7">
                    All 500
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            {/* Selected Path Stats */}
            {selectedPathStats && (
              <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center gap-6 text-sm">
                <span className="text-muted-foreground">
                  Path #{selectedPath}:
                </span>
                <span>
                  <span className="text-muted-foreground">Final: </span>
                  <span className="font-mono">${selectedPathStats.finalValue.toFixed(0)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Return: </span>
                  <span className={`font-mono ${selectedPathStats.returnPct >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {selectedPathStats.returnPct >= 0 ? '+' : ''}{selectedPathStats.returnPct.toFixed(1)}%
                  </span>
                </span>
                <span>
                  <span className="text-muted-foreground">Max DD: </span>
                  <span className="font-mono text-destructive">-{selectedPathStats.maxDrawdown.toFixed(1)}%</span>
                </span>
              </div>
            )}

            {/* Main Chart - 500px height for better visualization */}
            <div className="h-[500px] bg-[#0a0a0a] rounded-lg p-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={results.chartData}>
                  <defs>
                    <linearGradient id="band5_95" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.1} />
                      <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="band25_75" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis
                    dataKey="trade"
                    stroke="rgba(255,255,255,0.3)"
                    tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                    label={{ value: "Trade #", position: "insideBottom", offset: -5, fill: "rgba(255,255,255,0.5)" }}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.3)"
                    tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === 'p95') return [`$${value.toFixed(0)}`, '95th %ile'];
                      if (name === 'p75') return [`$${value.toFixed(0)}`, '75th %ile'];
                      if (name === 'p50') return [`$${value.toFixed(0)}`, 'Median'];
                      if (name === 'p25') return [`$${value.toFixed(0)}`, '25th %ile'];
                      if (name === 'p5') return [`$${value.toFixed(0)}`, '5th %ile'];
                      if (name === 'mean') return [`$${value.toFixed(0)}`, 'Mean'];
                      return [`$${value.toFixed(0)}`, 'Equity'];
                    }}
                    labelFormatter={(label) => `Trade ${label}`}
                  />

                  {/* 5th-95th Percentile Band */}
                  <Area
                    type="monotone"
                    dataKey="p95"
                    stroke="none"
                    fill="url(#band5_95)"
                    fillOpacity={1}
                  />
                  <Area
                    type="monotone"
                    dataKey="p5"
                    stroke="none"
                    fill="#0a0a0a"
                    fillOpacity={1}
                  />

                  {/* 25th-75th Percentile Band */}
                  <Area
                    type="monotone"
                    dataKey="p75"
                    stroke="none"
                    fill="url(#band25_75)"
                    fillOpacity={1}
                  />
                  <Area
                    type="monotone"
                    dataKey="p25"
                    stroke="none"
                    fill="#0a0a0a"
                    fillOpacity={1}
                  />

                  {/* Sample Paths - color coded by final return (red=loss, green=profit) */}
                  {Array.from({ length: displayPathCount }, (_, i) => {
                    // Get final return for this path to determine color
                    const lastPoint = results.chartData[results.chartData.length - 1];
                    const pathReturn = lastPoint?.[`pathReturn${i}`] ?? 0;
                    const pathColor = getPathColor(pathReturn, selectedPath === i ? 0.9 : selectedPath !== null ? 0.1 : 0.35);
                    
                    return (
                      <Line
                        key={`path${i}`}
                        type="monotone"
                        dataKey={`path${i}`}
                        stroke={pathColor}
                        strokeWidth={selectedPath === i ? 2.5 : 1}
                        dot={false}
                        activeDot={false}
                        onClick={() => setSelectedPath(i)}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  })}

                  {/* Median Line */}
                  <Line
                    type="monotone"
                    dataKey="p50"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Median"
                  />

                  {/* Mean Line */}
                  <Line
                    type="monotone"
                    dataKey="mean"
                    stroke="#ffffff"
                    strokeWidth={3}
                    dot={false}
                    name="Mean"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-6 mt-4 pt-3 border-t border-border">
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-white rounded" />
                <span className="text-xs text-muted-foreground">Mean Path</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-primary" />
                <span className="text-xs text-muted-foreground">Median Path</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 rounded-sm" style={{ background: 'linear-gradient(to right, #ef4444, #eab308, #22c55e)' }} />
                <span className="text-xs text-muted-foreground">Paths (Loss → Profit)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-primary/20 rounded-sm" />
                <span className="text-xs text-muted-foreground">25th-75th %ile</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-muted-foreground/10 rounded-sm" />
                <span className="text-xs text-muted-foreground">5th-95th %ile</span>
              </div>
            </div>
          </motion.div>

          {/* Secondary Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Return Distribution */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
            >
              <h4 className="text-md font-semibold mb-4">Return Distribution</h4>
              <div className="h-[250px]">
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
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
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
                    {/* VaR line */}
                    <ReferenceLine
                      x={Math.round(results.metrics.var95 / 10) * 10}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="3 3"
                      label={{ value: 'VaR 95%', position: 'top', fill: 'hsl(var(--destructive))', fontSize: 10 }}
                    />
                    {/* Median line */}
                    <ReferenceLine
                      x={Math.round(results.metrics.medianReturn / 10) * 10}
                      stroke="hsl(var(--primary))"
                      strokeDasharray="3 3"
                      label={{ value: 'Median', position: 'top', fill: 'hsl(var(--primary))', fontSize: 10 }}
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

            {/* Probability Metrics */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
            >
              <h4 className="text-md font-semibold mb-4">Probability Metrics</h4>
              <div className="grid grid-cols-2 gap-4">
                {probabilityMetrics.map((metric, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/30 border border-border">
                    <p className="text-xs text-muted-foreground mb-2">{metric.label}</p>
                    <p className="text-2xl font-bold font-mono text-primary">{metric.value}</p>
                  </div>
                ))}
              </div>

              {/* Additional Stats */}
              <div className="mt-4 pt-4 border-t border-border">
                <h5 className="text-sm font-medium mb-3">Simulation Statistics</h5>
                <div className="grid grid-cols-2 gap-4 text-sm">
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
              </div>
            </motion.div>
          </div>
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
