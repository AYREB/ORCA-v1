// Parameter domain rules for the optimizers — mirrors
// backend/core/analysis/parameter_optimiser.py. The backend re-sanitizes
// everything server-side; this module exists so the UI never lets the user
// build a bad test in the first place.

export interface ParamDomain {
  min: number;
  max: number;
  integer: boolean;
}

// Transaction costs must never be optimized — the "best" fee is always 0.
const BLOCKED_PARAM_NAMES = new Set(["spread", "fee_value", "fee_fixed"]);

// Valid domain per parameter name (last path segment, lowercased).
const NAME_DOMAINS: Record<string, ParamDomain> = {
  period: { min: 2, max: 500, integer: true },
  fast: { min: 2, max: 200, integer: true },
  slow: { min: 3, max: 400, integer: true },
  signal: { min: 2, max: 100, integer: true },
  k_period: { min: 1, max: 100, integer: true },
  d_period: { min: 1, max: 100, integer: true },
  slowing: { min: 1, max: 50, integer: true },
  stddev: { min: 0.1, max: 10, integer: false },
  offset: { min: 0, max: 500, integer: true },
  stoplosspercent: { min: 0.1, max: 100, integer: false },
  takeprofitpercent: { min: 0.1, max: 1000, integer: false },
  initialopenpositioninvestamount: { min: 0.0001, max: 1e9, integer: false },
  recurringinvestamount: { min: 0.0001, max: 1e9, integer: false },
  recurringperiod: { min: 1, max: 10000, integer: true },
  maxrecurringcount: { min: 0, max: 1000, integer: true },
  minholdbars: { min: 0, max: 100000, integer: true },
  maxholdbars: { min: 0, max: 100000, integer: true },
  reentrycooldownbars: { min: 0, max: 100000, integer: true },
};

// Threshold values compared against bounded oscillators live on that scale
// (an "RSI < 400" test can never fire).
const OSCILLATOR_VALUE_DOMAINS: Record<string, ParamDomain> = {
  RSI: { min: 0, max: 100, integer: false },
  STOCH: { min: 0, max: 100, integer: false },
};

export const MAX_GRID_COMBINATIONS = 5000;

const lastPathSegment = (path: string): string =>
  path.replace(/\]/g, "").split(".").pop()?.split("[").pop()?.toLowerCase() ?? "";

export function isOptimizableParameterPath(path: string): boolean {
  const last = lastPathSegment(path);
  return !!last && !BLOCKED_PARAM_NAMES.has(last);
}

/** Domain for a parameter. `indicator` is the comparand indicator for
 * condition `.value` leaves (e.g. "RSI" for the 30 in "RSI < 30"). */
export function getParamDomain(path: string, indicator?: string | null): ParamDomain | null {
  const last = lastPathSegment(path);
  if (last === "value") {
    return (indicator && OSCILLATOR_VALUE_DOMAINS[indicator.toUpperCase()]) || null;
  }
  return NAME_DOMAINS[last] ?? null;
}

export function clampToDomain(value: number, domain: ParamDomain | null): number {
  if (!Number.isFinite(value)) return domain ? domain.min : 0;
  if (!domain) return value;
  let v = Math.min(domain.max, Math.max(domain.min, value));
  if (domain.integer) v = Math.round(v);
  return v;
}

/** Short hint like "whole number, 2–500" for input helper text. */
export function domainHint(domain: ParamDomain | null): string | null {
  if (!domain) return null;
  const fmt = (n: number) => (Math.abs(n) >= 1e6 ? n.toExponential(0) : `${n}`);
  return `${domain.integer ? "whole number" : "number"}, ${fmt(domain.min)}–${fmt(domain.max)}`;
}

/** Clamp every numeric entry of an indicator-args object to its domain
 * (e.g. { period: -5, timeframe: "1h" } → { period: 2, timeframe: "1h" }). */
export function clampIndicatorArgs<T extends Record<string, unknown>>(args: T): T {
  const out: Record<string, unknown> = { ...args };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "number") {
      const domain = getParamDomain(key);
      if (domain) out[key] = clampToDomain(value, domain);
    }
  }
  return out as T;
}

/** Clamp/round/dedupe a candidate list; empty result means nothing valid. */
export function sanitizeValues(path: string, values: number[], indicator?: string | null): number[] {
  const domain = getParamDomain(path, indicator);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of values) {
    if (!Number.isFinite(raw)) continue;
    const v = clampToDomain(raw, domain);
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
