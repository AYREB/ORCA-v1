import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getParamDomain } from "@/lib/paramDomains";

// Loosely-typed so it works with each optimizer's ParameterChoice shape.
export interface OptParam {
  enabled?: boolean;
  start?: number;
  end?: number;
  steps?: number;
  indicator?: string | null;
  [k: string]: unknown;
}

interface Props {
  paramChoices: Record<string, OptParam>;
  getDisplayName: (param: string, indicator: string | null) => string;
  onToggle: (param: string, enabled: boolean) => void;
  onRangeChange: (param: string, field: "start" | "end" | "steps", value: number) => void;
}

function RangeField({
  label,
  tip,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  tip: string;
  value: number | undefined;
  placeholder: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <Info className="h-2.5 w-2.5 cursor-help text-muted-foreground/50 hover:text-primary" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px] text-xs">
            {tip}
          </TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 h-8 bg-secondary border-border font-mono text-xs"
      />
    </div>
  );
}

/**
 * Shared parameter picker for the optimizers: choose which strategy parameters to
 * search, and (optionally) the exact range. Explains Auto vs. a manual range so
 * users understand what each field does.
 */
export function OptimizerParameterList({ paramChoices, getDisplayName, onToggle, onRangeChange }: Props) {
  const entries = Object.entries(paramChoices);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        No optimizable parameters found in this strategy. Add indicators with numeric settings (e.g. an SMA period) to
        optimize.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
        Tick the parameters you want the optimizer to tune. Leave a parameter on{" "}
        <span className="font-semibold text-primary">Auto</span> and it picks a sensible search range for you — or set{" "}
        <span className="font-semibold text-foreground">From / To / Steps</span> to define your own. Anything unticked is
        left at its current value.
      </div>

      <div className="space-y-2">
        {entries.map(([param, choice]) => {
          const enabled = choice.enabled !== false;
          const domain = getParamDomain(param);
          const hasRange = choice.start !== undefined && choice.end !== undefined && (choice.steps || 0) >= 2;
          const domainHint =
            domain && (domain.min !== undefined || domain.max !== undefined)
              ? ` Valid range ${domain.min ?? "?"}–${domain.max ?? "?"}.`
              : "";
          return (
            <div
              key={param}
              className={`rounded-lg border p-3 transition-colors ${
                enabled ? "border-primary/30 bg-primary/5" : "border-border/50 bg-secondary/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex min-w-0 cursor-pointer items-center gap-2">
                  <Checkbox checked={enabled} onCheckedChange={(v) => onToggle(param, Boolean(v))} />
                  <span className={`truncate font-mono text-sm font-medium ${enabled ? "" : "text-muted-foreground"}`}>
                    {getDisplayName(param, choice.indicator ?? null)}
                  </span>
                </label>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    !enabled
                      ? "bg-secondary/60 text-muted-foreground/60"
                      : hasRange
                        ? "bg-primary/15 text-primary"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {!enabled ? "Skipped" : hasRange ? `${choice.steps} values` : "Auto"}
                </span>
              </div>

              {enabled && (
                <div className="mt-2.5 pl-6">
                  <div className="grid grid-cols-3 gap-2">
                    <RangeField
                      label="From"
                      tip="Smallest value to try."
                      value={choice.start}
                      placeholder="auto"
                      onChange={(v) => onRangeChange(param, "start", v)}
                    />
                    <RangeField
                      label="To"
                      tip="Largest value to try."
                      value={choice.end}
                      placeholder="auto"
                      onChange={(v) => onRangeChange(param, "end", v)}
                    />
                    <RangeField
                      label="Steps"
                      tip="How many evenly-spaced values to test between From and To (minimum 2)."
                      value={choice.steps}
                      placeholder="auto"
                      onChange={(v) => onRangeChange(param, "steps", v)}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    {hasRange
                      ? `Tests ${choice.steps} evenly-spaced values from ${choice.start} to ${choice.end}.`
                      : "On Auto — the optimizer chooses the search range."}
                    {domainHint}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default OptimizerParameterList;
