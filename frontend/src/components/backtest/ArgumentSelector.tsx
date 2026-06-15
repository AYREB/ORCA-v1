import { useState } from "react";
import { Info, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Argument Selector Component with parent-child support
export function ArgumentSelector({
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

  // Display name and option labels come from the registry; fall back to the raw id.
  const labelOf = (arg: string) => availableArgs[arg]?.label || arg;
  const optionLabelOf = (arg: string, option: string) =>
    availableArgs[arg]?.optionLabels?.[option] || option;

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

  // Filter out trade settings args from OPEN block since they're managed by Risk Management.
  const hiddenArgs = [
    "takeProfitPercent",
    "stopLossPercent",
    "spread",
    "fee_mode",
    "fee_value",
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
        <span className="flex flex-1 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {isChild && <span className="text-primary/50">↳</span>}
          <span className="truncate">{labelOf(arg)}</span>
          {argData.description && (
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 shrink-0 cursor-help text-muted-foreground/60 hover:text-primary" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[280px] text-xs">
                {argData.description}
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        {valType === "boolean" ? (
          <Select value={String(val)} onValueChange={(v) => onChange(arg, v === "true")}>
            <SelectTrigger className="w-24 h-7 text-xs bg-secondary/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Enabled</SelectItem>
              <SelectItem value="false">Disabled</SelectItem>
            </SelectContent>
          </Select>
        ) : argData.options ? (
          <Select value={val} onValueChange={(v) => onChange(arg, v)}>
            <SelectTrigger className="w-44 h-7 text-xs bg-secondary/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {argData.options.map((opt: string) => (
                <SelectItem key={opt} value={opt}>{optionLabelOf(arg, opt)}</SelectItem>
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
        <Select onValueChange={addArg} value="">
          <SelectTrigger className="w-full h-8 text-xs bg-secondary/30 border-dashed">
            <SelectValue placeholder="+ Add parameter..." />
          </SelectTrigger>
          <SelectContent>
            {topLevelArgs.filter((a) => !addedArgs.includes(a)).map((arg) => (
              <SelectItem key={arg} value={arg} className="py-2">
                <div className="flex flex-col items-start gap-0.5 text-left">
                  <span className="text-xs font-medium">{labelOf(arg)}</span>
                  {availableArgs[arg]?.description && (
                    <span className="max-w-[320px] whitespace-normal text-[11px] leading-snug text-muted-foreground">
                      {availableArgs[arg].description}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
