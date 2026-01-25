import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Play, Settings2, TrendingUp, Calendar, Clock, Plus, X, 
  ChevronDown, Zap, Target, ArrowUpCircle, ArrowDownCircle,
  Activity, BarChart3, Save, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface BacktestFormProps {
  onRunBacktest: (results: any) => void;
  initialDslJson?: Record<string, any> | null;
  onDslChange?: (dslJson: Record<string, any>, dslText: string) => void;
  showActions?: boolean;
}

interface ConditionSideOperation {
  operator: "+" | "-" | "*" | "/";
  operand: number;
}

interface ConditionSide {
  type: "value" | "indicator";
  value: number;
  func: string;
  args: Record<string, any>;
  operation?: ConditionSideOperation;
}

interface SingleCondition {
  id: string;
  left: ConditionSide;
  operator: string;
  right: ConditionSide;
  nextLogicalOperator: "AND" | "OR"; // Connects to next condition
}

interface ConditionGroup {
  conditions: SingleCondition[];
}

interface Registry {
  commands: { COMMANDS: Record<string, any> };
  indicators: { INDICATORS: Record<string, { args: string[]; defaults: Record<string, any> }> };
  arguments: { ARGUMENTS: Record<string, Record<string, Record<string, any>>> };
}

const generateId = () => Math.random().toString(36).substring(2, 9);

const createDefaultCondition = (): SingleCondition => ({
  id: generateId(),
  left: { type: "indicator", value: 0, func: "RSI", args: { period: 14, timeframe: "1h", offset: 0 }, operation: undefined },
  operator: "<",
  right: { type: "value", value: 30, func: "", args: {}, operation: undefined },
  nextLogicalOperator: "AND",
});

const BacktestForm = ({ onRunBacktest, initialDslJson = null, onDslChange, showActions = true }: BacktestFormProps) => {
  const [loading, setLoading] = useState(false);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [strategyName, setStrategyName] = useState("");
  
  // Form state
  const [tickers, setTickers] = useState<string[]>(["AAPL"]);
  const [executionTF, setExecutionTF] = useState("1h");
  const [dateStart, setDateStart] = useState("2024-01-01");
  const [dateEnd, setDateEnd] = useState("2025-01-01");
  const [side, setSide] = useState("LONG");
  const [blocks, setBlocks] = useState<Record<string, Record<string, { ARGUMENTS: Record<string, any> }>>>({
    LONG: {},
    SHORT: {},
  });
  const { user } = useAuth();
  // Trade settings state (separate from strategy blocks)
  const [takeProfitPercent, setTakeProfitPercent] = useState(10);
  const [stopLossPercent, setStopLossPercent] = useState(6);
  const [spread, setSpread] = useState(0.001);
  const [tradeSettingsOpen, setTradeSettingsOpen] = useState(false);
  
  // Multi-condition state
  const [conditionGroups, setConditionGroups] = useState<Record<string, ConditionGroup>>({
    OPEN: { conditions: [] },
    CLOSE: { conditions: [] },
  });

  const lastHydratedKey = useRef<string | null>(null);

  // Keep parent consumers in sync with current DSL while editing
  useEffect(() => {
    if (!onDslChange) return;
    const dsl = buildJsonDsl();
    onDslChange(dsl, JSON.stringify(dsl, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers,  executionTF, dateStart, dateEnd, blocks, conditionGroups, side]);

  // Hydrate form from an existing DSL JSON
  useEffect(() => {
    if (!initialDslJson || Object.keys(initialDslJson).length === 0) return;

    const hydrateKey = JSON.stringify(initialDslJson);
    if (hydrateKey === lastHydratedKey.current) return;
    lastHydratedKey.current = hydrateKey;

    const sideKey = Object.keys(initialDslJson)[0] as "LONG" | "SHORT";
    const sideData = initialDslJson[sideKey];
    if (!sideData) return;

    setSide(sideKey);

    const context = sideData.context || {};
    setTickers(context.tickers || ["AAPL"]);
    setExecutionTF(context.execution_timeframe || "");
    setDateStart(context.dateframe?.start || "2024-01-01");
    setDateEnd(context.dateframe?.end || "2025-01-01");

    const newBlocks: Record<string, { ARGUMENTS: Record<string, any> }> = {};
    const newConditionGroups: Record<string, ConditionGroup> = {};

    const parseSideValue = (val: any): ConditionSide => {
      if (val && typeof val === "object" && "value" in val) {
        return { type: "value", value: val.value, func: "", args: {} };
      }
      return {
        type: "indicator",
        func: val?.func || "",
        value: 0,
        args: val?.arg || {},
      };
    };

    const parseConditions = (obj: any): SingleCondition[] => {
      if (!obj || Object.keys(obj).length === 0) return [];

      const groups: any[] = [];

      if (obj.OR) {
        groups.push(...obj.OR);
      } else {
        groups.push(obj);
      }

      const all: SingleCondition[] = [];

      groups.forEach((group, groupIdx) => {
        const conditionsArray = group.AND
          ? group.AND
          : group.left
            ? [group]
            : [];

        conditionsArray.forEach((cond: any, idx: number) => {
          const isLastInGroup = idx === conditionsArray.length - 1;
          const hasMoreGroups = groupIdx < groups.length - 1;

          all.push({
            id: generateId(),
            left: parseSideValue(cond.left),
            operator: cond.operator || "==",
            right: parseSideValue(cond.right),
            nextLogicalOperator: !isLastInGroup ? "AND" : hasMoreGroups ? "OR" : "AND",
          });
        });
      });

      return all;
    };

    Object.entries(sideData).forEach(([blockName, blockData]) => {
      if (blockName === "context") return;
      const typedBlock = blockData as any;
      newBlocks[blockName] = { ARGUMENTS: typedBlock.ARGUMENTS || {} };
      newConditionGroups[blockName] = {
        conditions: parseConditions(typedBlock.CONDITIONS || {}),
      };
    });

    setBlocks((prev) => ({ ...prev, [sideKey]: newBlocks }));
    setConditionGroups((prev) => ({ ...prev, ...newConditionGroups }));
  }, [initialDslJson]);

  // Fetch registry on mount
  useEffect(() => {
    const fetchRegistry = async () => {
      try {
        const data = await api.getRegistry();
        setRegistry(data as unknown as Registry);
      } catch (err) {
        console.error("Failed to fetch registry:", err);
        setRegistry({
          commands: { COMMANDS: { LONG: {}, SHORT: {} } },
          indicators: {
            INDICATORS: {
              PRICE: { args: ["field", "offset"], defaults: { field: "close", offset: 0 } },
              VOLUME: { args: ["offset"], defaults: { offset: 0 } },
              SMA: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
              EMA: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
              RSI: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
              MACD: { args: ["fast", "slow", "signal", "timeframe", "offset"], defaults: { fast: 12, slow: 26, signal: 9, timeframe: "1h", offset: 0 } },
              BBANDS: { args: ["period", "stddev", "timeframe", "offset"], defaults: { period: 20, stddev: 2, timeframe: "1h", offset: 0 } },
              ATR: { args: ["period", "timeframe", "offset"], defaults: { period: 14, timeframe: "1h", offset: 0 } },
              STOCH: { args: ["k_period", "d_period", "timeframe", "offset"], defaults: { k_period: 14, d_period: 3, timeframe: "1h", offset: 0 } },
              CCI: { args: ["period", "timeframe", "offset"], defaults: { period: 20, timeframe: "1h", offset: 0 } },
              OBV: { args: ["timeframe", "offset"], defaults: { timeframe: "1h", offset: 0 } },
            },
          },
          arguments: {
            ARGUMENTS: {
              LONG: {
                OPEN: {
                  initialOpenPositionInvestType: { default: "percentCashBalance", options: ["percentCashBalance", "fixedAmount"] },
                  initialOpenPositionInvestAmount: { default: 0.1 },
                  recurring: { default: false },
                  stopLossPercent: { default: 6 },
                  takeProfitPercent: { default: 10 },
                  recurringPeriod: { default: 5 },
                  recurringInvestType: { default: "percentCashBalance", options: ["percentCashBalance", "fixedAmount"] },
                  recurringInvestAmount: { default: 0.1 },
                  maxRecurringCount: { default: 0 },
                },
                CLOSE: {},
              },
              SHORT: { OPEN: {}, CLOSE: {} },
            },
          },
        });
      }
    };
    fetchRegistry();
  }, []);

  const addTicker = () => setTickers([...tickers, ""]);
  const removeTicker = (index: number) => setTickers(tickers.filter((_, i) => i !== index));
  const updateTicker = (index: number, value: string) => {
    const updated = [...tickers];
    updated[index] = value.toUpperCase();
    setTickers(updated);
  };

  const addBlock = (blockName: string) => {
    setBlocks({
      ...blocks,
      [side]: {
        ...blocks[side],
        [blockName]: { ARGUMENTS: {} },
      },
    });
    setConditionGroups({
      ...conditionGroups,
      [blockName]: { conditions: [] },
    });
  };

  const removeBlock = (blockName: string) => {
    const updated = { ...blocks[side] };
    delete updated[blockName];
    setBlocks({ ...blocks, [side]: updated });
  };

  const updateArgument = (block: string, arg: string, value: any) => {
    setBlocks({
      ...blocks,
      [side]: {
        ...blocks[side],
        [block]: {
          ...blocks[side][block],
          ARGUMENTS: { ...blocks[side][block].ARGUMENTS, [arg]: value },
        },
      },
    });
  };

  // Build JSON DSL from form state
  const buildJsonDsl = () => {
    const buildSide = (side: ConditionSide): any => {
      let base: any;
      if (side.type === "indicator") {
        base = { func: side.func, arg: side.args };
      } else {
        base = { value: side.value };
      }
      
      // Wrap with operation if present
      if (side.operation && side.operation.operand !== undefined) {
        return {
          op: side.operation.operator,
          left: base,
          right: { value: side.operation.operand }
        };
      }
      
      return base;
    };

    const buildConditions = (group: ConditionGroup): any => {
      const conditions = group.conditions;
      if (conditions.length === 0) return {};
      
      if (conditions.length === 1) {
        const cond = conditions[0];
        return {
          left: buildSide(cond.left),
          operator: cond.operator,
          right: buildSide(cond.right),
        };
      }
      
      // Group consecutive ANDs together, then OR the groups
      // Example: A AND B OR C AND D = (A AND B) OR (C AND D)
      const orGroups: SingleCondition[][] = [];
      let currentAndGroup: SingleCondition[] = [conditions[0]];
      
      for (let i = 0; i < conditions.length - 1; i++) {
        const cond = conditions[i];
        const nextCond = conditions[i + 1];
        
        if (cond.nextLogicalOperator === "AND") {
          currentAndGroup.push(nextCond);
        } else {
          // OR - start new group
          orGroups.push(currentAndGroup);
          currentAndGroup = [nextCond];
        }
      }
      orGroups.push(currentAndGroup); // Push the last group
      
      // Build DSL from groups
      const buildGroup = (grp: SingleCondition[]) => {
        if (grp.length === 1) {
          return {
            left: buildSide(grp[0].left),
            operator: grp[0].operator,
            right: buildSide(grp[0].right),
          };
        }
        return {
          AND: grp.map(cond => ({
            left: buildSide(cond.left),
            operator: cond.operator,
            right: buildSide(cond.right),
          })),
        };
      };
      
      if (orGroups.length === 1) {
        return buildGroup(orGroups[0]);
      }
      
      return {
        OR: orGroups.map(buildGroup),
      };
    };

    const dsl: any = {
      [side]: {
        context: {
          tickers: tickers.filter(Boolean),
          execution_timeframe: executionTF,
          dateframe: { start: dateStart, end: dateEnd },
        },
      },
    };

    Object.entries(blocks[side]).forEach(([blockName, blockData]) => {
      const args = { ...blockData.ARGUMENTS };
      
      // Inject trade settings into OPEN block's ARGUMENTS
      if (blockName === "OPEN") {
        args.takeProfitPercent = takeProfitPercent;
        args.stopLossPercent = stopLossPercent;
        args.spread = spread;
      }
      
      dsl[side][blockName] = {
        CONDITIONS: buildConditions(conditionGroups[blockName] || { conditions: [] }),
        ARGUMENTS: args,
      };
    });

    return dsl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payloadDsl = buildJsonDsl();
      console.log("DSL JSON:", JSON.stringify(payloadDsl, null, 2));
      
      const results = await api.backtestDSLJSON(payloadDsl);
      toast.success("Backtest completed!");
      onRunBacktest(results);
    } catch (err: any) {
      toast.error(err?.message || "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStrategy = async () => {
    if (!user) {
      toast.error("Please log in to save strategies");
      return;
    }

    if (!strategyName.trim()) {
      toast.error("Please enter a strategy name");
      return;
    }
    const dsl = buildJsonDsl();
    onDslChange?.(dsl, JSON.stringify(dsl, null, 2));

    try {
      await api.createStrategy({
        name: strategyName.trim(),
        dsl: JSON.stringify(dsl, null, 2),
        dslJson: dsl,
      });
    toast.success(`Strategy "${strategyName}" saved!`);
    setShowSaveDialog(false);
    setStrategyName("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save strategy";
      toast.error(message);
    }
  };

  if (!registry) {
    return (
      <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
        <div className="animate-pulse text-muted-foreground">Loading registry...</div>
      </div>
    );
  }

  const blockNames = Object.keys(blocks[side] || {});
  const allowedArgs = registry.arguments?.ARGUMENTS?.[side] || {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
        <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20">
          <Settings2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Strategy Builder</h3>
          <p className="text-sm text-muted-foreground">Build your trading strategy visually</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Context Section */}
        <div className="p-5 rounded-xl border border-border bg-card/30 space-y-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Market Context</span>
          </div>
          
          {/* Tickers */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              Tickers
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Stock symbols to backtest (e.g., AAPL, MSFT, GOOGL)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <div className="flex flex-wrap gap-2">
              {tickers.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-secondary/50 rounded-lg border border-border/50 px-2 py-1">
                  <Input
                    value={t}
                    onChange={(e) => updateTicker(i, e.target.value)}
                    placeholder="AAPL"
                    className="w-20 h-7 bg-transparent border-0 p-0 font-mono text-sm focus-visible:ring-0"
                  />
                  {i > 0 && (
                    <button type="button" onClick={() => removeTicker(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={addTicker} className="h-9 px-3 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Execution Timeframe
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">The timeframe used to evaluate entry/exit signals</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Select value={executionTF} onValueChange={setExecutionTF}>
              <SelectTrigger className="bg-secondary/50 border-border/50 h-9 w-full max-w-[200px]">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                  <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              Date Range
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Select a preset or choose custom dates for backtesting</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            
            {/* Date Presets */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Last 1M", months: 1 },
                { label: "Last 3M", months: 3 },
                { label: "Last 6M", months: 6 },
                { label: "Last 1Y", months: 12 },
                { label: "Last 2Y", months: 24 },
                { label: "Last 5Y", months: 60 },
              ].map((preset) => {
                const presetEnd = new Date();
                const presetStart = new Date();
                presetStart.setMonth(presetStart.getMonth() - preset.months);
                const presetStartStr = presetStart.toISOString().split('T')[0];
                const presetEndStr = presetEnd.toISOString().split('T')[0];
                const isActive = dateStart === presetStartStr && dateEnd === presetEndStr;
                
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setDateStart(presetStartStr);
                      setDateEnd(presetEndStr);
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      isActive
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-secondary/30 border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            
            {/* Custom Date Inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Start Date</Label>
                <Input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="bg-secondary/50 border-border/50 h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">End Date</Label>
                <Input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="bg-secondary/50 border-border/50 h-9"
                />
              </div>
            </div>
          </div>

          {/* Side */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              Position Side
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">LONG profits when price rises, SHORT profits when price falls</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <div className="flex gap-2">
              {Object.keys(registry.commands.COMMANDS).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all ${
                    side === s
                      ? s === "LONG" 
                        ? "bg-success/10 border-success/40 text-success"
                        : "bg-destructive/10 border-destructive/40 text-destructive"
                      : "bg-secondary/30 border-border/50 text-muted-foreground hover:border-border"
                  }`}
                >
                  {s === "LONG" ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Trade Settings Section - Collapsible */}
        <Collapsible open={tradeSettingsOpen} onOpenChange={setTradeSettingsOpen}>
          <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between w-full p-4 hover:bg-secondary/20 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">Trade Settings</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-sm">
                          Configure take-profit, stop-loss, and spread settings for all positions.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {!tradeSettingsOpen && (
                    <span className="text-xs text-muted-foreground ml-2">
                      TP: {takeProfitPercent}% | SL: {stopLossPercent}% | Spread: {spread}
                    </span>
                  )}
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${tradeSettingsOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-4 border-t border-border/50">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                      <ArrowUpCircle className="h-3.5 w-3.5 text-success" />
                      Take Profit (%)
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Price increase % to automatically close for profit</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={takeProfitPercent}
                      onChange={(e) => setTakeProfitPercent(parseFloat(e.target.value) || 0)}
                      className="bg-secondary/50 border-border/50 h-9"
                      placeholder="10"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                      <ArrowDownCircle className="h-3.5 w-3.5 text-destructive" />
                      Stop Loss (%)
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Price decrease % to automatically close to limit loss</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={stopLossPercent}
                      onChange={(e) => setStopLossPercent(parseFloat(e.target.value) || 0)}
                      className="bg-secondary/50 border-border/50 h-9"
                      placeholder="6"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                      <Activity className="h-3.5 w-3.5 text-warning" />
                      Spread
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Bid-ask spread cost applied to each trade</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={spread}
                      onChange={(e) => setSpread(parseFloat(e.target.value) || 0)}
                      className="bg-secondary/50 border-border/50 h-9"
                      placeholder="0.001"
                    />
                  </div>
                </div>
                
                <p className="text-xs text-muted-foreground">
                  Risk/Reward Ratio: <span className="font-mono font-medium text-foreground">{stopLossPercent > 0 ? (takeProfitPercent / stopLossPercent).toFixed(2) : "∞"}</span>
                </p>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* Strategy Blocks */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Strategy Blocks</span>
            </div>
            <div className="flex gap-2">
              {["OPEN", "CLOSE"].map((b) =>
                !blocks[side][b] ? (
                  <Button key={b} type="button" variant="outline" size="sm" onClick={() => addBlock(b)} className="h-8 text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1" /> {b}
                  </Button>
                ) : null
              )}
            </div>
          </div>

          <AnimatePresence mode="popLayout">
            {blockNames.map((block) => (
              <motion.div
                key={block}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`rounded-xl border-2 overflow-hidden ${
                  block === "OPEN" 
                    ? "border-success/30 bg-success/5" 
                    : "border-destructive/30 bg-destructive/5"
                }`}
              >
                {/* Block Header */}
                <div className={`flex items-center justify-between px-4 py-3 ${
                  block === "OPEN" ? "bg-success/10" : "bg-destructive/10"
                }`}>
                  <div className="flex items-center gap-2">
                    {block === "OPEN" ? (
                      <Target className={`h-4 w-4 text-success`} />
                    ) : (
                      <Activity className={`h-4 w-4 text-destructive`} />
                    )}
                    <span className={`font-semibold text-sm ${
                      block === "OPEN" ? "text-success" : "text-destructive"
                    }`}>
                      {block} Position
                    </span>
                  </div>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => removeBlock(block)}
                    className="h-7 w-7 p-0 hover:bg-destructive/20 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Conditions */}
                  <MultiConditionBuilder
                    blockName={block}
                    conditionGroup={conditionGroups[block]}
                    setConditionGroup={(group) => setConditionGroups({ ...conditionGroups, [block]: group })}
                    registry={registry}
                  />

                  {/* Arguments */}
                  {Object.keys(allowedArgs[block] || {}).length > 0 && (
                    <div className="space-y-3 pt-3 border-t border-border/30">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Parameters</Label>
                      <ArgumentSelector
                        block={block}
                        availableArgs={allowedArgs[block] || {}}
                        currentArgs={blocks[side][block]?.ARGUMENTS || {}}
                        onChange={(arg, val) => updateArgument(block, arg, val)}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {blockNames.length === 0 && (
            <div className="p-8 rounded-xl border border-dashed border-border/50 bg-secondary/20 text-center">
              <p className="text-muted-foreground text-sm">Add OPEN and CLOSE blocks to define your strategy</p>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="flex-1 h-12">
                <Save className="h-5 w-5 mr-2" />
                Save Strategy
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save Strategy</DialogTitle>
                <DialogDescription>
                  Give your strategy a name to save it for later use.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="strategyName">Strategy Name</Label>
                  <Input
                    id="strategyName"
                    value={strategyName}
                    onChange={(e) => setStrategyName(e.target.value)}
                    placeholder="My RSI Strategy"
                    className="bg-secondary border-border"
                  />
                </div>
                <Button onClick={handleSaveStrategy} className="w-full">
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button type="submit" variant="hero" className="flex-1 h-12" disabled={loading}>
            <Play className="h-5 w-5" />
            {loading ? "Running Backtest..." : "Run Backtest"}
          </Button>
        </div>
      </form>
    </motion.div>
  );
};

// Compute visual groups for display (AND groups connected by OR)
const computeVisualGroups = (conditions: SingleCondition[]): SingleCondition[][] => {
  if (conditions.length === 0) return [];
  
  const groups: SingleCondition[][] = [];
  let currentGroup: SingleCondition[] = [conditions[0]];
  
  for (let i = 0; i < conditions.length - 1; i++) {
    if (conditions[i].nextLogicalOperator === "AND") {
      currentGroup.push(conditions[i + 1]);
    } else {
      groups.push(currentGroup);
      currentGroup = [conditions[i + 1]];
    }
  }
  groups.push(currentGroup);
  
  return groups;
};

// Generate human-readable logic preview
const generateLogicPreview = (conditions: SingleCondition[]): string => {
  if (conditions.length === 0) return "";
  
  const groups = computeVisualGroups(conditions);
  
  const formatSideLabel = (side: ConditionSide): string => {
    let base: string;
    if (side.type === "indicator") {
      const mainArg = side.args.period || side.args.field || "";
      base = `${side.func}${mainArg ? `(${mainArg})` : ""}`;
    } else {
      base = String(side.value);
    }
    
    if (side.operation && side.operation.operand !== undefined) {
      base = `${base} ${side.operation.operator} ${side.operation.operand}`;
    }
    
    return base;
  };
  
  const groupStrings = groups.map((group) => {
    const conditionStrings = group.map((cond) => {
      return `${formatSideLabel(cond.left)} ${cond.operator} ${formatSideLabel(cond.right)}`;
    });
    
    const joined = conditionStrings.join(" AND ");
    return group.length > 1 ? `(${joined})` : joined;
  });
  
  return groupStrings.join(" OR ");
};

// Multi-Condition Builder Component
function MultiConditionBuilder({
  blockName,
  conditionGroup,
  setConditionGroup,
  registry,
}: {
  blockName: string;
  conditionGroup: ConditionGroup;
  setConditionGroup: (group: ConditionGroup) => void;
  registry: Registry;
}) {
  const addCondition = () => {
    setConditionGroup({
      conditions: [...conditionGroup.conditions, createDefaultCondition()],
    });
  };

  const updateCondition = (id: string, updated: SingleCondition) => {
    setConditionGroup({
      conditions: conditionGroup.conditions.map(c => c.id === id ? updated : c),
    });
  };

  const removeCondition = (id: string) => {
    setConditionGroup({
      conditions: conditionGroup.conditions.filter(c => c.id !== id),
    });
  };

  const toggleConditionOperator = (conditionId: string) => {
    setConditionGroup({
      conditions: conditionGroup.conditions.map(c => 
        c.id === conditionId 
          ? { ...c, nextLogicalOperator: c.nextLogicalOperator === "AND" ? "OR" : "AND" }
          : c
      ),
    });
  };

  const isOpen = blockName === "OPEN";
  const visualGroups = computeVisualGroups(conditionGroup.conditions);
  const logicPreview = generateLogicPreview(conditionGroup.conditions);

  // Find the original index of a condition for toggling
  const getOriginalIndex = (cond: SingleCondition) => {
    return conditionGroup.conditions.findIndex(c => c.id === cond.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Conditions</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">
                <strong>AND</strong> conditions are grouped together and evaluated first. 
                <strong> OR</strong> connects these groups.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Example: A AND B OR C = (A AND B) OR C
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {visualGroups.map((group, groupIndex) => (
            <motion.div
              key={`group-${groupIndex}-${group[0]?.id}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {/* Visual Group Box */}
              <div className={`relative rounded-lg p-3 ${
                visualGroups.length > 1 
                  ? "border border-primary/30 bg-primary/5" 
                  : ""
              }`}>
                {/* Group Label */}
                {visualGroups.length > 1 && (
                  <span className="absolute -top-2 left-3 text-[10px] bg-card px-1.5 text-muted-foreground font-medium">
                    Group {groupIndex + 1}
                  </span>
                )}
                
                <div className="space-y-2">
                  {group.map((cond, indexInGroup) => {
                    const originalIndex = getOriginalIndex(cond);
                    const isLastInGroup = indexInGroup === group.length - 1;
                    const isLastConditionOverall = originalIndex === conditionGroup.conditions.length - 1;
                    
                    return (
                      <div key={cond.id}>
                        <ConditionRow
                          condition={cond}
                          onChange={(updated) => updateCondition(cond.id, updated)}
                          onRemove={() => removeCondition(cond.id)}
                          registry={registry}
                          accentColor={isOpen ? "success" : "destructive"}
                        />
                        
                        {/* AND toggle within group (not for last in group) */}
                        {!isLastInGroup && (
                          <div className="flex items-center justify-center py-2">
                            <div className="flex-1 h-px bg-primary/20" />
                            <button
                              type="button"
                              onClick={() => toggleConditionOperator(cond.id)}
                              className="mx-3 px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer hover:scale-105 bg-primary/20 text-primary border border-primary/30"
                            >
                              AND
                            </button>
                            <div className="flex-1 h-px bg-primary/20" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* OR separator between groups */}
              {groupIndex < visualGroups.length - 1 && (
                <div className="flex items-center justify-center py-3">
                  <div className="flex-1 h-0.5 bg-warning/30" />
                  <button
                    type="button"
                    onClick={() => {
                      // Toggle the last condition in this group to OR/AND
                      const lastCondInGroup = group[group.length - 1];
                      toggleConditionOperator(lastCondInGroup.id);
                    }}
                    className="mx-4 px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer hover:scale-105 bg-warning/20 text-warning border-2 border-warning/40 shadow-sm"
                  >
                    OR
                  </button>
                  <div className="flex-1 h-0.5 bg-warning/30" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Button 
        type="button" 
        variant="outline" 
        size="sm" 
        onClick={addCondition}
        className={`w-full h-9 border-dashed ${
          isOpen 
            ? "border-success/30 text-success hover:bg-success/10 hover:border-success/50" 
            : "border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
        }`}
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Condition
      </Button>

      {/* Logic Preview */}
      {conditionGroup.conditions.length >= 2 && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-2.5 rounded-md bg-muted/50 border border-border"
        >
          <div className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground">📋 Logic:</span>
            <code className="text-xs font-mono text-foreground break-all">
              {logicPreview}
            </code>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Single Condition Row
function ConditionRow({
  condition,
  onChange,
  onRemove,
  registry,
  accentColor,
}: {
  condition: SingleCondition;
  onChange: (cond: SingleCondition) => void;
  onRemove: () => void;
  registry: Registry;
  accentColor: "success" | "destructive";
}) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-background/50 border border-border/50">
      <ConditionSideEditor
        side={condition.left}
        onChange={(left) => onChange({ ...condition, left })}
        registry={registry}
      />
      
      <Select
        value={condition.operator}
        onValueChange={(op) => onChange({ ...condition, operator: op })}
      >
        <SelectTrigger className="w-16 h-9 bg-secondary/50 border-border/50 font-mono text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["<", ">", "<=", ">=", "==", "!="].map((op) => (
            <SelectItem key={op} value={op} className="font-mono">{op}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ConditionSideEditor
        side={condition.right}
        onChange={(right) => onChange({ ...condition, right })}
        registry={registry}
      />

      <Button 
        type="button" 
        variant="ghost" 
        size="sm"
        onClick={onRemove}
        className="h-9 w-9 p-0 hover:bg-destructive/20 hover:text-destructive flex-shrink-0"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Condition Side Editor
function ConditionSideEditor({
  side,
  onChange,
  registry,
}: {
  side: ConditionSide;
  onChange: (side: ConditionSide) => void;
  registry: Registry;
}) {
  const [open, setOpen] = useState(false);
  const [hasOperation, setHasOperation] = useState(!!side.operation);

  const getSummary = () => {
    let base: string;
    if (side.type === "value") {
      base = String(side.value);
    } else {
      const mainArg = side.args.period || side.args.field || "";
      base = `${side.func}${mainArg ? `(${mainArg})` : ""}`;
    }
    
    if (side.operation && side.operation.operand !== undefined) {
      base = `${base} ${side.operation.operator} ${side.operation.operand}`;
    }
    
    return base;
  };

  const handleToggleOperation = (enabled: boolean) => {
    setHasOperation(enabled);
    if (enabled) {
      onChange({ ...side, operation: { operator: "*", operand: 1 } });
    } else {
      onChange({ ...side, operation: undefined });
    }
  };

  const handleOperationChange = (field: "operator" | "operand", value: any) => {
    const currentOp = side.operation || { operator: "*" as const, operand: 1 };
    onChange({
      ...side,
      operation: { ...currentOp, [field]: value }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-all text-sm flex-1 min-w-0 ${
            side.type === "indicator"
              ? "bg-primary/5 border-primary/20 text-primary"
              : "bg-secondary/50 border-border/50"
          }`}
        >
          <span className="font-medium truncate">{getSummary()}</span>
          <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-72 p-3 space-y-3 max-h-96 overflow-y-auto" 
        align="start"
        side="bottom"
        sideOffset={4}
      >
        <Select
          value={side.type}
          onValueChange={(val: "value" | "indicator") => {
            if (val === "indicator") {
              onChange({ type: "indicator", value: 0, func: "RSI", args: { period: 14, timeframe: "1h", offset: 0 }, operation: side.operation });
            } else {
              onChange({ type: "value", value: 30, func: "", args: {}, operation: side.operation });
            }
          }}
        >
          <SelectTrigger className="h-8 bg-secondary/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="value">Value</SelectItem>
            <SelectItem value="indicator">Indicator</SelectItem>
          </SelectContent>
        </Select>

        {side.type === "value" && (
          <Input
            type="number"
            value={side.value}
            onChange={(e) => onChange({ ...side, value: parseFloat(e.target.value) || 0 })}
            className="h-8 bg-secondary/50"
          />
        )}

        {side.type === "indicator" && (
          <>
            <Select
              value={side.func}
              onValueChange={(func) => {
                const defaults = registry.indicators.INDICATORS[func]?.defaults || {};
                onChange({ ...side, func, args: { ...defaults } });
              }}
            >
              <SelectTrigger className="h-8 bg-secondary/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(registry.indicators.INDICATORS).map((ind) => (
                  <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              {Object.entries(side.args).map(([param, val]) => (
                <div key={param} className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">{param}</span>
                  {param === "field" ? (
                    <Select
                      value={String(val)}
                      onValueChange={(v) => onChange({ ...side, args: { ...side.args, [param]: v } })}
                    >
                      <SelectTrigger className="h-7 text-xs bg-secondary/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["open", "high", "low", "close"].map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : param === "timeframe" ? (
                    <Select
                      value={String(val)}
                      onValueChange={(v) => onChange({ ...side, args: { ...side.args, [param]: v } })}
                    >
                      <SelectTrigger className="h-7 text-xs bg-secondary/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                          <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="number"
                      value={val as number}
                      onChange={(e) => onChange({ ...side, args: { ...side.args, [param]: parseFloat(e.target.value) || 0 } })}
                      className="h-7 text-xs bg-secondary/50"
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Mathematical Operation Section */}
        <div className="pt-2 border-t border-border/50 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={hasOperation}
              onCheckedChange={(checked) => handleToggleOperation(!!checked)}
            />
            <span className="text-xs text-muted-foreground">Apply operation</span>
          </label>
          
          {hasOperation && (
            <div className="flex items-center gap-2">
              <Select
                value={side.operation?.operator || "*"}
                onValueChange={(v) => handleOperationChange("operator", v)}
              >
                <SelectTrigger className="w-16 h-8 bg-secondary/50 font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["*", "/", "+", "-"].map((op) => (
                    <SelectItem key={op} value={op} className="font-mono">{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="0.01"
                value={side.operation?.operand ?? 1}
                onChange={(e) => handleOperationChange("operand", parseFloat(e.target.value) || 0)}
                className="flex-1 h-8 bg-secondary/50"
                placeholder="1.05"
              />
            </div>
          )}
          
          {hasOperation && (
            <p className="text-[10px] text-muted-foreground">
              Preview: {getSummary()}
            </p>
          )}
        </div>

        <Button 
          type="button" 
          size="sm" 
          onClick={() => setOpen(false)}
          className="w-full h-7 text-xs"
        >
          Done
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// Argument Selector Component
function ArgumentSelector({
  block,
  availableArgs,
  currentArgs,
  onChange,
}: {
  block: string;
  availableArgs: Record<string, any>;
  currentArgs: Record<string, any>;
  onChange: (arg: string, val: any) => void;
}) {
  const [addedArgs, setAddedArgs] = useState<string[]>(Object.keys(currentArgs));

  const addArg = (arg: string) => {
    if (!addedArgs.includes(arg)) {
      setAddedArgs([...addedArgs, arg]);
      onChange(arg, availableArgs[arg]?.default ?? null);
    }
  };

  const removeArg = (arg: string) => {
    setAddedArgs(addedArgs.filter((a) => a !== arg));
    onChange(arg, undefined);
  };

  // Filter out TP, SL, and spread from OPEN block since they're managed in Trade Settings
  const hiddenArgs = ["takeProfitPercent", "stopLossPercent", "spread"];
  const topLevelArgs = Object.keys(availableArgs).filter((a) => !availableArgs[a]?.parent && !hiddenArgs.includes(a));

  return (
    <div className="space-y-2">
      {addedArgs.map((arg) => {
        const argData = availableArgs[arg];
        if (!argData) return null;

        const val = currentArgs[arg] ?? argData.default;
        const valType = typeof argData.default;

        return (
          <div key={arg} className="flex items-center gap-2 p-2 rounded-lg bg-background/30 border border-border/30">
            <span className="text-xs text-muted-foreground flex-1 truncate">{arg}</span>
            {valType === "boolean" ? (
              <Select value={String(val)} onValueChange={(v) => onChange(arg, v === "true")}>
                <SelectTrigger className="w-20 h-7 text-xs bg-secondary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            ) : argData.options ? (
              <Select value={val} onValueChange={(v) => onChange(arg, v)}>
                <SelectTrigger className="w-36 h-7 text-xs bg-secondary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {argData.options.map((opt: string) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type="number"
                value={val}
                onChange={(e) => onChange(arg, parseFloat(e.target.value) || 0)}
                className="w-20 h-7 text-xs bg-secondary/50"
              />
            )}
            <button type="button" onClick={() => removeArg(arg)} className="text-muted-foreground hover:text-destructive">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {topLevelArgs.filter((a) => !addedArgs.includes(a)).length > 0 && (
        <Select onValueChange={addArg}>
          <SelectTrigger className="w-full h-8 text-xs bg-secondary/30 border-dashed">
            <SelectValue placeholder="+ Add parameter..." />
          </SelectTrigger>
          <SelectContent>
            {topLevelArgs.filter((a) => !addedArgs.includes(a)).map((arg) => (
              <SelectItem key={arg} value={arg}>{arg}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default BacktestForm;
