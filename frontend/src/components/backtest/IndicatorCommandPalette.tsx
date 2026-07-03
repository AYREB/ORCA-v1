import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Hash, Check } from "lucide-react";
import { getParamDomain, clampToDomain, clampIndicatorArgs } from "@/lib/paramDomains";
import {
  Registry,
  ConditionSide,
  INDICATOR_META,
  INDICATOR_CATEGORIES,
} from "./backtest-types";

interface IndicatorCommandPaletteProps {
  registry: Registry;
  onSelect: (side: ConditionSide) => void;
  onCancel: () => void;
  placeholder?: string;
  availableTimeframes?: string[];
  executionTimeframe?: string;
}

export default function IndicatorCommandPalette({
  registry,
  onSelect,
  onCancel,
  placeholder = "Search indicators or type a number...",
  availableTimeframes,
  executionTimeframe,
}: IndicatorCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configArgs, setConfigArgs] = useState<Record<string, any>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const firstArgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (configuring && firstArgRef.current) {
      firstArgRef.current.focus();
      firstArgRef.current.select();
    }
  }, [configuring]);

  const indicators = Object.keys(registry.indicators.INDICATORS);
  const q = query.trim().toLowerCase();

  const filtered = q.length > 0
    ? indicators.filter((ind) => {
        const meta = INDICATOR_META[ind];
        const customMeta = registry.customIndicatorMeta?.[ind];
        return (
          ind.toLowerCase().includes(q) ||
          meta?.description.toLowerCase().includes(q) ||
          meta?.category.toLowerCase().includes(q) ||
          customMeta?.description.toLowerCase().includes(q)
        );
      })
    : indicators;

  const numericValue = parseFloat(query);
  const isNumeric = query.trim().length > 0 && !isNaN(numericValue);

  type Item =
    | { type: "value"; value: number }
    | { type: "indicator"; func: string };

  const items: Item[] = [];
  if (isNumeric) items.push({ type: "value", value: numericValue });

  const grouped: Record<string, string[]> = {};
  for (const ind of filtered) {
    const cat = INDICATOR_META[ind]?.category || (registry.customIndicatorMeta?.[ind] ? "Custom" : "Other");
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(ind);
  }
  for (const cat of INDICATOR_CATEGORIES) {
    if (grouped[cat]) {
      for (const ind of grouped[cat]) {
        items.push({ type: "indicator", func: ind });
      }
    }
  }

  const clampedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));

  const commitIndicator = (func: string, args: Record<string, any>) => {
    onSelect({
      type: "indicator",
      value: 0,
      func,
      args: { ...args },
      operation: undefined,
    });
  };

  const handleSelect = (item: Item) => {
    if (item.type === "value") {
      onSelect({ type: "value", value: item.value, func: "", args: {}, operation: undefined });
    } else {
      const defaults = { ...(registry.indicators.INDICATORS[item.func]?.defaults || {}) };
      const argKeys = registry.indicators.INDICATORS[item.func]?.args || [];
      // Seed the indicator's timeframe from the selected execution timeframe
      // so it matches the chart being traded by default.
      if ("timeframe" in defaults && executionTimeframe) {
        defaults.timeframe = executionTimeframe;
      }
      if (argKeys.length === 0) {
        commitIndicator(item.func, defaults);
      } else {
        setConfiguring(item.func);
        setConfigArgs(defaults);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items.length > 0) {
      e.preventDefault();
      handleSelect(items[clampedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleConfigKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (configuring) commitIndicator(configuring, clampIndicatorArgs(configArgs));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setConfiguring(null);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${clampedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  // ── Args configuration view ──
  if (configuring) {
    const ind = registry.indicators.INDICATORS[configuring];
    const argKeys = ind?.args || [];
    const meta = INDICATOR_META[configuring];
    const customMeta = registry.customIndicatorMeta?.[configuring];

    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.12 }}
        className="rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
      >
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border">
          <span className="font-mono font-semibold text-[11px] text-primary">{configuring}</span>
          <span className="text-[10px] text-muted-foreground">{meta?.description ?? customMeta?.description}</span>
          {customMeta && (
            <span className="text-[8px] uppercase tracking-wide px-1 py-0.5 rounded bg-primary/10 text-primary shrink-0">Custom</span>
          )}
        </div>
        <div className="px-2.5 py-2 flex items-center gap-2 flex-wrap" onKeyDown={handleConfigKeyDown}>
          {argKeys.map((param: string, i: number) => {
            const val = configArgs[param];
            return (
              <div key={param} className="flex items-center gap-1 bg-secondary/40 rounded px-1.5 py-0.5">
                <span className="text-[9px] uppercase text-muted-foreground font-medium">{param}</span>
                {param === "field" || param === "OHLC" ? (
                  <select
                    value={String(val)}
                    onChange={(e) => setConfigArgs({ ...configArgs, [param]: e.target.value })}
                    className="bg-transparent text-[11px] font-mono outline-none w-16 text-foreground"
                  >
                    {["open", "high", "low", "close"].map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : param === "timeframe" ? (
                  <select
                    value={String(val)}
                    onChange={(e) => setConfigArgs({ ...configArgs, [param]: e.target.value })}
                    className="bg-transparent text-[11px] font-mono outline-none w-10 text-foreground"
                  >
                    {(availableTimeframes && availableTimeframes.length > 0
                      ? availableTimeframes
                      : ["1m", "5m", "15m", "1h", "4h", "1d"]
                    ).map((tf) => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={i === 0 ? firstArgRef : undefined}
                    type="number"
                    min={getParamDomain(param)?.min}
                    max={getParamDomain(param)?.max}
                    step={getParamDomain(param)?.integer ? 1 : "any"}
                    value={val as number}
                    onChange={(e) => setConfigArgs({ ...configArgs, [param]: parseFloat(e.target.value) || 0 })}
                    onBlur={() => {
                      const clamped = clampToDomain(Number(val) || 0, getParamDomain(param));
                      if (clamped !== val) setConfigArgs({ ...configArgs, [param]: clamped });
                    }}
                    className="bg-transparent text-[11px] font-mono outline-none w-10 text-foreground"
                  />
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => commitIndicator(configuring, clampIndicatorArgs(configArgs))}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors"
          >
            <Check className="h-2.5 w-2.5" /> Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfiguring(null)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Back
          </button>
        </div>
      </motion.div>
    );
  }

  // ── Main indicator list ──
  let itemIndex = -1;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
      className="rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div ref={listRef} className="max-h-[220px] overflow-y-auto py-0.5">
        {items.length === 0 && (
          <div className="px-3 py-3 text-center text-xs text-muted-foreground">No matches</div>
        )}

        {isNumeric && (() => {
          itemIndex++;
          const idx = itemIndex;
          return (
            <div className="px-1 pb-0.5">
              <div className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Value</div>
              <button
                type="button"
                data-index={idx}
                onClick={() => handleSelect(items[idx])}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors text-xs ${
                  clampedIndex === idx ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                }`}
              >
                <Hash className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono font-medium">{numericValue}</span>
              </button>
            </div>
          );
        })()}

        {INDICATOR_CATEGORIES.map((cat) => {
          if (!grouped[cat]) return null;
          return (
            <div key={cat} className="px-1 pb-0.5">
              <div className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground font-medium">{cat}</div>
              {grouped[cat].map((ind) => {
                itemIndex++;
                const meta = INDICATOR_META[ind];
                const customMeta = registry.customIndicatorMeta?.[ind];
                const currentIdx = itemIndex;
                return (
                  <button
                    type="button"
                    key={ind}
                    data-index={currentIdx}
                    onClick={() => handleSelect(items[currentIdx])}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors text-xs ${
                      clampedIndex === currentIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                    }`}
                  >
                    <span className={`font-mono font-semibold text-[11px] w-14 shrink-0 ${
                      clampedIndex === currentIdx ? "text-accent-foreground" : "text-primary"
                    }`}>{ind}</span>
                    <span className={`text-[11px] truncate ${
                      clampedIndex === currentIdx ? "text-accent-foreground/80" : "text-muted-foreground/70"
                    }`}>{meta?.description ?? customMeta?.description}</span>
                    {customMeta && (
                      <span className={`ml-auto text-[8px] uppercase tracking-wide px-1 py-0.5 rounded shrink-0 ${
                        clampedIndex === currentIdx ? "bg-accent-foreground/15 text-accent-foreground" : "bg-primary/10 text-primary"
                      }`}>Custom</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
