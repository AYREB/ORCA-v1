import { useEffect, useMemo, useState } from "react";
import { Play, Loader2, X, CheckCircle2, AlertCircle, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TickerCombobox, TimeframeSelect } from "./MarketSelectors";
import { useRegistry, availableTimeframesFor } from "@/context/RegistryContext";
import { earliestStartFor, todayISO } from "@/lib/inputSanity";

interface Props {
  dsl: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onRun: () => void;
  isRunning: boolean;
  warnings?: string[];
}

// case-insensitive key lookup, returns the actual key name in the object
const findKey = (obj: any, ...keys: string[]): string | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const lower: Record<string, string> = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = k;
  for (const k of keys) {
    const real = lower[k.toLowerCase()];
    if (real !== undefined) return real;
  }
  return undefined;
};
const pick = (obj: any, ...keys: string[]): any => {
  const k = findKey(obj, ...keys);
  return k === undefined ? undefined : obj[k];
};

// Deep-clone via JSON (DSL is plain JSON)
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const fmtSide = (side: any): string => {
  if (side == null) return "?";
  if (typeof side === "number" || typeof side === "string") return String(side);
  const func = pick(side, "func", "function", "name", "indicator");
  if (func) {
    const args = pick(side, "arg", "args", "params", "parameters") || {};
    const parts = Object.entries(args)
      .filter(([k, v]) => v !== null && v !== undefined && v !== "" && k !== "timeframe" && k !== "offset")
      .map(([, v]) => `${v}`);
    return parts.length ? `${func}(${parts.join(", ")})` : String(func);
  }
  const v = pick(side, "value", "val", "constant");
  if (v !== undefined) return String(v);
  return JSON.stringify(side);
};

const conditionsToText = (conds: any): string => {
  if (!conds) return "";
  let list: any[];
  if (Array.isArray(conds)) list = conds;
  else if (pick(conds, "conditions")) list = pick(conds, "conditions");
  else if (pick(conds, "left") !== undefined || pick(conds, "operator") !== undefined) list = [conds];
  else list = [];
  return list
    .map((c, i) => {
      const op = pick(c, "operator", "op", "comparator") || "?";
      const line = `${fmtSide(pick(c, "left"))} ${op} ${fmtSide(pick(c, "right"))}`;
      const joiner =
        i < list.length - 1
          ? ` ${pick(c, "nextLogicalOperator", "logical", "join") || "AND"} `
          : "";
      return line + joiner;
    })
    .join("");
};

const EditableStrategyCard = ({ dsl, onChange, onRun, isRunning, warnings = [] }: Props) => {
  const { tickers: registryTickers, timeframes: registryTimeframes } = useRegistry();
  // Determine direction block
  const longKey = findKey(dsl, "LONG", "long");
  const shortKey = findKey(dsl, "SHORT", "short");
  const dirKey = longKey || shortKey;
  const direction: "LONG" | "SHORT" = longKey ? "LONG" : "SHORT";
  const block: any = dirKey ? (dsl as any)[dirKey] : null;

  // Locate context
  const ctxParent =
    findKey(block || {}, "CONTEXT", "context") ? block :
    findKey(dsl, "CONTEXT", "context") ? dsl : block || dsl;
  const ctxKey = findKey(ctxParent, "CONTEXT", "context");
  const ctx: any = ctxKey ? ctxParent[ctxKey] : ctxParent;

  const tickersKey = findKey(ctx, "tickers", "ticker", "symbols");
  const tickersRaw = tickersKey ? ctx[tickersKey] : [];
  const tickers: string[] = Array.isArray(tickersRaw)
    ? tickersRaw
    : tickersRaw
    ? [String(tickersRaw)]
    : [];

  const tfKey = findKey(ctx, "execution_timeframe", "executionTimeframe");
  const timeframe: string = (tfKey ? ctx[tfKey] : "") || "1D";

  const dfKey = findKey(ctx, "dateframe", "dateRange");
  const dateframe = (dfKey ? ctx[dfKey] : {}) || {};
  const startKey = findKey(dateframe, "start", "from") || "start";
  const endKey = findKey(dateframe, "end", "to") || "end";
  const startDate: string = dateframe[startKey] || "";
  const endDate: string = dateframe[endKey] || "";

  // TP/SL — search in block, open, open.ARGUMENTS, or root
  const openKey = block ? findKey(block, "OPEN", "open", "entry") : undefined;
  const openBlock = openKey ? block[openKey] : undefined;
  const argsKey = openBlock ? findKey(openBlock, "ARGUMENTS", "arguments") : undefined;
  const argsObj = argsKey ? openBlock[argsKey] : undefined;

  const findTpSlContainer = (): { obj: any; tpKey?: string; slKey?: string } => {
    const candidates = [argsObj, openBlock, block, dsl].filter(Boolean);
    for (const c of candidates) {
      const tpK = findKey(c, "takeProfitPercent", "take_profit_percent", "takeProfit", "tp");
      const slK = findKey(c, "stopLossPercent", "stop_loss_percent", "stopLoss", "sl");
      if (tpK || slK) return { obj: c, tpKey: tpK, slKey: slK };
    }
    return { obj: argsObj || openBlock || block || dsl };
  };
  const tpSl = findTpSlContainer();
  const tpKey = tpSl.tpKey || "takeProfitPercent";
  const slKey = tpSl.slKey || "stopLossPercent";
  const tpVal = tpSl.obj?.[tpKey];
  const slVal = tpSl.obj?.[slKey];

  // Transaction costs (injected from the user's defaults; editable here so
  // nothing about the backtest's pricing is hidden).
  const feeModeVal: "commission" | "spread" =
    argsObj?.fee_mode === "spread" || (argsObj?.spread !== undefined && argsObj?.fee_value === undefined)
      ? "spread"
      : "commission";
  const feeValueVal = Number(argsObj?.fee_value ?? argsObj?.spread ?? 0) || 0;
  const feeFixedVal = Number(argsObj?.fee_fixed ?? 0) || 0;

  // Conditions (read-only)
  const closeKey = block ? findKey(block, "CLOSE", "close", "exit") : undefined;
  const closeBlock = closeKey ? block[closeKey] : undefined;
  const openCondsKey = openBlock ? findKey(openBlock, "CONDITIONS", "conditions") : undefined;
  const closeCondsKey = closeBlock ? findKey(closeBlock, "CONDITIONS", "conditions") : undefined;
  const openCondsText = conditionsToText(openCondsKey ? openBlock[openCondsKey] : undefined);
  const closeCondsText = conditionsToText(closeCondsKey ? closeBlock[closeCondsKey] : undefined);

  // Percent text inputs (local state so the user can clear the field).
  // TP/SL are stored as WHOLE numbers in the DSL (10 = 10%) — no scaling.
  const [tpText, setTpText] = useState<string>(
    tpVal !== undefined && tpVal !== null ? String(Number(tpVal)) : ""
  );
  const [slText, setSlText] = useState<string>(
    slVal !== undefined && slVal !== null ? String(Number(slVal)) : ""
  );

  // Resync the text fields when a NEW strategy arrives (the component stays
  // mounted between parses). Skips overwriting while the user is typing by
  // only syncing when the numeric values actually differ.
  useEffect(() => {
    const incoming = tpVal === undefined || tpVal === null ? null : Number(tpVal);
    const current = parseFloat(tpText);
    if (incoming === null) return;
    if (isNaN(current) || current !== incoming) setTpText(String(incoming));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpVal]);
  useEffect(() => {
    const incoming = slVal === undefined || slVal === null ? null : Number(slVal);
    const current = parseFloat(slText);
    if (incoming === null) return;
    if (isNaN(current) || current !== incoming) setSlText(String(incoming));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slVal]);

  const unknownTickers = useMemo(
    () => tickers.filter((t) => !registryTickers[t]),
    [tickers, registryTickers],
  );
  const availableTfs = useMemo(
    () => availableTimeframesFor(tickers, registryTickers, registryTimeframes),
    [tickers, registryTickers, registryTimeframes],
  );
  const [tfNote, setTfNote] = useState<string>("");

  // Auto-switch timeframe if the parsed one isn't supported by the selected tickers
  useEffect(() => {
    if (availableTfs.length === 0) return;
    if (!availableTfs.includes(timeframe)) {
      const next = availableTfs[0];
      setTfNote(
        `Switched to ${registryTimeframes[next] || next} — ${timeframe} isn't available for the selected ticker(s).`,
      );
      setTimeframe(next);
    } else {
      setTfNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTfs.join(","), timeframe]);

  // Mutators all clone -> mutate -> onChange
  const update = (mutator: (d: any) => void) => {
    const next = clone(dsl);
    mutator(next);
    onChange(next);
  };

  const getCtx = (root: any) => {
    const dKey = findKey(root, "LONG", "long", "SHORT", "short")!;
    const blk = root[dKey];
    const cParent = findKey(blk || {}, "CONTEXT", "context") ? blk : findKey(root, "CONTEXT", "context") ? root : blk || root;
    const cKey = findKey(cParent, "CONTEXT", "context");
    return cKey ? cParent[cKey] : cParent;
  };

  const setTickers = (next: string[]) =>
    update((d) => {
      const c = getCtx(d);
      const k = findKey(c, "tickers", "ticker", "symbols") || "tickers";
      c[k] = next;
    });

  const removeTicker = (t: string) => setTickers(tickers.filter((x) => x !== t));

  const setTimeframe = (tf: string) =>
    update((d) => {
      const c = getCtx(d);
      const k = findKey(c, "execution_timeframe", "executionTimeframe") || "execution_timeframe";
      c[k] = tf;
    });

  const setStart = (v: string) =>
    update((d) => {
      const c = getCtx(d);
      const dk = findKey(c, "dateframe", "dateRange") || "dateframe";
      if (!c[dk] || typeof c[dk] !== "object") c[dk] = {};
      const sk = findKey(c[dk], "start", "from") || "start";
      c[dk][sk] = v;
    });

  const setEnd = (v: string) =>
    update((d) => {
      const c = getCtx(d);
      const dk = findKey(c, "dateframe", "dateRange") || "dateframe";
      if (!c[dk] || typeof c[dk] !== "object") c[dk] = {};
      const ek = findKey(c[dk], "end", "to") || "end";
      c[dk][ek] = v;
    });

  const setTpSl = (which: "tp" | "sl", percent: number | null) =>
    update((d) => {
      const dKey = findKey(d, "LONG", "long", "SHORT", "short");
      const blk = dKey ? d[dKey] : d;
      const oKey = blk ? findKey(blk, "OPEN", "open", "entry") : undefined;
      const oBlk = oKey ? blk[oKey] : undefined;
      const aKey = oBlk ? findKey(oBlk, "ARGUMENTS", "arguments") : undefined;
      let target: any = aKey ? oBlk[aKey] : undefined;
      if (!target) {
        // create ARGUMENTS in open block if possible
        if (oBlk) {
          if (!oBlk.ARGUMENTS) oBlk.ARGUMENTS = {};
          target = oBlk.ARGUMENTS;
        } else {
          target = blk || d;
        }
      }
      const key = which === "tp" ? tpKey : slKey;
      // Stored as whole-number percent (10 = 10%) — the backtester divides
      // by 100 itself. Storing percent/100 here silently turned an edited
      // "10% stop loss" into 0.1%.
      if (percent === null) delete target[key];
      else target[key] = percent;
    });

  const setFee = (field: "fee_mode" | "fee_value" | "fee_fixed", value: string | number) =>
    update((d) => {
      const dKey = findKey(d, "LONG", "long", "SHORT", "short");
      const blk = dKey ? d[dKey] : d;
      const oKey = blk ? findKey(blk, "OPEN", "open", "entry") : undefined;
      const oBlk = oKey ? blk[oKey] : undefined;
      if (!oBlk) return;
      if (!oBlk.ARGUMENTS) oBlk.ARGUMENTS = {};
      const args = oBlk.ARGUMENTS;
      delete args.spread; // migrate legacy key if present
      args[field] = value;
      if (args.fee_mode === undefined) args.fee_mode = feeModeVal;
      if (args.fee_value === undefined) args.fee_value = feeValueVal;
    });

  const setDirection = (dir: "LONG" | "SHORT") =>
    update((d) => {
      const curKey = findKey(d, "LONG", "long", "SHORT", "short");
      if (!curKey) return;
      if (curKey.toUpperCase() === dir) return;
      const blk = d[curKey];
      delete d[curKey];
      d[dir] = blk;
    });

  return (
    <Card className="p-5 bg-card/50 border-primary/20">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15">
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Your Strategy</h3>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Check the details, tweak anything, then run
            </p>
          </div>
          <Badge
            variant="outline"
            className={`ml-1 text-[10px] font-bold ${
              direction === "LONG"
                ? "border-green-500/40 text-green-500 bg-green-500/10"
                : "border-red-500/40 text-red-500 bg-red-500/10"
            }`}
          >
            {direction}
          </Badge>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Button
            onClick={onRun}
            disabled={isRunning || tickers.length === 0}
            size="sm"
            className="shadow-sm"
          >
            {isRunning ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Running...</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-2" />Run Backtest</>
            )}
          </Button>
          {tickers.length === 0 && (
            <span className="text-[10px] text-yellow-500">Add at least one ticker</span>
          )}
        </div>
      </div>

      {/* Strategy logic — first, because verifying what the AI understood
          matters more than any editable field */}
      {(openCondsText || closeCondsText) && (
        <div className="mb-4 rounded-lg border border-border bg-background/50 divide-y divide-border/60">
          {openCondsText && (
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <LogIn className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500" />
              <div className="text-xs leading-relaxed">
                <span className="font-medium text-green-500">Enter</span>
                <span className="text-muted-foreground"> when </span>
                <span className="font-mono text-[11px] text-foreground">{openCondsText}</span>
              </div>
            </div>
          )}
          {closeCondsText && (
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <LogOut className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-500" />
              <div className="text-xs leading-relaxed">
                <span className="font-medium text-red-500">Exit</span>
                <span className="text-muted-foreground"> when </span>
                <span className="font-mono text-[11px] text-foreground">{closeCondsText}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-xs space-y-1">
          <div className="font-medium text-yellow-500 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            Heads up
          </div>
          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tickers */}
        <div className="md:col-span-2 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tickers</Label>
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded border border-border bg-background/40 min-h-[38px]">
            {tickers.map((t) => {
              const known = !!registryTickers[t];
              return (
                <span
                  key={t}
                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${
                    known
                      ? "bg-primary/15 border-primary/30 text-foreground"
                      : "bg-yellow-500/10 border-yellow-500/40 text-yellow-500"
                  }`}
                  title={known ? registryTickers[t].name : "Not in registry"}
                >
                  {t}
                  {known && (
                    <span className="text-muted-foreground font-normal">
                      · {registryTickers[t].name}
                    </span>
                  )}
                  <button
                    onClick={() => removeTicker(t)}
                    className="hover:text-destructive"
                    aria-label={`Remove ${t}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <TickerCombobox
              value=""
              onChange={(v) => {
                if (v && !tickers.includes(v)) setTickers([...tickers, v]);
              }}
              exclude={tickers}
              placeholder="Add ticker…"
              className="h-7 w-40 text-[11px]"
            />
          </div>
          {unknownTickers.length > 0 && (
            <p className="text-[10px] text-yellow-500">
              Not in registry: {unknownTickers.join(", ")}
            </p>
          )}
        </div>

        {/* Timeframe */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Timeframe</Label>
          <TimeframeSelect
            value={timeframe}
            onChange={setTimeframe}
            tickers={tickers}
            className="h-8 text-xs bg-background/40"
          />
          {tfNote && <p className="text-[10px] text-yellow-500">{tfNote}</p>}
        </div>

        {/* Direction */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Direction</Label>
          <div className="flex rounded border border-border overflow-hidden bg-background/40 h-8">
            {(["LONG", "SHORT"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`flex-1 text-[11px] font-medium transition-colors ${
                  direction === d
                    ? d === "LONG"
                      ? "bg-green-500/20 text-green-500"
                      : "bg-red-500/20 text-red-500"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Dates */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Start date</Label>
          <Input
            type="date"
            min={earliestStartFor(timeframe)}
            max={endDate || todayISO()}
            value={startDate}
            onChange={(e) => setStart(e.target.value)}
            className="h-8 text-xs bg-background/40"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">End date</Label>
          <Input
            type="date"
            min={startDate || earliestStartFor(timeframe)}
            max={todayISO()}
            value={endDate}
            onChange={(e) => setEnd(e.target.value)}
            className="h-8 text-xs bg-background/40"
          />
        </div>

        {/* TP / SL */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Take Profit <span className="text-green-500/80">(lock in gains)</span>
          </Label>
          <div className="relative">
            <Input
              type="number"
              step="0.1"
              min="0"
              value={tpText}
              onChange={(e) => {
                setTpText(e.target.value);
                const n = parseFloat(e.target.value);
                setTpSl("tp", isNaN(n) ? null : n);
              }}
              placeholder="e.g. 15"
              className="h-8 text-xs bg-background/40 pr-7"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Stop Loss <span className="text-red-500/80">(cap losses)</span>
          </Label>
          <div className="relative">
            <Input
              type="number"
              step="0.1"
              min="0"
              value={slText}
              onChange={(e) => {
                setSlText(e.target.value);
                const n = parseFloat(e.target.value);
                setTpSl("sl", isNaN(n) ? null : n);
              }}
              placeholder="e.g. 10"
              className="h-8 text-xs bg-background/40 pr-7"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
          </div>
        </div>

        {/* Transaction costs — pre-filled from the user's Settings defaults */}
        <div className="md:col-span-2 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Transaction Costs</Label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded border border-border overflow-hidden bg-background/40 h-8">
              {(["commission", "spread"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFee("fee_mode", m)}
                  className={`px-3 text-[11px] font-medium transition-colors ${
                    feeModeVal === m
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {m === "commission" ? "Commission" : "Spread"}
                </button>
              ))}
            </div>
            <div className="relative w-24">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={feeValueVal}
                onChange={(e) => setFee("fee_value", Math.max(0, parseFloat(e.target.value) || 0))}
                className="h-8 text-xs bg-background/40 pr-7"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
            </div>
            <span className="text-xs text-muted-foreground/60">+</span>
            <div className="relative w-24">
              <Input
                type="number"
                step="0.5"
                min="0"
                value={feeFixedVal}
                onChange={(e) => setFee("fee_fixed", Math.max(0, parseFloat(e.target.value) || 0))}
                className="h-8 text-xs bg-background/40 pl-6"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
            </div>
            <span className="text-[11px] text-muted-foreground/60">per order</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Applied on entry and exit, from your defaults in Settings — tweak here for this run.
          </p>
        </div>
      </div>
    </Card>
  );
};

export default EditableStrategyCard;