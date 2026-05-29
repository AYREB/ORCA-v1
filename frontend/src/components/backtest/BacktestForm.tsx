import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/hooks/useSettings";
import { motion, AnimatePresence } from "framer-motion";
import {Play,
  Settings2,
  Calendar,
  Clock,
  Plus,
  X,
  Target,
  Activity,
  ArrowUpCircle,
  ArrowDownCircle,
  BarChart3,
  Save,
  Info,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  Check,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { api, SavedStrategy, StrategyAssistantContext } from "@/lib/api";
import { MultiConditionBuilder } from "./ConditionBuilder";
import { ArgumentSelector } from "./ArgumentSelector";
import StrategyAssistantDrawer from "./StrategyAssistantDrawer";
import {
  Registry,
  ConditionGroup,
  SingleCondition,
  ConditionSide,
  generateId,
  FALLBACK_REGISTRY,
} from "./backtest-types";

export interface BacktestFormProps {

  onRunBacktest: (results: any ) => void;

  onDslChange: (json: any, text: any) => void;

  showActions?: boolean;

  initialDslJson?: Record<string, any>; // Add this property

}

type WizardStep = 1 | 2 | 3 | 4 | 5;
type BlockState = Record<string, Record<string, { ARGUMENTS: Record<string, any> }>>;
type RiskArgument = "takeProfitPercent" | "stopLossPercent" | "spread";

const RISK_ARGUMENTS: RiskArgument[] = ["takeProfitPercent", "stopLossPercent", "spread"];

const WIZARD_STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 1, label: "Strategy" },
  { id: 2, label: "Markets & Timing" },
  { id: 3, label: "Open Setup" },
  { id: 4, label: "Close Setup" },
  { id: 5, label: "Account" },
];

const stripRiskArguments = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).filter(([key]) => !RISK_ARGUMENTS.includes(key as RiskArgument)));

const numericArg = (value: unknown, fallback: number) => {
  const numericValue = typeof value === "string" ? Number(value) : value;
  return typeof numericValue === "number" && Number.isFinite(numericValue) ? numericValue : fallback;
};

const numberInputValue = (value: number) => (Number.isFinite(value) ? value : 0);

const BacktestForm = ({ onRunBacktest, showActions = true }: BacktestFormProps) => {
  const { settings } = useSettings();
  const btDefaults = settings.backtestDefaults;
  const [loading, setLoading] = useState(false);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [strategyName, setStrategyName] = useState("");
  const [step, setStep] = useState<WizardStep>(1);

  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);

  const [side, setSide] = useState("LONG");
  const [blocks, setBlocks] = useState<BlockState>({
    LONG: {},
    SHORT: {},
  });
  const { user } = useAuth();

  const [conditionGroups, setConditionGroups] = useState<Record<string, ConditionGroup>>({
    OPEN: { conditions: [] },
    CLOSE: { conditions: [] },
  });

  const [tickers, setTickers] = useState<string[]>(["AAPL"]);
  const [executionTF, setExecutionTF] = useState(btDefaults.timeframe);
  const [dateStart, setDateStart] = useState("2025-01-01");
  const [dateEnd, setDateEnd] = useState("2026-01-01");
  const [initialBalance, setInitialBalance] = useState(btDefaults.initialBalance);
  const [takeProfitPercent, setTakeProfitPercent] = useState(btDefaults.takeProfitPercent);
  const [stopLossPercent, setStopLossPercent] = useState(btDefaults.stopLossPercent);
  const [spread, setSpread] = useState(btDefaults.spread);

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

    const fetchStrategies = async () => {
      if (!user) return;
      try {
        const strategies = await api.fetchStrategies();
        setSavedStrategies(strategies);
      } catch (err) {
        console.error("Failed to fetch strategies:", err);
        toast.error("Failed to load saved strategies");
      }
    };

    fetchRegistry();
    fetchStrategies();
  }, [user]);

  const parseSideObj = (sideObj: any): ConditionSide => {
    if (sideObj.op) {
      const base = sideObj.left;
      return {
        type: base.func ? "indicator" : "value",
        value: base.value || 0,
        func: base.func || "",
        args: base.arg || {},
        operation: {
          operator: sideObj.op,
          operand: sideObj.right?.value || 0,
        },
      };
    }

    if (sideObj.func) {
      return {
        type: "indicator",
        value: 0,
        func: sideObj.func,
        args: sideObj.arg || {},
        operation: undefined,
      };
    }

    return {
      type: "value",
      value: sideObj.value || 0,
      func: "",
      args: {},
      operation: undefined,
    };
  };

  const parseConditions = (conditionsObj: any): SingleCondition[] => {
    const conditions: SingleCondition[] = [];
    if (!conditionsObj || Object.keys(conditionsObj).length === 0) return conditions;

    if (conditionsObj.left && conditionsObj.operator && conditionsObj.right) {
      conditions.push({
        id: generateId(),
        left: parseSideObj(conditionsObj.left),
        operator: conditionsObj.operator,
        right: parseSideObj(conditionsObj.right),
        nextLogicalOperator: "AND",
      });
      return conditions;
    }

    if (conditionsObj.AND) {
      conditionsObj.AND.forEach((cond: any, i: number) => {
        conditions.push({
          id: generateId(),
          left: parseSideObj(cond.left),
          operator: cond.operator,
          right: parseSideObj(cond.right),
          nextLogicalOperator: i < conditionsObj.AND.length - 1 ? "AND" : "AND",
        });
      });
      return conditions;
    }

    if (conditionsObj.OR) {
      conditionsObj.OR.forEach((group: any, groupIndex: number) => {
        if (group.AND) {
          group.AND.forEach((cond: any, i: number) => {
            conditions.push({
              id: generateId(),
              left: parseSideObj(cond.left),
              operator: cond.operator,
              right: parseSideObj(cond.right),
              nextLogicalOperator:
                i < group.AND.length - 1 ? "AND" : groupIndex < conditionsObj.OR.length - 1 ? "OR" : "AND",
            });
          });
        } else if (group.left && group.operator && group.right) {
          conditions.push({
            id: generateId(),
            left: parseSideObj(group.left),
            operator: group.operator,
            right: parseSideObj(group.right),
            nextLogicalOperator: groupIndex < conditionsObj.OR.length - 1 ? "OR" : "AND",
          });
        }
      });
      return conditions;
    }

    return conditions;
  };

  const loadStrategyFromDsl = (strategy: SavedStrategy) => {
    try {
      const dsl = strategy.dslJson && typeof strategy.dslJson === "object" ? strategy.dslJson : JSON.parse(strategy.dsl);

      const detectedSide = dsl.LONG ? "LONG" : dsl.SHORT ? "SHORT" : "LONG";
      setSide(detectedSide);

      const sideData = dsl[detectedSide];
      if (!sideData) {
        toast.error("Invalid strategy format");
        return;
      }

      const newConditionGroups: Record<string, ConditionGroup> = {
        OPEN: { conditions: parseConditions(sideData.OPEN?.CONDITIONS || {}) },
        CLOSE: { conditions: parseConditions(sideData.CLOSE?.CONDITIONS || {}) },
      };

      const nextBlocks: BlockState = {
        LONG: {},
        SHORT: {},
      };

      const loadedOpenArgs = sideData.OPEN?.ARGUMENTS || {};
      setTakeProfitPercent(numericArg(loadedOpenArgs.takeProfitPercent, btDefaults.takeProfitPercent));
      setStopLossPercent(numericArg(loadedOpenArgs.stopLossPercent, btDefaults.stopLossPercent));
      setSpread(numericArg(loadedOpenArgs.spread, btDefaults.spread));

      if (sideData.OPEN?.ARGUMENTS) {
        nextBlocks[detectedSide].OPEN = { ARGUMENTS: stripRiskArguments(sideData.OPEN.ARGUMENTS) };
      }
      if (sideData.CLOSE?.ARGUMENTS) {
        nextBlocks[detectedSide].CLOSE = { ARGUMENTS: sideData.CLOSE.ARGUMENTS };
      }

      if (sideData.context) {
        if (Array.isArray(sideData.context.tickers) && sideData.context.tickers.length > 0) {
          setTickers(sideData.context.tickers);
        }
        if (sideData.context.execution_timeframe) {
          setExecutionTF(sideData.context.execution_timeframe);
        }
        if (sideData.context.dateframe?.start) {
          setDateStart(sideData.context.dateframe.start);
        }
        if (sideData.context.dateframe?.end) {
          setDateEnd(sideData.context.dateframe.end);
        }
      }

      setConditionGroups(newConditionGroups);
      setBlocks(nextBlocks);
      setStrategyName(strategy.name);
      setStep(1);
      setShowLoadDialog(false);
      toast.success(`Strategy "${strategy.name}" loaded`);
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

  const updateArgument = (block: "OPEN" | "CLOSE", arg: string, value: any) => {
    setBlocks((prev) => ({
      ...prev,
      [side]: {
        ...(prev[side] || {}),
        [block]: {
          ARGUMENTS: {
            ...(prev[side]?.[block]?.ARGUMENTS || {}),
            [arg]: value,
          },
        },
      },
    }));
  };

  const buildJsonDsl = () => {
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
          right: { value: sideData.operation.operand },
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
          AND: grp.map((cond) => ({
            left: buildSide(cond.left),
            operator: cond.operator,
            right: buildSide(cond.right),
          })),
        };
      };

      if (orGroups.length === 1) return buildGroup(orGroups[0]);
      return { OR: orGroups.map(buildGroup) };
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

    const openArgs = {
      ...stripRiskArguments(blocks[side]?.OPEN?.ARGUMENTS || {}),
      takeProfitPercent,
      stopLossPercent,
      spread,
    };
    const closeArgs = blocks[side]?.CLOSE?.ARGUMENTS || {};
    const openConditions = conditionGroups.OPEN || { conditions: [] };
    const closeConditions = conditionGroups.CLOSE || { conditions: [] };

    if (openConditions.conditions.length > 0 || Object.keys(openArgs).length > 0) {
      dsl[side].OPEN = {
        CONDITIONS: buildConditions(openConditions),
        ARGUMENTS: openArgs,
      };
    }

    if (closeConditions.conditions.length > 0 || Object.keys(closeArgs).length > 0) {
      dsl[side].CLOSE = {
        CONDITIONS: buildConditions(closeConditions),
        ARGUMENTS: closeArgs,
      };
    }

    return dsl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payloadDsl = buildJsonDsl();
      const results = await api.backtestDSLJSON(payloadDsl, { initialBalance });
      toast.success("Backtest completed");
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
      toast.success(`Strategy "${strategyName}" saved`);
      setShowSaveDialog(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save strategy";
      toast.error(message);
    }
  };

  const canGoNext = () => {
    if (step === 2) {
      return tickers.filter(Boolean).length > 0;
    }
    if (step === 3) {
      return (conditionGroups.OPEN?.conditions?.length || 0) > 0;
    }
    return true;
  };

  const canRunBacktest = () => {
    return tickers.filter(Boolean).length > 0 && (conditionGroups.OPEN?.conditions?.length || 0) > 0;
  };

  const goNext = () => {
    if (!canGoNext() || step >= 5) return;
    setStep((prev) => (prev + 1) as WizardStep);
  };

  const goBack = () => {
    if (step <= 1) return;
    setStep((prev) => (prev - 1) as WizardStep);
  };

  if (!registry) {
    return (
      <div className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm">
        <div className="animate-pulse text-muted-foreground">Loading registry...</div>
      </div>
    );
  }

  const allowedArgs = registry.arguments?.ARGUMENTS?.[side] || {};
  const openArgs = stripRiskArguments(blocks[side]?.OPEN?.ARGUMENTS || {});
  const closeArgs = blocks[side]?.CLOSE?.ARGUMENTS || {};
  const assistantContext: StrategyAssistantContext = {
    currentStep: step,
    currentStage: WIZARD_STEPS.find((wizardStep) => wizardStep.id === step)?.label ?? "Strategy",
    strategyName: strategyName.trim() || "Unnamed Strategy",
    side,
    openConditions: conditionGroups.OPEN?.conditions ?? [],
    closeConditions: conditionGroups.CLOSE?.conditions ?? [],
    openArguments: openArgs,
    closeArguments: closeArgs,
    riskManagement: {
      takeProfitPercent,
      stopLossPercent,
      spread,
    },
    markets: {
      tickers: tickers.filter(Boolean),
      executionTimeframe: executionTF,
      dateStart,
      dateEnd,
    },
    account: {
      initialBalance,
    },
    jsonDsl: buildJsonDsl(),
    readOnly: true,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-card/50 backdrop-blur-sm sm:flex-row sm:items-center">
        <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20">
          <Settings2 className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">Strategy Builder</h3>
          <p className="text-sm text-muted-foreground">Create and run your backtest in 5 guided stages</p>
        </div>
        <StrategyAssistantDrawer context={assistantContext} />
      </div>

      <div className="p-4 rounded-xl border border-border bg-card/30">
        <div className="flex items-center overflow-x-auto">
          {WIZARD_STEPS.map((wizardStep, index) => {
            const isLast = index === WIZARD_STEPS.length - 1;
            return (
              <div
                key={wizardStep.id}
                className={`flex items-center min-w-fit ${isLast ? "" : "flex-1"}`}
              >
                <button
                  type="button"
                  onClick={() => setStep(wizardStep.id)}
                  className="flex items-center gap-2 group"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-semibold transition-all ${
                      step === wizardStep.id
                        ? "bg-primary border-primary text-primary-foreground"
                        : step > wizardStep.id
                          ? "bg-primary/15 border-primary text-primary"
                          : "bg-muted border-border text-muted-foreground"
                    }`}
                  >
                    {step > wizardStep.id ? <Check className="h-4 w-4" /> : wizardStep.id}
                  </div>
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${
                      step === wizardStep.id ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {wizardStep.label}
                  </span>
                </button>
                {!isLast && (
                  <div className="flex-1 h-1 mx-3 rounded-full bg-border relative overflow-hidden min-w-8">
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-primary rounded-full"
                      initial={false}
                      animate={{ width: step > wizardStep.id ? "100%" : "0%" }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="space-y-4"
            >
              <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
                {showActions && (
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Strategy Name</Label>
                    <Input
                      value={strategyName}
                      onChange={(e) => setStrategyName(e.target.value)}
                      placeholder="My Mean Reversion Strategy"
                      className="bg-secondary/50 border-border/50 h-9 max-w-sm"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Position Side
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 cursor-help hover:text-foreground transition-colors" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">LONG profits on rising prices, SHORT on falling prices.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <div className="flex gap-2">
                    {Object.keys(registry.commands.COMMANDS).map((commandSide) => (
                      <button
                        key={commandSide}
                        type="button"
                        onClick={() => setSide(commandSide)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-all ${
                          side === commandSide
                            ? commandSide === "LONG"
                              ? "bg-success/10 border-success/40 text-success"
                              : "bg-destructive/10 border-destructive/40 text-destructive"
                            : "bg-secondary/30 border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        {commandSide === "LONG" ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                        {commandSide}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-dashed border-border/50 bg-secondary/10">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Load existing strategy</p>
                      <p className="text-xs text-muted-foreground">Pull in saved logic and continue from this wizard.</p>
                    </div>
                  </div>
                  <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="gap-2" disabled={!user}>
                        <FolderOpen className="h-4 w-4" />
                        Load Strategy
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>Load Saved Strategy</DialogTitle>
                        <DialogDescription>Select one strategy to load into this 5-step form.</DialogDescription>
                      </DialogHeader>
                      <ScrollArea className="h-[300px] mt-4">
                        {savedStrategies.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
                            <p>No saved strategies found</p>
                          </div>
                        ) : (
                          <div className="space-y-2 pr-4">
                            {savedStrategies.map((saved) => (
                              <button
                                key={saved.id}
                                type="button"
                                onClick={() => loadStrategyFromDsl(saved)}
                                className="w-full p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all"
                              >
                                <div className="font-medium">{saved.name}</div>
                                <div className="text-xs text-muted-foreground mt-1">Created {formatRelativeDate(saved.createdAt)}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="space-y-4"
            >
              <div className="rounded-xl border-2 border-success/30 bg-success/5 overflow-hidden">
                <div className="px-4 py-3 bg-success/10 flex items-center gap-2">
                  <Target className="h-4 w-4 text-success" />
                  <span className="font-semibold text-sm text-success">OPEN Conditions and Parameters</span>
                </div>
                <div className="p-4 space-y-4">
                  <MultiConditionBuilder
                    blockName="OPEN"
                    conditionGroup={conditionGroups.OPEN}
                    setConditionGroup={(group) => setConditionGroups((prev) => ({ ...prev, OPEN: group }))}
                    registry={registry}
                  />
                  <div className="space-y-3 pt-3 border-t border-border/30">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Risk Management</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="takeProfitPercent" className="text-xs text-muted-foreground">
                          Take Profit %
                        </Label>
                        <Input
                          id="takeProfitPercent"
                          type="number"
                          min="0"
                          step="0.1"
                          value={takeProfitPercent}
                          onChange={(e) => setTakeProfitPercent(numberInputValue(e.currentTarget.valueAsNumber))}
                          className="bg-secondary/50 border-border/50 h-9"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="stopLossPercent" className="text-xs text-muted-foreground">
                          Stop Loss %
                        </Label>
                        <Input
                          id="stopLossPercent"
                          type="number"
                          min="0"
                          step="0.1"
                          value={stopLossPercent}
                          onChange={(e) => setStopLossPercent(numberInputValue(e.currentTarget.valueAsNumber))}
                          className="bg-secondary/50 border-border/50 h-9"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="spread" className="text-xs text-muted-foreground">
                          Spread %
                        </Label>
                        <Input
                          id="spread"
                          type="number"
                          min="0"
                          step="0.001"
                          value={spread}
                          onChange={(e) => setSpread(numberInputValue(e.currentTarget.valueAsNumber))}
                          className="bg-secondary/50 border-border/50 h-9"
                        />
                      </div>
                    </div>
                  </div>
                  {Object.keys(allowedArgs.OPEN || {}).length > 0 && (
                    <div className="space-y-3 pt-3 border-t border-border/30">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Open Parameters</Label>
                      <ArgumentSelector
                        block="OPEN"
                        availableArgs={allowedArgs.OPEN || {}}
                        currentArgs={openArgs}
                        onChange={(arg, val) => updateArgument("OPEN", arg, val)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="space-y-4"
            >
              <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 overflow-hidden">
                <div className="px-4 py-3 bg-destructive/10 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-destructive" />
                  <span className="font-semibold text-sm text-destructive">CLOSE Conditions and Parameters</span>
                </div>
                <div className="p-4 space-y-4">
                  <MultiConditionBuilder
                    blockName="CLOSE"
                    conditionGroup={conditionGroups.CLOSE}
                    setConditionGroup={(group) => setConditionGroups((prev) => ({ ...prev, CLOSE: group }))}
                    registry={registry}
                  />
                  {Object.keys(allowedArgs.CLOSE || {}).length > 0 && (
                    <div className="space-y-3 pt-3 border-t border-border/30">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Close Parameters</Label>
                      <ArgumentSelector
                        block="CLOSE"
                        availableArgs={allowedArgs.CLOSE || {}}
                        currentArgs={closeArgs}
                        onChange={(arg, val) => updateArgument("CLOSE", arg, val)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="space-y-4"
            >
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
                          <p className="text-xs">Enter symbols such as AAPL, MSFT, TSLA.</p>
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
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTicker(i)}
                            className="h-9 w-9 hover:bg-destructive/20 hover:text-destructive"
                          >
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

              <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-primary" />
                  Timing
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Execution Timeframe</Label>
                  <Select value={executionTF} onValueChange={setExecutionTF}>
                    <SelectTrigger className="w-32 bg-secondary/50 border-border/50 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                        <SelectItem key={tf} value={tf}>
                          {tf}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    Date Range
                  </Label>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "1M", months: 1 },
                      { label: "3M", months: 3 },
                      { label: "6M", months: 6 },
                      { label: "1Y", months: 12 },
                      { label: "2Y", months: 23 },
                    ].map((preset) => {
                      const presetEnd = new Date();
                      const presetStart = new Date();
                      presetStart.setMonth(presetStart.getMonth() - preset.months);
                      const presetStartStr = presetStart.toISOString().split("T")[0];
                      const presetEndStr = presetEnd.toISOString().split("T")[0];
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
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              key="step5"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="space-y-4"
            >
              <div className="p-5 rounded-xl border border-border bg-card/30 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Account
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Initial Balance ($)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(parseFloat(e.target.value) || 10000)}
                    className="bg-secondary/50 border-border/50 h-9 w-full max-w-[220px]"
                    placeholder="10000"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5">
                <p className="text-sm font-medium">{strategyName || "Unnamed Strategy"}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {side} • {conditionGroups.OPEN?.conditions.length || 0} open conditions •{" "}
                  {conditionGroups.CLOSE?.conditions.length || 0} close conditions • {tickers.filter(Boolean).join(", ")}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="button" variant="outline" className="h-12 px-6" onClick={goBack} disabled={step === 1}>
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back
          </Button>

          {step < 5 && (
            <Button type="button" variant="hero" className="flex-1 h-12 text-base" onClick={goNext} disabled={!canGoNext()}>
              Next
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          )}

          {showActions && step === 5 && (
            <>
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
                    <DialogDescription>Save this strategy setup for reuse and iteration.</DialogDescription>
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
            </>
          )}
        </div>
      </form>
    </motion.div>
  );
};

export default BacktestForm;
