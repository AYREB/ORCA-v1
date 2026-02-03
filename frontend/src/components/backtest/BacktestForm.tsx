import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Play, Settings2, TrendingUp, Calendar, Clock, Plus, X, 
  ChevronDown, Zap, Target, ArrowUpCircle, ArrowDownCircle,
  Activity, BarChart3, Save, Info, ChevronRight, FolderOpen, Bookmark,
  ArrowRight, ArrowLeft, Check, DollarSign
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { SavedStrategy } from "@/lib/api";

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
  
  // Step state for two-step flow
  const [step, setStep] = useState<1 | 2>(1);
  
  // Load Strategy dialog state
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  
  // Form state - Step 1: Strategy Definition
  const [side, setSide] = useState("LONG");
  const [blocks, setBlocks] = useState<Record<string, Record<string, { ARGUMENTS: Record<string, any> }>>>({
    LONG: {},
    SHORT: {},
  });
  const { user } = useAuth();

  
  // Multi-condition state
  const [conditionGroups, setConditionGroups] = useState<Record<string, ConditionGroup>>({
    OPEN: { conditions: [] },
    CLOSE: { conditions: [] },
  });
  
  // Form state - Step 2: Backtest Configuration
  const [tickers, setTickers] = useState<string[]>(["AAPL"]);
  const [executionTF, setExecutionTF] = useState("1h");
  const [dateStart, setDateStart] = useState("2024-01-01");
  const [dateEnd, setDateEnd] = useState("2025-01-01");
  const [initialBalance, setInitialBalance] = useState(10000);
  
  // Trade settings state
  const [takeProfitPercent, setTakeProfitPercent] = useState(10);
  const [stopLossPercent, setStopLossPercent] = useState(6);
  const [spread, setSpread] = useState(0.001);
  const [tradeSettingsOpen, setTradeSettingsOpen] = useState(false);

  // Fetch registry and saved strategies on mount
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
                  recurringPeriod: { default: 5, parent: "recurring" },
                  recurringInvestType: { default: "percentCashBalance", options: ["percentCashBalance", "fixedValue", "percentSharePrice", "numberShares"], parent: "recurring" },
                  recurringInvestAmount: { default: 0.1, parent: "recurring" },
                  maxRecurringCount: { default: 0, parent: "recurring" },
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
    const fetchStrategies = async () => {
      try {
        const strategies = await api.fetchStrategies();
        setSavedStrategies(strategies);
      } catch (err) {
        console.error("Failed to fetch strategies:", err);
        toast.error("Failed to load saved strategies");
      }
    };
    
    fetchStrategies();
    
  }, []);

  // DSL Parser functions for Load Strategy feature
  const parseSideObj = (sideObj: any): ConditionSide => {
    // Check for arithmetic operation wrapper
    if (sideObj.op) {
      const base = sideObj.left;
      return {
        type: base.func ? "indicator" : "value",
        value: base.value || 0,
        func: base.func || "",
        args: base.arg || {},
        operation: {
          operator: sideObj.op,
          operand: sideObj.right?.value || 0
        }
      };
    }
    
    // Indicator
    if (sideObj.func) {
      return {
        type: "indicator",
        value: 0,
        func: sideObj.func,
        args: sideObj.arg || {},
        operation: undefined
      };
    }
    
    // Literal value
    return {
      type: "value",
      value: sideObj.value || 0,
      func: "",
      args: {},
      operation: undefined
    };
  };

  const parseConditions = (conditionsObj: any): SingleCondition[] => {
    const conditions: SingleCondition[] = [];
    
    // Handle empty or invalid
    if (!conditionsObj || Object.keys(conditionsObj).length === 0) {
      return conditions;
    }
    
    // Handle single condition (flat structure)
    if (conditionsObj.left && conditionsObj.operator && conditionsObj.right) {
      conditions.push({
        id: generateId(),
        left: parseSideObj(conditionsObj.left),
        operator: conditionsObj.operator,
        right: parseSideObj(conditionsObj.right),
        nextLogicalOperator: "AND"
      });
      return conditions;
    }
    
    // Handle AND array
    if (conditionsObj.AND) {
      conditionsObj.AND.forEach((cond: any, i: number) => {
        conditions.push({
          id: generateId(),
          left: parseSideObj(cond.left),
          operator: cond.operator,
          right: parseSideObj(cond.right),
          nextLogicalOperator: i < conditionsObj.AND.length - 1 ? "AND" : "AND"
        });
      });
      return conditions;
    }
    
    // Handle OR array (may contain AND groups)
    if (conditionsObj.OR) {
      conditionsObj.OR.forEach((group: any, groupIndex: number) => {
        if (group.AND) {
          group.AND.forEach((cond: any, i: number) => {
            conditions.push({
              id: generateId(),
              left: parseSideObj(cond.left),
              operator: cond.operator,
              right: parseSideObj(cond.right),
              nextLogicalOperator: i < group.AND.length - 1 ? "AND" : 
                (groupIndex < conditionsObj.OR.length - 1 ? "OR" : "AND")
            });
          });
        } else if (group.left && group.operator && group.right) {
          // Single condition in OR group
          conditions.push({
            id: generateId(),
            left: parseSideObj(group.left),
            operator: group.operator,
            right: parseSideObj(group.right),
            nextLogicalOperator: groupIndex < conditionsObj.OR.length - 1 ? "OR" : "AND"
          });
        }
      });
      return conditions;
    }
    
    return conditions;
  };

  const loadStrategyFromDsl = (strategy: SavedStrategy) => {
    try {
      const dsl = JSON.parse(strategy.dsl);
      
      // Determine side (LONG or SHORT)
      const detectedSide = dsl.LONG ? "LONG" : dsl.SHORT ? "SHORT" : "LONG";
      setSide(detectedSide);
      
      const sideData = dsl[detectedSide];
      if (!sideData) {
        toast.error("Invalid strategy format");
        return;
      }
      
      // Parse OPEN conditions
      const newConditionGroups: Record<string, ConditionGroup> = {
        OPEN: { conditions: [] },
        CLOSE: { conditions: [] },
      };
      
      const newBlocks: Record<string, Record<string, { ARGUMENTS: Record<string, any> }>> = {
        LONG: {},
        SHORT: {},
      };
      
      if (sideData.OPEN?.CONDITIONS) {
        const openConditions = parseConditions(sideData.OPEN.CONDITIONS);
        newConditionGroups.OPEN = { conditions: openConditions };
        newBlocks[detectedSide].OPEN = { ARGUMENTS: sideData.OPEN.ARGUMENTS || {} };
      }
      
      if (sideData.CLOSE?.CONDITIONS) {
        const closeConditions = parseConditions(sideData.CLOSE.CONDITIONS);
        newConditionGroups.CLOSE = { conditions: closeConditions };
        newBlocks[detectedSide].CLOSE = { ARGUMENTS: sideData.CLOSE.ARGUMENTS || {} };
      }
      
      setConditionGroups(newConditionGroups);
      setBlocks(newBlocks);
      setStrategyName(strategy.name);
      
      toast.success(`Strategy "${strategy.name}" loaded!`);
      setShowLoadDialog(false);
    } catch (err) {
      console.error("Failed to parse strategy:", err);
      toast.error("Failed to parse strategy");
    }
  };

  const formatRelativeDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  };

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
      const orGroups: SingleCondition[][] = [];
      let currentAndGroup: SingleCondition[] = [conditions[0]];
      
      for (let i = 0; i < conditions.length - 1; i++) {
        const cond = conditions[i];
        const nextCond = conditions[i + 1];
        
        if (cond.nextLogicalOperator === "AND") {
          currentAndGroup.push(nextCond);
        } else {
          orGroups.push(currentAndGroup);
          currentAndGroup = [nextCond];
        }
      }
      orGroups.push(currentAndGroup);
      
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
        // recurring settings come from blocks[side]["OPEN"].ARGUMENTS via ArgumentSelector
      }
      
      dsl[side][blockName] = {
        CONDITIONS: buildConditions(conditionGroups[blockName] || { conditions: [] }),
        ARGUMENTS: args,
      };
    });

    return dsl;
  };

  // Build strategy-only DSL (for saving - without context)
  const buildStrategyOnlyDsl = () => {
    const buildSide = (side: ConditionSide): any => {
      let base: any;
      if (side.type === "indicator") {
        base = { func: side.func, arg: side.args };
      } else {
        base = { value: side.value };
      }
      
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
      
      const orGroups: SingleCondition[][] = [];
      let currentAndGroup: SingleCondition[] = [conditions[0]];
      
      for (let i = 0; i < conditions.length - 1; i++) {
        const cond = conditions[i];
        const nextCond = conditions[i + 1];
        
        if (cond.nextLogicalOperator === "AND") {
          currentAndGroup.push(nextCond);
        } else {
          orGroups.push(currentAndGroup);
          currentAndGroup = [nextCond];
        }
      }
      orGroups.push(currentAndGroup);
      
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
      [side]: {},
    };

    Object.entries(blocks[side]).forEach(([blockName, blockData]) => {
      dsl[side][blockName] = {
        CONDITIONS: buildConditions(conditionGroups[blockName] || { conditions: [] }),
        ARGUMENTS: blockData.ARGUMENTS || {},
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

  const canProceedToStep2 = () => {
    // At least one block with at least one condition
    const hasOpenConditions = conditionGroups.OPEN?.conditions?.length > 0;
    const hasCloseConditions = conditionGroups.CLOSE?.conditions?.length > 0;
    return hasOpenConditions || hasCloseConditions;
  };

  const canRunBacktest = () => {
    return tickers.filter(Boolean).length > 0;
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
        <div className="flex-1">
          <h3 className="text-lg font-semibold">Strategy Builder</h3>
          <p className="text-sm text-muted-foreground">Build your trading strategy visually</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="p-4 rounded-xl border border-border bg-card/30">
        <div className="flex items-center">
          {/* Step 1 */}
          <button
            type="button"
            onClick={() => setStep(1)}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center 
              transition-all border-2 ${
              step === 1 
                ? "bg-primary border-primary text-primary-foreground" 
                : step > 1 
                  ? "bg-primary/20 border-primary text-primary"
                  : "bg-muted border-border text-muted-foreground"
            }`}>
              {step > 1 ? <Check className="h-5 w-5" /> : "1"}
            </div>
            <span className={`text-xs font-medium ${
              step === 1 ? "text-primary" : "text-muted-foreground"
            }`}>
              Strategy
            </span>
          </button>
          
          {/* Connecting Line */}
          <div className="flex-1 h-1 mx-4 bg-border rounded-full relative overflow-hidden">
            <motion.div 
              className="absolute inset-y-0 left-0 bg-primary rounded-full"
              initial={false}
              animate={{ width: step === 2 ? "100%" : "0%" }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            />
          </div>
          
          {/* Step 2 */}
          <button
            type="button"
            onClick={() => canProceedToStep2() && setStep(2)}
            disabled={!canProceedToStep2()}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center 
              transition-all border-2 ${
              step === 2 
                ? "bg-primary border-primary text-primary-foreground" 
                : canProceedToStep2()
                  ? "bg-card border-primary/50 text-primary group-hover:border-primary"
                  : "bg-muted border-border text-muted-foreground"
            }`}>
              2
            </div>
            <span className={`text-xs font-medium ${
              step === 2 ? "text-primary" : "text-muted-foreground"
            }`}>
              Configuration
            </span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AnimatePresence mode="wait">
          {/* STEP 1: Strategy Definition */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="space-y-4"
            >
            {/* Strategy Name */}
            <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Strategy Name</Label>
                <Input
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="My RSI Strategy"
                  className="bg-secondary/50 border-border/50 h-9 max-w-sm"
                />
              </div>
              
              {/* Position Side */}
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

            {/* Load Saved Strategy Section */}
            <div className="p-4 rounded-xl border border-dashed border-border/50 bg-secondary/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Have a saved strategy?</p>
                    <p className="text-xs text-muted-foreground">Load previous logic to quickly iterate on it</p>
                  </div>
                </div>
                <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="gap-2">
                      <FolderOpen className="h-4 w-4" />
                      Load Strategy
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Load Saved Strategy</DialogTitle>
                      <DialogDescription>
                        Select a strategy to load its logic into the builder. You can then modify it or test with different parameters.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <ScrollArea className="h-[300px] mt-4">
                      {savedStrategies.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Bookmark className="h-12 w-12 mx-auto mb-3 opacity-30" />
                          <p>No saved strategies yet</p>
                          <p className="text-xs mt-1">Save a strategy first using the Save button</p>
                        </div>
                      ) : (
                        <div className="space-y-2 pr-4">
                          {savedStrategies.map((strategy) => (
                            <button
                              key={strategy.id}
                              type="button"
                              onClick={() => loadStrategyFromDsl(strategy)}
                              className="w-full p-3 rounded-lg border border-border 
                                         hover:border-primary/50 hover:bg-primary/5 
                                         text-left transition-all"
                            >
                              <div className="font-medium">{strategy.name}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Created {formatRelativeDate(strategy.createdAt)}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Step 1 Actions */}
            <div className="flex gap-3 pt-2">
              <Button 
                type="button" 
                variant="hero" 
                className="flex-1 h-12 text-base" 
                disabled={!canProceedToStep2()}
                onClick={() => setStep(2)}
              >
                Configure Backtest
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </div>
          </motion.div>
          )}

          {/* STEP 2: Backtest Configuration */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="space-y-4"
            >
              {/* Strategy Summary Card */}
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setStep(1)}
                className="p-4 rounded-xl border border-primary/30 bg-primary/5 cursor-pointer 
                           hover:bg-primary/10 hover:border-primary/50 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${
                      side === "LONG" ? "bg-success/10" : "bg-destructive/10"
                    }`}>
                      {side === "LONG" 
                        ? <ArrowUpCircle className="h-5 w-5 text-success" />
                        : <ArrowDownCircle className="h-5 w-5 text-destructive" />
                      }
                    </div>
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {strategyName || "Untitled Strategy"}
                        <Badge variant="outline" className="text-xs">
                          {side}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 max-w-md truncate">
                        {generateLogicPreview(conditionGroups.OPEN?.conditions || [])}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground 
                                  group-hover:text-primary transition-colors">
                    <span>Edit Strategy</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </motion.div>

              {/* Markets Section */}
              <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Markets
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Tickers
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Enter the stock symbol to backtest against (e.g., AAPL, TSLA)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {tickers.map((t, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input
                          value={t}
                          onChange={(e) => updateTicker(i, e.target.value)}
                          placeholder="AAPL"
                          className="w-24 bg-secondary/50 border-border/50 h-9 text-center font-mono"
                        />
                        {tickers.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeTicker(i)} className="h-9 w-9 hover:bg-destructive/20 hover:text-destructive">
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={addTicker} className="h-9 gap-1">
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>

              {/* Timing Section */}
              <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-primary" />
                  Timing
                </div>
                
                {/* Timeframe */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Execution Timeframe
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Candle interval for signal evaluation</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Select value={executionTF} onValueChange={setExecutionTF}>
                    <SelectTrigger className="w-32 bg-secondary/50 border-border/50 h-9">
                      <SelectValue />
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
                      { label: "1M", months: 1 },
                      { label: "3M", months: 3 },
                      { label: "6M", months: 6 },
                      { label: "1Y", months: 12 },
                      { label: "2Y", months: 24 },
                      { label: "5Y", months: 60 },
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
              </div>

              {/* Account Section */}
              <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Account
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Initial Balance ($)
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Starting capital for the backtest simulation</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    type="number"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(parseFloat(e.target.value) || 10000)}
                    className="bg-secondary/50 border-border/50 h-9 w-full max-w-[200px]"
                    placeholder="10000"
                  />
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

            {/* Step 2 Actions */}
            <div className="flex gap-3 pt-2">
              <Button 
                type="button" 
                variant="outline" 
                className="h-12 px-6"
                onClick={() => setStep(1)}
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                Back
              </Button>
              
              {/* Save Strategy Dialog */}
              <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" className="h-12 px-6" disabled={!canRunBacktest()}>
                    <Save className="h-5 w-5 mr-2" />
                    Save
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save Strategy</DialogTitle>
                    <DialogDescription>
                      Save your complete strategy including logic and market configuration for later use.
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
                      Save Strategy
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              
              <Button type="submit" variant="hero" className="flex-1 h-12 text-base" disabled={loading || !canRunBacktest()}>
                {loading ? (
                  <>Running Backtest...</>
                ) : (
                  <>
                    <Play className="h-5 w-5 mr-2" />
                    Run Backtest
                  </>
                )}
              </Button>
            </div>
          </motion.div>
          )}
        </AnimatePresence>
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

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {visualGroups.map((group, groupIndex) => (
            <motion.div
              key={`group-${groupIndex}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`${
                visualGroups.length > 1 
                  ? `p-3 rounded-lg border ${isOpen ? "border-primary/30 bg-primary/5" : "border-primary/30 bg-primary/5"}`
                  : ""
              }`}
            >
              {visualGroups.length > 1 && (
                <div className="text-[10px] uppercase text-muted-foreground font-medium mb-2 tracking-wider">
                  Group {groupIndex + 1}
                </div>
              )}
              
              <div className="space-y-2">
                {group.map((cond, indexInGroup) => {
                  const originalIndex = conditionGroup.conditions.findIndex(c => c.id === cond.id);
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
            </motion.div>
          ))}
          
          {/* OR separators between groups */}
          {visualGroups.length > 1 && visualGroups.map((group, groupIndex) => {
            if (groupIndex >= visualGroups.length - 1) return null;
            const lastCondInGroup = group[group.length - 1];
            
            return (
              <div key={`or-${groupIndex}`} className="flex items-center justify-center py-3">
                <div className="flex-1 h-0.5 bg-warning/30" />
                <button
                  type="button"
                  onClick={() => toggleConditionOperator(lastCondInGroup.id)}
                  className="mx-4 px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer hover:scale-105 bg-warning/20 text-warning border-2 border-warning/40 shadow-sm"
                >
                  OR
                </button>
                <div className="flex-1 h-0.5 bg-warning/30" />
              </div>
            );
          })}
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

// Argument Selector Component with parent-child support
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

  // Get children of a parent arg
  const getChildren = (parentArg: string) => {
    return Object.keys(availableArgs).filter(
      (a) => availableArgs[a]?.parent === parentArg
    );
  };

  const addArg = (arg: string) => {
    if (!addedArgs.includes(arg)) {
      const newArgs = [arg];
      onChange(arg, availableArgs[arg]?.default ?? null);
      
      // If this arg has children, also add them with defaults
      const children = getChildren(arg);
      children.forEach((child) => {
        if (!addedArgs.includes(child)) {
          newArgs.push(child);
          onChange(child, availableArgs[child]?.default ?? null);
        }
      });
      
      setAddedArgs([...addedArgs, ...newArgs]);
    }
  };

  const removeArg = (arg: string) => {
    // Also remove any children of this arg
    const children = getChildren(arg);
    const toRemove = [arg, ...children];
    
    setAddedArgs(addedArgs.filter((a) => !toRemove.includes(a)));
    toRemove.forEach((a) => onChange(a, undefined));
  };

  // Check if parent is enabled (value is true)
  const isParentEnabled = (parentArg: string) => {
    return currentArgs[parentArg] === true;
  };

  // Filter out trade settings args from OPEN block since they're managed in Trade Settings
  const hiddenArgs = [
    "takeProfitPercent", 
    "stopLossPercent", 
    "spread"
  ];
  const topLevelArgs = Object.keys(availableArgs).filter((a) => !availableArgs[a]?.parent && !hiddenArgs.includes(a));

  // Render a single argument row
  const renderArgRow = (arg: string, isChild: boolean = false) => {
    const argData = availableArgs[arg];
    if (!argData) return null;

    const val = currentArgs[arg] ?? argData.default;
    const valType = typeof argData.default;

    return (
      <div 
        key={arg} 
        className={`flex items-center gap-2 p-2 rounded-lg bg-background/30 border border-border/30 ${
          isChild ? "ml-4 border-l-2 border-l-primary/30" : ""
        }`}
      >
        <span className="text-xs text-muted-foreground flex-1 truncate">
          {isChild && <span className="text-primary/50 mr-1">↳</span>}
          {arg}
        </span>
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
  };

  return (
    <div className="space-y-2">
      {addedArgs
        .filter((arg) => !availableArgs[arg]?.parent) // Only top-level in main loop
        .map((arg) => (
          <div key={arg}>
            {renderArgRow(arg, false)}
            
            {/* Render children if parent is enabled (set to true) */}
            {isParentEnabled(arg) && (
              <div className="space-y-2 mt-2">
                {getChildren(arg)
                  .filter((child) => addedArgs.includes(child))
                  .map((child) => renderArgRow(child, true))}
              </div>
            )}
          </div>
        ))}

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
