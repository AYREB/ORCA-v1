import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Dna, Loader2, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import {
  api,
  GeneticJobStatus,
  GeneticOptimizationResult,
  ParameterChoice,
  BacktestResult,
  SavedStrategy,
} from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import React from "react";
import { useSettings } from "@/hooks/useSettings";
import { safeColor, colorWithAlpha, mixColors } from "@/lib/chartTheme";

interface GeneticOptimizerProps {
  dslJson: Record<string, unknown> | null;
  strategyId?: number | null;
  strategyName?: string | null;
  onBestApplied?: (result: BacktestResult, strategy?: { id?: number; name: string }) => void;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

const BLOCKED_OPTIMIZER_PARAM_NAMES = new Set(["spread"]);

function isOptimizableParameterPath(path: string): boolean {
  const lastSegment = path.replace(/\]/g, "").split(".").pop()?.split("[").pop()?.toLowerCase();
  return !!lastSegment && !BLOCKED_OPTIMIZER_PARAM_NAMES.has(lastSegment);
}

// shared helper from ParameterOptimizer (duplicated to keep component standalone)
function extractOptimizableParameters(
  node: unknown,
  path = "",
  parentIndicator: string | null = null
): Record<string, { value: number; indicator: string | null }> {
  const params: Record<string, { value: number; indicator: string | null }> = {};

  if (typeof node === "number" && Number.isFinite(node)) {
    if (path && isOptimizableParameterPath(path)) params[path] = { value: node, indicator: parentIndicator };
    return params;
  }

  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      Object.assign(params, extractOptimizableParameters(item, itemPath, parentIndicator));
    });
  } else if (typeof node === "object" && node !== null) {
    let currentIndicator = parentIndicator;
    const nodeObj = node as Record<string, unknown>;
    if (nodeObj.func && typeof nodeObj.func === "string") {
      currentIndicator = nodeObj.func;
    }
    Object.entries(nodeObj).forEach(([key, value]) => {
      const newPath = path ? `${path}.${key}` : key;
      Object.assign(params, extractOptimizableParameters(value, newPath, currentIndicator));
    });
  }

  return params;
}

function getDisplayName(paramPath: string, indicator: string | null): string {
  const parts = paramPath.split(".");
  const paramName = parts[parts.length - 1];
  if (paramPath.includes(".arg.") && indicator) return `${indicator} - ${paramName}`;
  return paramName;
}

const GeneticOptimizer = ({ dslJson, strategyId, strategyName, onBestApplied }: GeneticOptimizerProps) => {
  const { settings } = useSettings();
  const chartColors = settings.appearance.chartColors;
  const [paramChoices, setParamChoices] = useState<Record<string, ParameterChoice>>({});
  const [gaSettings, setGaSettings] = useState({
    population: 20,
    generations: 10,
    mutation_rate: 0.1,
    crossover_rate: 0.7,
    elite_size: 2,
  });
  const [initialBalance, setInitialBalance] = useState(10000);
  const [result, setResult] = useState<GeneticOptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completedRuns, setCompletedRuns] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [runErrors, setRunErrors] = useState<GeneticOptimizationResult["errors"]>([]);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyMode, setApplyMode] = useState<"overwrite" | "new">("overwrite");
  const [newStrategyName, setNewStrategyName] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [strategiesCache, setStrategiesCache] = useState<SavedStrategy[]>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [sampledCycleCount, setSampledCycleCount] = useState(0);
  const [sampledCycleSeconds, setSampledCycleSeconds] = useState(0);
  const lastCompletedRef = useRef(0);
  const lastSampleTsRef = useRef<number | null>(null);

  const setGroupEnabled = (group: "arguments" | "conditions", enabled: boolean) => {
    setParamChoices((prev) => {
      const next: Record<string, ParameterChoice> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const upper = key.toUpperCase();
        const isArg = upper.includes("ARGUMENT");
        const isCond = upper.includes("CONDITION");
        const match = group === "arguments" ? isArg : isCond;
        next[key] = match ? ({ ...val, enabled } as any) : val;
      });
      return next;
    });
  };

  useEffect(() => {
    if (dslJson) {
      const params = extractOptimizableParameters(dslJson);
      const initialChoices: Record<string, ParameterChoice> = {};
      Object.entries(params).forEach(([param, info]) => {
        initialChoices[param] = { mode: "auto", indicator: info.indicator || undefined, start: undefined, end: undefined, steps: undefined, enabled: true } as any;
      });
      setParamChoices(initialChoices);
    }
  }, [dslJson]);

  const toggleParam = (param: string, enabled: boolean) => {
    setParamChoices((prev) => ({ ...prev, [param]: { ...prev[param], enabled, mode: enabled ? "auto" : "nochange" } as any }));
  };

  const handleRangeChange = (param: string, field: "start" | "end" | "steps", value: number) =>
    setParamChoices((prev) => {
      const enabled = (prev[param] as any)?.enabled !== false;
      return {
        ...prev,
        [param]: { ...prev[param], [field]: value, mode: enabled ? "range" : "nochange", enabled } as any,
      };
    });

  const ensureStrategies = async () => {
    if (strategiesCache.length > 0) return strategiesCache;
    try {
      const list = await api.fetchStrategies();
      setStrategiesCache(list);
      return list;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load strategies for apply");
      return [];
    }
  };

  const bestDsl = result?.best_result?.dsl as Record<string, unknown> | undefined;

  const handleOpenApply = async () => {
    if (!result?.best_result) {
      toast.error("Run optimizer first");
      return;
    }
    setApplyMode(strategyId ? "overwrite" : "new");
    setNewStrategyName(strategyName || "");
    setApplyError(null);
    await ensureStrategies();
    setShowApplyDialog(true);
  };

  const validateName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a strategy name");
    const list = await ensureStrategies();
    if (list.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("A strategy with that name already exists");
    }
    return trimmed;
  };

  const handleApplyBest = async () => {
    if (!result?.best_result || !bestDsl) return;
    setApplying(true);
    setApplyError(null);
    try {
      let chosenName = newStrategyName || strategyName || "";
      const mode = applyMode;
      if (mode === "new" || (!strategyId && mode === "overwrite")) {
        chosenName = await validateName(chosenName);
      }
      const backtestResult = await api.backtestDSLJSON(bestDsl);
      api.setLastBacktestResult(backtestResult);
      let savedMeta: { id?: number; name: string } | undefined;
      if (mode === "overwrite") {
        if (strategyId) {
          const updated = await api.updateStrategy(strategyId, {
            name: chosenName || strategyName || undefined,
            dsl: JSON.stringify(bestDsl, null, 2),
            dslJson: bestDsl,
            lastResult: backtestResult,
          });
          savedMeta = { id: updated.id, name: updated.name };
        } else {
          const created = await api.createStrategy({
            name: chosenName,
            dsl: JSON.stringify(bestDsl, null, 2),
            dslJson: bestDsl,
            lastResult: backtestResult,
          });
          savedMeta = { id: created.id, name: created.name };
        }
      } else {
        const created = await api.createStrategy({
          name: chosenName,
          dsl: JSON.stringify(bestDsl, null, 2),
          dslJson: bestDsl,
          lastResult: backtestResult,
        });
        savedMeta = { id: created.id, name: created.name };
      }
      onBestApplied?.(backtestResult, savedMeta);
      toast.success("Best parameters applied to backtest");
      setShowApplyDialog(false);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to apply best result");
    } finally {
      setApplying(false);
    }
  };

  const setAllEnabled = () =>
    setParamChoices((prev) => {
      const next: Record<string, ParameterChoice> = {};
      Object.entries(prev).forEach(([key, val]) => (next[key] = { ...val, mode: "auto", enabled: true } as any));
      return next;
    });

  const activeParams = useMemo(
    () => Object.entries(paramChoices).filter(([_, choice]) => (choice as any).enabled !== false).length,
    [paramChoices]
  );

  const estimatedRuns = useMemo(() => gaSettings.population * gaSettings.generations, [gaSettings]);
  const estimatedSeconds = useMemo(() => Math.ceil(estimatedRuns * 1.5), [estimatedRuns]);
  const estimatedTime = useMemo(() => formatDuration(estimatedSeconds), [estimatedSeconds]);

  const runningEtaSeconds = useMemo(() => {
    if (!loading) return null;

    if (sampledCycleCount < 3 || totalRuns <= 0) return null;
    const avgSecondsPerRun = sampledCycleSeconds / sampledCycleCount;
    const remainingRuns = Math.max(0, totalRuns - completedRuns);
    return Math.max(0, Math.ceil(avgSecondsPerRun * remainingRuns));
  }, [loading, sampledCycleCount, sampledCycleSeconds, totalRuns, completedRuns]);

  const generationsData = useMemo(() => {
    const gens = gaSettings.generations || 1;
    const pop = gaSettings.population || 1;
    const runs = result?.all_backtests || [];
    const bestPct = runs.reduce((m, r) => Math.max(m, r.results.pct_change ?? -Infinity), -Infinity);
    const chunks: Array<
      Array<{
        pct: number | null;
        idx: number;
        gen: number;
      }>
    > = [];

    const filled = completedRuns;
    let consumed = 0;

    for (let g = 0; g < gens; g++) {
      const start = g * pop;
      const slice = runs.slice(start, start + pop);
      const genNodes: Array<{ pct: number | null; idx: number; gen: number }> = [];

      slice.forEach((r, i) => {
        genNodes.push({ pct: r.results.pct_change ?? 0, idx: i, gen: g });
      });

      // If we are still running and don't have enough runs to fill this generation, add placeholders
      const targetCount = pop;
      while (genNodes.length < targetCount && consumed < filled) {
        genNodes.push({ pct: null, idx: genNodes.length, gen: g });
        consumed += 1;
      }
      chunks.push(genNodes);
    }

    return { chunks, bestPct: bestPct === -Infinity ? 0 : bestPct || 0, gens, pop };
  }, [gaSettings.generations, gaSettings.population, result, completedRuns]);


  const generationProgress = useMemo(() => {
    const gens = gaSettings.generations || 1;
    const pop = gaSettings.population || 1;
    const total = Math.max(1, gens * pop);
    if (completedRuns >= total) {
      return Array.from({ length: gens }).map(() => 1);
    }
    const currentGen = Math.min(gens - 1, Math.floor(completedRuns / Math.max(pop, 1)));
    let genFrac = (completedRuns % Math.max(pop, 1)) / Math.max(pop, 1);
    if (genFrac === 0 && completedRuns > 0) genFrac = 1; // keep bar full at generation boundaries

    return Array.from({ length: gens }).map((_, idx) => {
      if (idx < currentGen) return 1;
      if (idx === currentGen) return genFrac;
      return 0;
    });
  }, [gaSettings.generations, gaSettings.population, completedRuns]);

  const EvolutionGraph: React.FC = () => {
    const { chunks, bestPct, gens, pop } = generationsData;
    if (!gens || !pop) return null;

    const width = Math.max(320, 180 * gens);
    const nodeSpacing = 60;
    const columnWidth = gens > 1 ? width / (gens - 1) : width;
    const svgHeight = Math.max(240, pop * nodeSpacing + 80);

    const nodes: Array<{ x: number; y: number; pct: number; gen: number; key: string }> = [];
    chunks.forEach((col, genIdx) => {
      col.forEach((n, idx) => {
        nodes.push({
          x: genIdx * columnWidth,
          y: idx * nodeSpacing + 30,
          pct: n.pct,
          gen: genIdx,
          key: `${genIdx}-${idx}`,
        });
      });
    });

    const connectors: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (let g = 0; g < gens - 1; g++) {
      const colA = nodes.filter((n) => n.gen === g);
      const colB = nodes.filter((n) => n.gen === g + 1);
      colA.forEach((na, idx) => {
        if (colB.length === 0) return;
        const target = colB[(idx + g) % colB.length];
        connectors.push({ x1: na.x, y1: na.y, x2: target.x, y2: target.y });
      });
    }

    const pctToColor = (pct: number) => {
      if (!bestPct) return "hsl(var(--muted-foreground))";
      const norm = Math.max(0, Math.min(1, pct / bestPct));
      return mixColors(chartColors.candleDown, chartColors.candleUp, norm, 0.9, "#ef4444", "#22c55e");
    };

    const perGenStats = chunks.map((col) => {
      const pcts = col.map((c) => c.pct).filter((p) => Number.isFinite(p));
      const sorted = [...pcts].sort((a, b) => a - b);
      const best = sorted.length ? sorted[sorted.length - 1] : 0;
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      return { best, median };
    });

    const handleMouseDown = (e: React.MouseEvent) => {
      setDragging(true);
      dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    };

    const handleMouseUp = () => {
      setDragging(false);
      dragStart.current = null;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      if (!dragging || !dragStart.current) return;
      setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    };

    return (
      <div className="w-full overflow-auto border border-border rounded-xl bg-card/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Dna className="h-4 w-4" />
            <span>Evolution graph</span>
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {gens} generations · pop {pop}
          </div>
        </div>
        <div
          className="overflow-hidden border border-border rounded-lg bg-card/60"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg
            width={width + 120}
            height={svgHeight}
            className="block cursor-grab active:cursor-grabbing"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
            viewBox={`${-60} 0 ${width + 120} ${svgHeight}`}
          >
            {connectors.map((c, idx) => (
              <line
                key={idx}
                x1={c.x1 + 16}
                y1={c.y1 + 8}
                x2={c.x2 - 16}
              y2={c.y2 + 8}
              stroke={colorWithAlpha(chartColors.grid, 0.6, "hsl(var(--border))")}
              strokeWidth={2}
                strokeDasharray="6 3"
              />
            ))}
            {nodes.map((n) => (
              <g key={n.key} transform={`translate(${n.x}, ${n.y})`}>
                <circle cx={0} cy={0} r={14} fill={pctToColor(n.pct)} />
                <rect
                  x={-32}
                  y={18}
                  width={64}
                  height={18}
                  rx={8}
                  fill={safeColor(chartColors.background, "hsl(var(--background))")}
                  stroke={colorWithAlpha(chartColors.grid, 0.6, "hsl(var(--border))")}
                />
                <text
                  x={0}
                  y={32}
                  textAnchor="middle"
                  fontSize="10"
                  fill="hsl(var(--muted-foreground))"
                  className="font-mono"
                >
                  {n.pct?.toFixed ? n.pct.toFixed(1) : n.pct}
                </text>
              </g>
            ))}
            {perGenStats.map((stats, idx) => (
              <g key={`stat-${idx}`} transform={`translate(${idx * columnWidth}, ${svgHeight - 30})`}>
                <rect x={-38} y={-18} width={76} height={30} rx={8} fill={safeColor(chartColors.background, "hsl(var(--background))")} stroke={colorWithAlpha(chartColors.grid, 0.6, "hsl(var(--border))")} />
                <text x={0} y={-4} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))" className="font-mono">
                  G{idx + 1}
                </text>
                <text x={0} y={12} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))" className="font-mono">
                  ↑{stats.best?.toFixed ? stats.best.toFixed(1) : stats.best} | ~{stats.median?.toFixed ? stats.median.toFixed(1) : stats.median}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Nodes are individuals; color strength tracks relative return. Dashed links approximate lineage across generations. Per-generation chips show best and median returns.
        </div>
      </div>
    );
  };

  const submit = async () => {
    if (!dslJson) {
      toast.error("No DSL available. Load a strategy first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setRunErrors([]);
    setProgress(0);
    setCompletedRuns(0);
    setTotalRuns(0);
    setSampledCycleCount(0);
    setSampledCycleSeconds(0);
    lastCompletedRef.current = 0;
    lastSampleTsRef.current = Date.now();

    try {
      const payload: Record<string, ParameterChoice> = {};
      Object.entries(paramChoices).forEach(([param, choice]) => {
        if (!isOptimizableParameterPath(param)) return;
        const enabled = (choice as any).enabled !== false;
        if (!enabled) return;
        const hasRange = choice.start !== undefined && choice.end !== undefined && (choice.steps || 0) >= 2;
        payload[param] = {
          ...choice,
          mode: hasRange ? "range" : "auto",
          start: hasRange ? choice.start : undefined,
          end: hasRange ? choice.end : undefined,
          steps: hasRange ? choice.steps : undefined,
        };
      });

      if (Object.keys(payload).length === 0) {
        throw new Error("Select at least one parameter to optimize");
      }

      const start = await api.startGeneticJob(dslJson, payload, initialBalance, gaSettings);
      setTotalRuns(start.total_runs || estimatedRuns);

      const poll = async () => {
        const status: GeneticJobStatus = await api.getGeneticJobStatus(start.job_id);
        const nowTs = Date.now();
        const currentCompleted = status.completed_runs || 0;
        const previousCompleted = lastCompletedRef.current;
        const previousTs = lastSampleTsRef.current;

        if (previousTs !== null && currentCompleted > previousCompleted) {
          const deltaRuns = currentCompleted - previousCompleted;
          const deltaSeconds = Math.max(0, (nowTs - previousTs) / 1000);
          setSampledCycleCount((prev) => prev + deltaRuns);
          setSampledCycleSeconds((prev) => prev + deltaSeconds);
        }

        lastCompletedRef.current = currentCompleted;
        lastSampleTsRef.current = nowTs;

        setCompletedRuns(currentCompleted);
        setTotalRuns(status.total_runs);
        setProgress(status.progress);
        if (status.status === "completed" && status.result) {
          setResult(status.result);
          setRunErrors(status.result.errors || []);
          setLoading(false);
          toast.success("Genetic optimization complete");
          return;
        }
        if (status.status === "error") {
          setError(status.error || "Genetic optimizer failed");
          setLoading(false);
          return;
        }
        window.setTimeout(poll, 1000);
      };
      poll();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Optimizer request failed";
      setError(message);
      toast.error(message);
      setLoading(false);
    }
  };

  if (!dslJson) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-center h-[400px] rounded-xl border border-dashed border-border bg-card/30"
      >
        <div className="text-center">
          <Dna className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold mb-2">No Strategy Loaded</h3>
          <p className="text-muted-foreground max-w-sm">
            Select a strategy to run the genetic optimizer.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-6">
      <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Dna className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Genetic Optimizer</h3>
            <p className="text-sm text-muted-foreground">Configure GA parameters and search space</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <Label className="text-sm text-muted-foreground">Population Size</Label>
            <Input
              type="number"
              value={gaSettings.population}
              onChange={(e) => setGaSettings({ ...gaSettings, population: Number(e.target.value) })}
              className="mt-1 bg-secondary border-border font-mono"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Generations</Label>
            <Input
              type="number"
              value={gaSettings.generations}
              onChange={(e) => setGaSettings({ ...gaSettings, generations: Number(e.target.value) })}
              className="mt-1 bg-secondary border-border font-mono"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Mutation Rate</Label>
            <Input
              type="number"
              step="0.01"
              value={gaSettings.mutation_rate}
              onChange={(e) => setGaSettings({ ...gaSettings, mutation_rate: Number(e.target.value) })}
              className="mt-1 bg-secondary border-border font-mono"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Crossover Rate</Label>
            <Input
              type="number"
              step="0.01"
              value={gaSettings.crossover_rate}
              onChange={(e) => setGaSettings({ ...gaSettings, crossover_rate: Number(e.target.value) })}
              className="mt-1 bg-secondary border-border font-mono"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Elite Size</Label>
            <Input
              type="number"
              value={gaSettings.elite_size}
              onChange={(e) => setGaSettings({ ...gaSettings, elite_size: Number(e.target.value) })}
              className="mt-1 bg-secondary border-border font-mono"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Initial Balance</Label>
            <Input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              className="mt-1 bg-secondary border-border font-mono"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-primary">{activeParams}</span> parameters selected
            </p>
            <p className="text-xs text-muted-foreground">
              Estimated runs: {estimatedRuns}
            </p>
            <p className="text-xs text-muted-foreground">
              Estimated time: {estimatedTime}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={setAllEnabled}>
            Enable all
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <Button variant="secondary" size="sm" onClick={() => setGroupEnabled("arguments", true)}>
            Enable arguments
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setGroupEnabled("arguments", false)}>
            Disable arguments
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setGroupEnabled("conditions", true)}>
            Enable conditions
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setGroupEnabled("conditions", false)}>
            Disable conditions
          </Button>
        </div>

        <ScrollArea className="h-[340px] pr-4">
          <div className="space-y-4">
            {Object.entries(paramChoices).map(([param, choice]) => (
              <div key={param} className="p-4 rounded-lg bg-secondary/30 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={(choice as any).enabled !== false}
                      onCheckedChange={(checked) => toggleParam(param, Boolean(checked))}
                    />
                    <Label className="font-medium font-mono text-sm">
                      {getDisplayName(param, choice.indicator || null)}
                    </Label>
                  </div>
                  <div className="text-xs text-muted-foreground">Auto search</div>
                </div>

                {(choice as any).enabled !== false && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Start (optional)</Label>
                      <Input
                        type="number"
                        value={choice.start ?? ""}
                        onChange={(e) => handleRangeChange(param, "start", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                        placeholder="auto"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">End (optional)</Label>
                      <Input
                        type="number"
                        value={choice.end ?? ""}
                        onChange={(e) => handleRangeChange(param, "end", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                        placeholder="auto"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Steps (≥2)</Label>
                      <Input
                        type="number"
                        value={choice.steps ?? ""}
                        onChange={(e) => handleRangeChange(param, "steps", Number(e.target.value))}
                        className="h-8 bg-secondary border-border font-mono"
                        placeholder="3"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="mt-4 p-4 rounded-lg bg-secondary/30 border border-border space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="font-mono">
              {completedRuns}/{totalRuns || estimatedRuns} ({progress.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden border border-border">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Estimated Time</span>
            <span className="font-mono">
              {loading
                ? runningEtaSeconds !== null
                  ? `${formatDuration(runningEtaSeconds)} remaining`
                  : `Sampling... ${Math.min(sampledCycleCount, 3)}/3 runs`
                : estimatedTime}
            </span>
          </div>
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Generation Flow</span>
              <span className="font-mono">
                pop {gaSettings.population} × gen {gaSettings.generations}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {generationProgress.map((g, idx) => (
                <div key={idx} className="flex-1 flex items-center gap-1">
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden border border-border">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${(g || 0) * 100}%` }}
                    />
                  </div>
                  {idx < generationProgress.length - 1 && <div className="w-2 h-2 rounded-full bg-border" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <Button className="w-full mt-4" onClick={submit} disabled={loading || activeParams === 0}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running GA...
            </>
          ) : (
            "Run Genetic Optimizer"
          )}
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive">
          Error: {error}
        </div>
      )}

      {result && (
        <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm space-y-6">
          <EvolutionGraph />
          {runErrors && runErrors.length > 0 && (
            <div className="p-3 rounded-lg border border-amber-300/50 bg-amber-100/10 text-amber-600">
              <p className="text-sm font-semibold mb-1">Some runs failed</p>
              <ul className="list-disc ml-4 space-y-1 text-xs">
                {runErrors.slice(0, 3).map((e, i) => (
                  <li key={i} className="font-mono">
                    {JSON.stringify(e.params)} → {e.error}
                  </li>
                ))}
                {runErrors.length > 3 && <li className="font-mono">...and {runErrors.length - 3} more</li>}
              </ul>
            </div>
          )}

          <div className="p-4 rounded-lg bg-success/10 border border-success/30">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="h-5 w-5 text-success" />
              <h4 className="font-semibold text-success">Best Result</h4>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleOpenApply}>
                  Apply Best
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-muted-foreground">Return</p>
                <p className="text-xl font-bold font-mono text-success">
                  {result.best_result.results.pct_change?.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Final Balance</p>
                <p className="text-xl font-bold font-mono">
                  ${result.best_result.results.final_balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trades</p>
                <p className="text-xl font-bold font-mono">
                  {result.best_result.results.num_trades}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2">Optimized Parameters</p>
              <pre className="p-3 rounded bg-secondary/50 text-sm font-mono overflow-x-auto">
                {JSON.stringify(result.best_result.params, null, 2)}
              </pre>
            </div>
          </div>

          <Button variant="ghost" className="w-full" onClick={() => setShowAllResults(!showAllResults)}>
            {showAllResults ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Hide All Results ({result.all_backtests.length})
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                Show All Results ({result.all_backtests.length})
              </>
            )}
          </Button>

          {showAllResults && (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {result.all_backtests.map((backtest, index) => (
                  <div key={index} className="p-3 rounded-lg bg-secondary/30 border border-border flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground font-mono text-sm">#{index + 1}</span>
                      <span className={`font-mono font-semibold ${backtest.results.pct_change >= 0 ? "text-success" : "text-destructive"}`}>
                        {backtest.results.pct_change?.toFixed(2)}%
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground font-mono">
                      ${backtest.results.final_balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply Best Result</DialogTitle>
            <DialogDescription>Apply the GA best DSL to a backtest and save it as a strategy.</DialogDescription>
          </DialogHeader>

          <RadioGroup value={applyMode} onValueChange={(v) => setApplyMode(v as "overwrite" | "new")} className="space-y-2">
            <label className="flex items-center gap-2">
              <RadioGroupItem value="overwrite" />
              <span>Overwrite existing strategy {strategyName ? `(${strategyName})` : "(unsaved)"}</span>
            </label>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="new" />
              <span>Create new strategy</span>
            </label>
          </RadioGroup>

          {(applyMode === "new" || (!strategyId && applyMode === "overwrite")) && (
            <div className="mt-2 space-y-1">
              <Label className="text-sm">Strategy Name</Label>
              <Input value={newStrategyName} onChange={(e) => setNewStrategyName(e.target.value)} placeholder="My Optimized Strategy" />
            </div>
          )}

          {applyError && <p className="text-xs text-destructive">{applyError}</p>}

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setShowApplyDialog(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={handleApplyBest} disabled={applying}>
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default GeneticOptimizer;
