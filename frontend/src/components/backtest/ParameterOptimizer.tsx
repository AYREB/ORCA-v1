import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { 
  Sliders, Loader2, Trophy, ChevronDown, ChevronUp,
  ArrowUpDown, Play, Calculator, Check, Info, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  Table, TableBody, TableCell, TableHead, 
  TableHeader, TableRow 
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { api, OptimizationResult, ParameterChoice, OptimizerJobStatus, BacktestResult, SavedStrategy } from "@/lib/api";


interface ParameterOptimizerProps {
  dslJson: Record<string, unknown> | null;
  strategyId?: number | null;
  strategyName?: string | null;
  onBestApplied?: (result: BacktestResult, strategy?: { id?: number; name: string }) => void;
  onApplyParameters?: (dslJson: Record<string, unknown>) => void;
  onRunBacktest?: (dslJson: Record<string, unknown>) => void;
}

interface ExtractedParameter {
  value: number;
  indicator: string | null;
  displayName: string;
  paramType: string;
}

const BLOCKED_OPTIMIZER_PARAM_NAMES = new Set(["spread"]);

function isOptimizableParameterPath(path: string): boolean {
  const lastSegment = path.replace(/\]/g, "").split(".").pop()?.split("[").pop()?.toLowerCase();
  return !!lastSegment && !BLOCKED_OPTIMIZER_PARAM_NAMES.has(lastSegment);
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

// Extract optimizable parameters from DSL with enhanced display info
function extractOptimizableParameters(
  node: unknown,
  path = "",
  parentIndicator: string | null = null
): Record<string, ExtractedParameter> {
  const params: Record<string, ExtractedParameter> = {};

  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      Object.assign(params, extractOptimizableParameters(item, `${path}[${i}]`, parentIndicator));
    });
  } else if (typeof node === "object" && node !== null) {
    let currentIndicator = parentIndicator;
    const nodeObj = node as Record<string, unknown>;

    if (nodeObj.func && typeof nodeObj.func === "string") {
      currentIndicator = nodeObj.func;
    }

    Object.entries(nodeObj).forEach(([key, value]) => {
      const newPath = path ? `${path}.${key}` : key;

      if (
        typeof value === "number" &&
        isOptimizableParameterPath(newPath) &&
        /period|percent|threshold|offset|value|amount/i.test(key)
      ) {
        params[newPath] = { 
          value, 
          indicator: currentIndicator,
          displayName: getDisplayName(newPath, currentIndicator, key),
          paramType: key.toLowerCase()
        };
      }

      Object.assign(params, extractOptimizableParameters(value, newPath, currentIndicator));
    });
  }

  return params;
}

function getDisplayName(paramPath: string, indicator: string | null, paramType: string): string {
  const cleanParamType = paramType.charAt(0).toUpperCase() + paramType.slice(1);
  
  if (indicator) {
    return `${indicator} ${cleanParamType}`;
  }
  
  // Derive from path
  const parts = paramPath.split(".");
  const side = parts[0]; // LONG or SHORT
  const action = parts[1]?.replace(/\[\d+\]/, ""); // OPEN or CLOSE
  
  return `${side} ${action} - ${cleanParamType}`;
}

function getCleanParamName(rawKey: string): string {
  // Extract meaningful name from full path like "LONG.OPEN[0].arg.period"
  const parts = rawKey.split(".");
  const paramName = parts[parts.length - 1];
  
  // Try to find indicator in the path
  const funcMatch = rawKey.match(/func":"?([A-Z]+)"?/);
  if (funcMatch) {
    return `${funcMatch[1]} ${paramName}`;
  }
  
  // Extract from arg structure
  if (rawKey.includes(".arg.")) {
    const indicatorPart = parts.find(p => p.includes("["));
    if (indicatorPart) {
      return `${indicatorPart.replace(/\[\d+\]/, "")} ${paramName}`;
    }
  }
  
  return paramName.charAt(0).toUpperCase() + paramName.slice(1);
}

const ParameterOptimizer = ({ dslJson, onApplyParameters, onRunBacktest }: ParameterOptimizerProps) => {
  const [paramChoices, setParamChoices] = useState<Record<string, ParameterChoice>>({});
  const [extractedParams, setExtractedParams] = useState<Record<string, ExtractedParameter>>({});
  const [initialBalance, setInitialBalance] = useState(10000);
  const [optimizerResult, setOptimizerResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [sortField, setSortField] = useState<"pct_change" | "final_balance" | "num_trades">("pct_change");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedResultIndex, setSelectedResultIndex] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const [completedRuns, setCompletedRuns] = useState(0);
  const [totalRuns, setTotalRuns] = useState(0);
  const [optimizerStatus, setOptimizerStatus] = useState<OptimizerJobStatus["status"] | "idle">("idle");
  const [sampledCycleCount, setSampledCycleCount] = useState(0);
  const [sampledCycleSeconds, setSampledCycleSeconds] = useState(0);
  const lastCompletedRef = useRef(0);
  const lastSampleTsRef = useRef<number | null>(null);

  // Extract parameters when DSL changes
  useEffect(() => {
    if (dslJson) {
      const params = extractOptimizableParameters(dslJson);
      setExtractedParams(params);
      const initialChoices: Record<string, ParameterChoice> = {};
      Object.entries(params).forEach(([param, info]) => {
        initialChoices[param] = { mode: "nochange", indicator: info.indicator || undefined };
      });
      setParamChoices(initialChoices);
    }
  }, [dslJson]);

  // Group parameters by indicator
  const groupedParams = useMemo(() => {
    const groups: Record<string, Array<[string, ExtractedParameter]>> = {};
    
    Object.entries(extractedParams).forEach(([path, param]) => {
      const groupName = param.indicator || "General";
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push([path, param]);
    });
    
    return groups;
  }, [extractedParams]);

  // Calculate estimated combinations
  const estimatedCombinations = useMemo(() => {
    let total = 1;
    let hasActiveParam = false;
    
    Object.entries(paramChoices).forEach(([_, choice]) => {
      if (choice.mode === "range" && choice.start !== undefined && 
          choice.end !== undefined && choice.steps) {
        total *= choice.steps;
        hasActiveParam = true;
      } else if (choice.mode === "manual" && choice.values && choice.values.length > 0) {
        total *= choice.values.length;
        hasActiveParam = true;
      } else if (choice.mode === "auto") {
        total *= 5; // Auto typically tests ~5 values
        hasActiveParam = true;
      }
    });
    
    return hasActiveParam ? total : 0;
  }, [paramChoices]);

  const estimatedSeconds = useMemo(() => {
    if (estimatedCombinations === 0) return 0;
    return Math.ceil(estimatedCombinations * 1.5);
  }, [estimatedCombinations]);

  const estimatedTime = useMemo(() => {
    return formatDuration(estimatedSeconds);
  }, [estimatedSeconds]);

  const runningEtaSeconds = useMemo(() => {
    if (!loading) return null;

    if (sampledCycleCount < 3 || totalRuns <= 0) return null;
    const avgSecondsPerRun = sampledCycleSeconds / sampledCycleCount;
    const remainingRuns = Math.max(0, totalRuns - completedRuns);
    return Math.max(0, Math.ceil(avgSecondsPerRun * remainingRuns));
  }, [loading, sampledCycleCount, sampledCycleSeconds, totalRuns, completedRuns]);

  // Get range preview values
  const getRangePreview = (choice: ParameterChoice): number[] => {
    if (choice.mode !== "range" || choice.start === undefined || choice.end === undefined || !choice.steps || choice.steps < 2) {
      return [];
    }
    
    const step = (choice.end - choice.start) / (choice.steps - 1);
    return Array.from({ length: Math.min(choice.steps, 10) }, (_, i) => 
      Math.round((choice.start! + step * i) * 100) / 100
    );
  };

  // Sorted results for leaderboard
  const sortedResults = useMemo(() => {
    if (!optimizerResult) return [];
    
    return [...optimizerResult.all_backtests].sort((a, b) => {
      const aVal = a.results[sortField] || 0;
      const bVal = b.results[sortField] || 0;
      return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [optimizerResult, sortField, sortDirection]);

  const handleSort = (field: typeof sortField) => {
    if (field === sortField) {
      setSortDirection(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const handleModeChange = (param: string, mode: ParameterChoice["mode"]) => {
    const currentValue = extractedParams[param]?.value || 0;
    
    setParamChoices((prev) => {
      const current = prev[param] || {};
      const updated = { ...prev };

      if (mode === "manual") {
        updated[param] = { ...current, mode, values: [currentValue] };
      } else if (mode === "range") {
        // Smart defaults based on current value
        const defaultStart = Math.max(1, Math.floor(currentValue * 0.5));
        const defaultEnd = Math.ceil(currentValue * 2);
        updated[param] = { ...current, mode, start: defaultStart, end: defaultEnd, steps: 5 };
      } else if (mode === "auto") {
        updated[param] = { ...current, mode: "auto" };
      } else if (mode === "nochange") {
        updated[param] = { ...current, mode: "nochange" };
      }

      return updated;
    });
  };

  const handleValueChange = (param: string, index: number, value: number) => {
    setParamChoices((prev) => {
      const newValues = [...(prev[param].values || [])];
      newValues[index] = value;
      return { ...prev, [param]: { ...prev[param], values: newValues } };
    });
  };

  const handleRangeChange = (param: string, field: "start" | "end" | "steps", value: number) => {
    setParamChoices((prev) => ({
      ...prev,
      [param]: { ...prev[param], [field]: value },
    }));
  };

  const addManualValue = (param: string) => {
    setParamChoices((prev) => {
      const current = prev[param] || { mode: "manual", values: [] };
      return {
        ...prev,
        [param]: { ...current, values: [...(current.values || []), 0] },
      };
    });
  };

  const removeManualValue = (param: string, index: number) => {
    setParamChoices((prev) => {
      const current = prev[param];
      if (!current || !current.values) return prev;
      const newValues = [...current.values];
      newValues.splice(index, 1);
      return {
        ...prev,
        [param]: { ...current, values: newValues },
      };
    });
  };

    // Get the currently selected result
    const selectedResult = useMemo(() => {
      if (!sortedResults.length) return null;
      return sortedResults[selectedResultIndex] || sortedResults[0];
    }, [sortedResults, selectedResultIndex]);
  

  const handleApplyParameters = () => {
    if (selectedResult?.dsl && onApplyParameters) {
      onApplyParameters(selectedResult.dsl);
      toast.success("Parameters applied to strategy!");
    }
  };

  const handleRunSelectedBacktest = () => {
    if (selectedResult?.dsl && onRunBacktest) {
      onRunBacktest(selectedResult.dsl);
    }
  };

  const handleSelectResult = (index: number) => {
    setSelectedResultIndex(index);
  };

  const submitOptimizer = async () => {
    if (!dslJson) {
      toast.error("No DSL available. Run a backtest first.");
      return;
    }

    setLoading(true);
    setError(null);
    setOptimizerResult(null);
    setVisibleCount(20);
    setProgress(0);
    setCompletedRuns(0);
    setTotalRuns(0);
    setOptimizerStatus("queued");
    setSampledCycleCount(0);
    setSampledCycleSeconds(0);
    lastCompletedRef.current = 0;
    lastSampleTsRef.current = Date.now();

    try {
      const payload: Record<string, ParameterChoice> = {};
      Object.entries(paramChoices).forEach(([param, choice]) => {
        if (!isOptimizableParameterPath(param)) return;
        if (choice.mode !== "nochange") {
          payload[param] = choice;
        }
      });

      if (Object.keys(payload).length === 0) {
        toast.error("Select at least one parameter to optimize");
        setLoading(false);
        setOptimizerStatus("idle");
        return;
      }

      const start = await api.startOptimizeJob(dslJson, payload, initialBalance);
      setTotalRuns(start.total_runs || estimatedCombinations);

      const poll = async () => {
        try {
          const status: OptimizerJobStatus = await api.getOptimizeJobStatus(start.job_id);
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

          setOptimizerStatus(status.status);
          setCompletedRuns(currentCompleted);
          setTotalRuns(status.total_runs || start.total_runs || estimatedCombinations);
          setProgress(status.progress || 0);

          if (status.status === "completed" && status.result) {
            setOptimizerResult(status.result);
            setLoading(false);
            setOptimizerStatus("completed");
            toast.success("Optimization complete!");
            return;
          }

          if (status.status === "error") {
            const statusError = status.error || "Optimizer request failed";
            setError(statusError);
            setLoading(false);
            setOptimizerStatus("error");
            toast.error(statusError);
            return;
          }

          window.setTimeout(poll, 1000);
        } catch (pollErr) {
          const pollErrorMessage = pollErr instanceof Error ? pollErr.message : "Optimizer status polling failed";
          setError(pollErrorMessage);
          setLoading(false);
          setOptimizerStatus("error");
          toast.error(pollErrorMessage);
        }
      };

      poll();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Optimizer request failed";
      setError(errorMessage);
      toast.error(errorMessage);
      setLoading(false);
      setOptimizerStatus("error");
    }
  };

  const activeParams = useMemo(() => {
    return Object.entries(paramChoices).filter(([_, choice]) => choice.mode !== "nochange").length;
  }, [paramChoices]);

  if (!dslJson) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-center h-[400px] rounded-xl border border-dashed border-border bg-card/30"
      >
        <div className="text-center">
          <Sliders className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold mb-2">No Strategy Loaded</h3>
          <p className="text-muted-foreground max-w-sm">
            Run a backtest first to load a strategy, then you can optimize its parameters.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Configuration Panel */}
      <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Sliders className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Parameter Configuration</h3>
            <p className="text-sm text-muted-foreground">
              Select parameters to optimize and configure their ranges
            </p>
          </div>
        </div>

        {/* Initial Balance */}
        <div className="mb-6 p-4 rounded-lg bg-secondary/20 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Initial Balance</Label>
              <p className="text-xs text-muted-foreground">Starting capital for each backtest</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                value={initialBalance}
                onChange={(e) => setInitialBalance(Number(e.target.value))}
                className="w-32 bg-secondary border-border font-mono text-right"
              />
            </div>
          </div>
        </div>

        {/* Grouped Parameters */}
        <ScrollArea className="h-[350px] pr-4">
          <div className="space-y-6">
            {Object.entries(groupedParams).map(([groupName, params]) => (
              <div key={groupName} className="space-y-3">
                {/* Group Header */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-semibold px-3 py-1">
                    <Zap className="h-3 w-3 mr-1" />
                    {groupName}
                  </Badge>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Parameters in group */}
                {params.map(([path, param]) => {
                  const choice = paramChoices[path] || { mode: "nochange" };
                  
                  return (
                    <div
                      key={path}
                      className={`p-4 rounded-lg border transition-colors ${
                        choice.mode !== "nochange" 
                          ? "bg-primary/5 border-primary/30" 
                          : "bg-secondary/30 border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Label className="font-medium text-sm">
                            {param.displayName}
                          </Label>
                          <Badge variant="secondary" className="text-xs font-mono">
                            Current: {param.value}
                          </Badge>
                        </div>
                        <Select
                          value={choice.mode}
                          onValueChange={(value) => handleModeChange(path, value as ParameterChoice["mode"])}
                        >
                          <SelectTrigger className="w-32 h-8 bg-secondary border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="nochange">No Change</SelectItem>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                            <SelectItem value="range">Range</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {choice.mode === "manual" && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {choice.values?.map((val, i) => (
                              <div key={i} className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={val}
                                  onChange={(e) => handleValueChange(path, i, Number(e.target.value))}
                                  className="w-20 h-8 bg-secondary border-border font-mono text-center"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeManualValue(path, i)}
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                >
                                  ×
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addManualValue(path)}
                              className="h-8 px-3"
                            >
                              + Add
                            </Button>
                          </div>
                        </div>
                      )}

                      {choice.mode === "range" && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <Label className="text-xs text-muted-foreground">Start</Label>
                              <Input
                                type="number"
                                value={choice.start || 0}
                                onChange={(e) => handleRangeChange(path, "start", Number(e.target.value))}
                                className="h-8 bg-secondary border-border font-mono"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">End</Label>
                              <Input
                                type="number"
                                value={choice.end || 0}
                                onChange={(e) => handleRangeChange(path, "end", Number(e.target.value))}
                                className="h-8 bg-secondary border-border font-mono"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Steps</Label>
                              <Input
                                type="number"
                                value={choice.steps || 0}
                                onChange={(e) => handleRangeChange(path, "steps", Number(e.target.value))}
                                className="h-8 bg-secondary border-border font-mono"
                              />
                            </div>
                          </div>
                          
                          {/* Range Preview Chips */}
                          {getRangePreview(choice).length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Will test:</span>
                              {getRangePreview(choice).map((val, i) => (
                                <Badge key={i} variant="secondary" className="text-xs font-mono px-2 py-0.5">
                                  {val}
                                </Badge>
                              ))}
                              {choice.steps && choice.steps > 10 && (
                                <span className="text-xs text-muted-foreground">
                                  +{choice.steps - 10} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {choice.mode === "auto" && (
                        <p className="text-xs text-muted-foreground">
                          Will automatically determine optimal range based on current value
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Estimation Panel */}
        <div className="mt-6 p-4 rounded-lg bg-secondary/30 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Optimization Preview</span>
          </div>
          
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold font-mono text-primary">
                {activeParams}
              </p>
              <p className="text-xs text-muted-foreground">Parameters</p>
            </div>
            <div>
              <p className="text-2xl font-bold font-mono">
                {estimatedCombinations > 0 ? estimatedCombinations.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Combinations</p>
            </div>
            <div>
              <p className="text-2xl font-bold font-mono">
                {estimatedTime}
              </p>
              <p className="text-xs text-muted-foreground">Est. Time</p>
            </div>
          </div>
        </div>

        {/* Progress Panel */}
        <div className="mt-4 p-4 rounded-lg bg-secondary/30 border border-border space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="font-mono">
              {completedRuns}/{totalRuns || estimatedCombinations || "—"} ({progress.toFixed(0)}%)
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
        </div>

        {/* Run Button */}
        <div className="mt-6">
          <Button
            className="w-full h-12"
            variant="hero"
            onClick={submitOptimizer}
            disabled={loading || activeParams === 0}
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                {optimizerStatus === "queued" ? "Queued..." : `Running Optimizer... ${progress.toFixed(0)}%`}
              </>
            ) : (
              <>
                <Play className="h-5 w-5 mr-2" />
                Run Optimizer
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive">
          Error: {error}
        </div>
      )}

       {/* Results Section */}
      {optimizerResult && (
        <div className="space-y-6">
          {/* Selected Result Detail Card */}
          {selectedResult && (
            <motion.div
              key={selectedResultIndex}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`p-6 rounded-xl border-2 ${
                selectedResultIndex === 0 
                  ? "border-success/50 bg-gradient-to-br from-success/5 to-success/10"
                  : "border-primary/50 bg-gradient-to-br from-primary/5 to-primary/10"
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {selectedResultIndex === 0 ? (
                    <>
                      <Trophy className="h-6 w-6 text-success" />
                      <span className="text-lg font-bold text-success">Best Performer</span>
                    </>
                  ) : (
                    <>
                      <Sliders className="h-6 w-6 text-primary" />
                      <span className="text-lg font-bold text-primary">Result #{selectedResultIndex + 1}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedResultIndex(Math.max(0, selectedResultIndex - 1))}
                    disabled={selectedResultIndex === 0}
                    className="h-8 w-8 p-0"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Badge variant="outline" className="font-mono">
                    #{selectedResultIndex + 1} of {sortedResults.length}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedResultIndex(Math.min(sortedResults.length - 1, selectedResultIndex + 1))}
                    disabled={selectedResultIndex === sortedResults.length - 1}
                    className="h-8 w-8 p-0"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-3 rounded-lg bg-background/50">
                  <p className={`text-2xl font-bold font-mono ${
                    (selectedResult.results.pct_change || 0) >= 0 
                      ? "text-success" 
                      : "text-destructive"
                  }`}>
                    {(selectedResult.results.pct_change || 0) >= 0 ? "+" : ""}
                    {selectedResult.results.pct_change?.toFixed(2)}%
                  </p>
                  <p className="text-xs text-muted-foreground">Return</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-background/50">
                  <p className="text-2xl font-bold font-mono">
                    ${selectedResult.results.final_balance?.toLocaleString(undefined, { 
                      minimumFractionDigits: 0, 
                      maximumFractionDigits: 0 
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">Final Balance</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-background/50">
                  <p className="text-2xl font-bold font-mono">
                    {selectedResult.results.num_trades}
                  </p>
                  <p className="text-xs text-muted-foreground">Trades</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-background/50">
                  <p className="text-2xl font-bold font-mono text-primary">
                    {((selectedResult.results.final_balance || 0) / initialBalance * 100 - 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">vs Initial</p>
                </div>
              </div>
              
              {/* Optimized Parameters */}
              <div className="mb-6">
                <p className="text-sm font-medium mb-2">Parameters</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(selectedResult.params).map(([key, value]) => (
                    <Badge key={key} className="font-mono text-sm px-3 py-1.5 bg-primary/20 text-primary border-primary/30">
                      {getCleanParamName(key)}: {value}
                    </Badge>
                  ))}
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1" 
                  onClick={handleApplyParameters}
                  disabled={!onApplyParameters}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Apply to Strategy
                </Button>
                <Button 
                  variant="hero" 
                  className="flex-1" 
                  onClick={handleRunSelectedBacktest}
                  disabled={!onRunBacktest}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Run Full Backtest
                </Button>
              </div>
            </motion.div>
          )}

          {/* Results Leaderboard Table */}
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="rounded-xl border border-border overflow-hidden"
          >
            <div className="p-4 bg-muted/30 border-b border-border">
              <h4 className="font-semibold">All Results ({sortedResults.length})</h4>
              <p className="text-sm text-muted-foreground">Click a row to view details</p>
            </div>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableHead className="w-16 sticky top-0 bg-muted/20">Rank</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:text-primary transition-colors sticky top-0 bg-muted/20"
                      onClick={() => handleSort("pct_change")}
                    >
                      <div className="flex items-center gap-1">
                        Return
                        <ArrowUpDown className="h-3 w-3" />
                        {sortField === "pct_change" && (
                          <span className="text-primary">{sortDirection === "desc" ? "↓" : "↑"}</span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:text-primary transition-colors sticky top-0 bg-muted/20"
                      onClick={() => handleSort("final_balance")}
                    >
                      <div className="flex items-center gap-1">
                        Final Balance
                        <ArrowUpDown className="h-3 w-3" />
                        {sortField === "final_balance" && (
                          <span className="text-primary">{sortDirection === "desc" ? "↓" : "↑"}</span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:text-primary transition-colors sticky top-0 bg-muted/20"
                      onClick={() => handleSort("num_trades")}
                    >
                      <div className="flex items-center gap-1">
                        Trades
                        <ArrowUpDown className="h-3 w-3" />
                        {sortField === "num_trades" && (
                          <span className="text-primary">{sortDirection === "desc" ? "↓" : "↑"}</span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead className="sticky top-0 bg-muted/20">Parameters</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedResults.slice(0, visibleCount).map((result, index) => (
                    <TableRow 
                      key={index}
                      className={`cursor-pointer transition-colors ${
                        index === selectedResultIndex 
                          ? "bg-primary/10 border-l-2 border-l-primary" 
                          : index === 0 && sortField === "pct_change" && sortDirection === "desc"
                            ? "bg-success/5 hover:bg-success/10"
                            : "hover:bg-muted/50"
                      }`}
                      onClick={() => handleSelectResult(index)}
                    >
                      <TableCell className="font-mono font-bold">
                        {index === 0 && sortField === "pct_change" && sortDirection === "desc" && (
                          <Trophy className="h-4 w-4 inline mr-1 text-success" />
                        )}
                        #{index + 1}
                      </TableCell>
                      <TableCell className={`font-mono font-semibold ${
                        (result.results.pct_change || 0) >= 0 ? "text-success" : "text-destructive"
                      }`}>
                        {(result.results.pct_change || 0) >= 0 ? "+" : ""}
                        {result.results.pct_change?.toFixed(2)}%
                      </TableCell>
                      <TableCell className="font-mono">
                        ${result.results.final_balance?.toLocaleString(undefined, { 
                          minimumFractionDigits: 0, 
                          maximumFractionDigits: 0 
                        })}
                      </TableCell>
                      <TableCell className="font-mono">
                        {result.results.num_trades}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {Object.entries(result.params).slice(0, 3).map(([k, v]) => (
                            <Badge 
                              key={k} 
                              variant="secondary" 
                              className="text-xs font-mono px-1.5 py-0"
                            >
                              {getCleanParamName(k).split(' ').pop()}: {v}
                            </Badge>
                          ))}
                          {Object.keys(result.params).length > 3 && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">
                              +{Object.keys(result.params).length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            
            {/* Load More Button */}
            {visibleCount < sortedResults.length && (
              <div className="p-4 text-center border-t border-border">
                <Button 
                  variant="ghost" 
                  onClick={() => setVisibleCount(prev => prev + 20)}
                >
                  Load More ({sortedResults.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};

export default ParameterOptimizer;
