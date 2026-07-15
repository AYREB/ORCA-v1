// Semantic sanity for user-built strategies — frontend mirror of
// backend/core/parsing/inputSanity.py. Keep the two in sync.

// ---------------- indicator output ranges ----------------
// [min, max] of what each indicator can mathematically produce; null = unbounded.
const INDICATOR_RANGES: Record<string, [number | null, number | null]> = {
  RSI: [0, 100],
  STOCH: [0, 100],
  PRICE: [0, null],
  SMA: [0, null],
  EMA: [0, null],
  BBANDS: [0, null],
  ATR: [0, null],
  VOLUME: [0, null],
  // MACD / CCI / OBV are legitimately negative — unbounded, not listed.
};

const OSCILLATORS = new Set(["RSI", "STOCH"]);
const PRICE_SCALE = new Set(["PRICE", "SMA", "EMA", "BBANDS"]);

// ---------------- timeframe history limits (Yahoo) ----------------
export const TIMEFRAME_MAX_HISTORY_DAYS: Record<string, number> = {
  "1m": 7,
  "5m": 55,
  "15m": 55,
  "1h": 700,
  "4h": 700,
  "1D": 3650,
};

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const maxHistoryDays = (tf: string): number =>
  TIMEFRAME_MAX_HISTORY_DAYS[tf] ?? 3650;

/** Earliest selectable start date for a timeframe (ISO). */
export const earliestStartFor = (tf: string): string => {
  const d = new Date();
  d.setDate(d.getDate() - maxHistoryDays(tf));
  return toISO(d);
};

/** Today (ISO) — latest selectable end date. */
export const todayISO = (): string => toISO(new Date());

/** Snap a [start, end] range into the timeframe's window.
 * Returns null when nothing changed. */
export const snapDatesToTimeframe = (
  start: string,
  end: string,
  tf: string,
): { start: string; end: string; note: string } | null => {
  const earliest = earliestStartFor(tf);
  const today = todayISO();
  let s = start;
  let e = end;
  let note: string | null = null;

  if (e > today) {
    e = today;
    note = "end date moved to today";
  }
  if (s < earliest) {
    s = earliest;
    note = `${tf} data only goes back ~${maxHistoryDays(tf)} days — start moved to ${earliest}`;
  }
  if (s >= e) {
    s = earliest < e ? earliest : e;
    note = note ?? "start date must be before end date";
  }
  return note ? { start: s, end: e, note } : null;
};

// ---------------- condition sanity ----------------
// Works on the builder's ConditionSide shape ({type, func, value}).

export type SanityVerdict = "impossible" | "always" | "mismatch" | null;

interface SideLike {
  type: string;
  func?: string;
  value?: number | string;
  operation?: unknown;
}

const rangeOf = (side: SideLike): [number | null, number | null] | null => {
  // Arithmetic modifiers (e.g. SMA * 1.05) shift ranges unpredictably — skip.
  if (side.operation) return null;
  if (side.type === "value") {
    const v = Number(side.value);
    return Number.isFinite(v) ? [v, v] : null;
  }
  if (side.type === "indicator" && side.func) {
    return INDICATOR_RANGES[side.func.toUpperCase()] ?? null;
  }
  return null;
};

const scaleOf = (side: SideLike): string | null => {
  if (side.type !== "indicator" || !side.func) return null;
  const f = side.func.toUpperCase();
  if (OSCILLATORS.has(f)) return "oscillator";
  if (PRICE_SCALE.has(f)) return "price";
  return null;
};

const label = (side: SideLike): string =>
  side.type === "value" ? String(side.value) : (side.func ?? "?").toUpperCase();

export const checkCondition = (
  left: SideLike,
  operator: string,
  right: SideLike,
): { verdict: SanityVerdict; message: string | null } => {
  if (![">", "<", ">=", "<="].includes(operator)) return { verdict: null, message: null };

  const lr = rangeOf(left);
  const rr = rangeOf(right);
  const ln = label(left);
  const rn = label(right);

  if (lr && rr) {
    const [lmin, lmax] = lr;
    const [rmin, rmax] = rr;
    let possible: boolean;
    let always: boolean;

    if (operator === ">" || operator === ">=") {
      possible =
        lmax === null || rmin === null || lmax > rmin || (operator === ">=" && lmax === rmin);
      always =
        lmin !== null && rmax !== null && (lmin > rmax || (operator === ">=" && lmin >= rmax));
    } else {
      possible =
        lmin === null || rmax === null || lmin < rmax || (operator === "<=" && lmin === rmax);
      always =
        lmax !== null && rmin !== null && (lmax < rmin || (operator === "<=" && lmax <= rmin));
    }

    if (!possible) {
      return {
        verdict: "impossible",
        message: `${ln} ${operator} ${rn} can never be true — ${ln} stays ${rangeText(lr)}.`,
      };
    }
    if (always) {
      return {
        verdict: "always",
        message: `${ln} ${operator} ${rn} is true on every bar — this would trigger immediately, on every candle.`,
      };
    }
  }

  const ls = scaleOf(left);
  const rs = scaleOf(right);
  if (ls && rs && ls !== rs) {
    return {
      verdict: "mismatch",
      message: `${ln} (${ls} scale) vs ${rn} (${rs} scale) — very different number ranges, usually a mistake.`,
    };
  }

  return { verdict: null, message: null };
};

const rangeText = ([lo, hi]: [number | null, number | null]): string => {
  if (lo !== null && hi !== null) return lo === hi ? `at exactly ${lo}` : `within ${lo}–${hi}`;
  if (lo !== null) return `at ${lo} or above`;
  return `at ${hi} or below`;
};
