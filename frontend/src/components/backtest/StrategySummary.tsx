interface Props {
    dsl: any;
  }
  
  // Case-insensitive key lookup
  const pick = (obj: any, ...keys: string[]): any => {
    if (!obj || typeof obj !== "object") return undefined;
    const map: Record<string, string> = {};
    for (const k of Object.keys(obj)) map[k.toLowerCase()] = k;
    for (const k of keys) {
      const real = map[k.toLowerCase()];
      if (real !== undefined) return obj[real];
    }
    return undefined;
  };
  
  const fmtSide = (side: any): string => {
    if (side == null) return "?";
    if (typeof side === "number" || typeof side === "string") return String(side);
    const func = pick(side, "func", "function", "name", "indicator");
    if (func) {
      const args = pick(side, "arg", "args", "params", "parameters") || {};
      const parts = Object.entries(args)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`);
      return parts.length ? `${func}(${parts.join(", ")})` : String(func);
    }
    const v = pick(side, "value", "val", "constant");
    if (v !== undefined) return String(v);
    return JSON.stringify(side);
  };
  
  const conditionsToText = (conds: any): string[] => {
    if (!conds) return [];
    let list: any[];
    if (Array.isArray(conds)) {
      list = conds;
    } else if (pick(conds, "conditions")) {
      list = pick(conds, "conditions");
    } else if (pick(conds, "left") !== undefined || pick(conds, "operator") !== undefined) {
      // single inline condition object
      list = [conds];
    } else {
      list = [];
    }
    return list.map((c, i) => {
      const op = pick(c, "operator", "op", "comparator") || "?";
      const line = `${fmtSide(pick(c, "left"))} ${op} ${fmtSide(pick(c, "right"))}`;
      const joiner =
        i < list.length - 1
          ? ` ${pick(list[i], "nextLogicalOperator", "logical", "join") || "AND"}`
          : "";
      return line + joiner;
    });
  };
  
  const argsToText = (args: any): string[] => {
    if (!args || typeof args !== "object") return [];
    return Object.entries(args)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`);
  };
  
  const Section = ({ title, block, color }: { title: string; block: any; color: string }) => {
    if (!block) return null;
    const open = pick(block, "OPEN", "open", "entry");
    const close = pick(block, "CLOSE", "close", "exit");
    const entryConds = conditionsToText(pick(open, "CONDITIONS", "conditions"));
    const exitConds = conditionsToText(pick(close, "CONDITIONS", "conditions"));
    const entryArgs = argsToText(pick(open, "ARGUMENTS", "arguments"));
  
    return (
      <div className="space-y-2">
        <div className={`text-xs font-semibold uppercase tracking-wide ${color}`}>{title}</div>
        {entryConds.length > 0 && (
          <div className="text-xs">
            <span className="text-muted-foreground">Enter when: </span>
            <span className="text-foreground">{entryConds.join(" ")}</span>
          </div>
        )}
        {exitConds.length > 0 && (
          <div className="text-xs">
            <span className="text-muted-foreground">Exit when: </span>
            <span className="text-foreground">{exitConds.join(" ")}</span>
          </div>
        )}
        {entryArgs.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Settings: <span className="text-foreground">{entryArgs.join(" · ")}</span>
          </div>
        )}
      </div>
    );
  };
  
  const StrategySummary = ({ dsl }: Props) => {
    if (!dsl || typeof dsl !== "object") {
      return <div className="text-xs text-muted-foreground">No strategy parsed yet.</div>;
    }
  
    const longBlock = pick(dsl, "LONG", "long");
    const shortBlock = pick(dsl, "SHORT", "short");
  
    // Context can live at root, under CONTEXT, or nested inside LONG/SHORT
    const ctx =
      pick(dsl, "CONTEXT", "context") ||
      pick(longBlock, "CONTEXT", "context") ||
      pick(shortBlock, "CONTEXT", "context") ||
      dsl;
    const tickers = pick(ctx, "tickers", "TICKER", "ticker", "symbols") || pick(dsl, "tickers");
    const execTf = pick(ctx, "execution_timeframe", "EXECUTION_TIMEFRAME", "executionTimeframe");
    const dataTfs = pick(ctx, "data_timeframes", "DATA_TIMEFRAMES", "dataTimeframes");
    const dateframe = pick(ctx, "dateframe", "DATEFRAME", "dateRange") || {};
    const start = pick(dateframe, "start", "from");
    const end = pick(dateframe, "end", "to");
  
    const facts: string[] = [];
    if (tickers) facts.push(`Tickers: ${Array.isArray(tickers) ? tickers.join(", ") : tickers}`);
    if (execTf) facts.push(`Timeframe: ${execTf}`);
    if (dataTfs) facts.push(`Data: ${Array.isArray(dataTfs) ? dataTfs.join(", ") : dataTfs}`);
    if (start || end) facts.push(`Dates: ${start || "?"} → ${end || "?"}`);
  
    return (
      <div className="space-y-3 p-3 rounded border border-border bg-background/40">
        {facts.length > 0 && (
          <div className="text-xs text-muted-foreground">{facts.join(" · ")}</div>
        )}
        {longBlock && <Section title="Long" block={longBlock} color="text-green-500" />}
        {shortBlock && <Section title="Short" block={shortBlock} color="text-red-500" />}
        {!longBlock && !shortBlock && (
          <div className="text-xs text-muted-foreground">
            Couldn't recognize this strategy shape — open "View raw JSON" below to inspect.
          </div>
        )}
      </div>
    );
  };
  
  export default StrategySummary;