import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { api, SavedStrategy } from "@/lib/api";
import { MultiConditionBuilder } from "./ConditionBuilder";
import { ArgumentSelector } from "./ArgumentSelector";
import { 
  Registry, 
  ConditionGroup, 
  SingleCondition, 
  ConditionSide,
  generateId, 
  createDefaultCondition, 
  FALLBACK_REGISTRY 
} from "./backtest-types";

interface BacktestFormProps {
  onRunBacktest: (results: any) => void;
}

const BacktestForm = ({ onRunBacktest }: BacktestFormProps) => {
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
        setRegistry(FALLBACK_REGISTRY);
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
    const buildSide = (sideData: ConditionSide): any => {
      let base: any;
      if (sideData.type === "indicator") {
        base = { func: sideData.func, arg: sideData.args };
      } else {
        base = { value: sideData.value };
      }
      
      if (sideData.operation && sideData.operation.operand !== undefined) {
        return {
          op: sideData.operation.operator,
          left: base,
          right: { value: sideData.operation.operand }
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
                className="p-4 rounded-xl border border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${side === "LONG" ? "bg-success/20" : "bg-destructive/20"}`}>
                      {side === "LONG" ? (
                        <ArrowUpCircle className="h-4 w-4 text-success" />
                      ) : (
                        <ArrowDownCircle className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{strategyName || "Unnamed Strategy"}</p>
                      <p className="text-xs text-muted-foreground">
                        {side} • {conditionGroups.OPEN?.conditions.length || 0} open conditions • {conditionGroups.CLOSE?.conditions.length || 0} close conditions
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </motion.div>

              {/* Market Selection */}
              <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <BarChart3 className="h-4 w-4 text-primary" />
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
                          <p className="text-xs">Enter stock symbols (e.g., AAPL, MSFT, GOOGL)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {tickers.map((ticker, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Input
                          value={ticker}
                          onChange={(e) => updateTicker(i, e.target.value)}
                          placeholder="AAPL"
                          className="w-24 h-9 bg-secondary/50 border-border/50 uppercase font-mono"
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
                      { label: "2Y", months: 23 },
                      //{ label: "5Y", months: 60 },
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

export default BacktestForm;
