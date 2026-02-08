import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  ConditionSide, 
  SingleCondition, 
  ConditionGroup, 
  Registry, 
  generateId, 
  createDefaultCondition 
} from "./backtest-types";

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
      base = `${base}${side.operation.operator}${side.operation.operand}`;
    }
    
    return base;
  };
  
  const groupStrings = groups.map(group => {
    const condStrings = group.map(cond => 
      `${formatSideLabel(cond.left)} ${cond.operator} ${formatSideLabel(cond.right)}`
    );
    return group.length > 1 ? `(${condStrings.join(" AND ")})` : condStrings[0];
  });
  
  return groupStrings.join(" OR ");
};

// Multi-Condition Builder Component
export function MultiConditionBuilder({
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
      conditions: conditionGroup.conditions.map((c) => (c.id === id ? updated : c)),
    });
  };

  const removeCondition = (id: string) => {
    setConditionGroup({
      conditions: conditionGroup.conditions.filter((c) => c.id !== id),
    });
  };

  const toggleConditionOperator = (id: string) => {
    setConditionGroup({
      conditions: conditionGroup.conditions.map((c) =>
        c.id === id ? { ...c, nextLogicalOperator: c.nextLogicalOperator === "AND" ? "OR" : "AND" } : c
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
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`rounded-lg border ${
                visualGroups.length > 1
                  ? "bg-secondary/30 border-border/50 p-2"
                  : "bg-transparent border-transparent p-0"
              }`}
            >
              {group.map((cond, condIndex) => {
                const showAndBadge = condIndex < group.length - 1;

                return (
                  <div key={cond.id}>
                    <ConditionRow
                      condition={cond}
                      onChange={(updated) => updateCondition(cond.id, updated)}
                      onRemove={() => removeCondition(cond.id)}
                      registry={registry}
                      accentColor={isOpen ? "success" : "destructive"}
                    />
                    
                    {showAndBadge && (
                      <div className="flex items-center justify-center py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleConditionOperator(cond.id)}
                          className="px-3 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer hover:scale-105 bg-primary/10 text-primary border border-primary/30"
                        >
                          AND
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </motion.div>
          ))}

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
