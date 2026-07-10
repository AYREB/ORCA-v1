import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Registry, FALLBACK_REGISTRY } from "@/components/backtest/backtest-types";
interface RegistryContextType {
  registry: Registry;
  loading: boolean;
  tickers: Record<string, { name: string; available_timeframes: string[] }>;
  timeframes: Record<string, string>;
}
const DEFAULT_TIMEFRAMES: Record<string, string> = {
  "1m": "1 Minute",
  "5m": "5 Minutes",
  "15m": "15 Minutes",
  "1h": "1 Hour",
  "4h": "4 Hours",
  "1D": "Daily",
};
const RegistryContext = createContext<RegistryContextType | undefined>(undefined);
export const RegistryProvider = ({ children }: { children: ReactNode }) => {
  const [registry, setRegistry] = useState<Registry>(FALLBACK_REGISTRY);
  const [loading, setLoading] = useState(true);
  // Wait for AuthProvider to finish bootstrapping (it sets the api token);
  // fetching earlier 401s and strands the app on the fallback registry.
  const { token, loading: authLoading } = useAuth();
  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      // Logged out: the endpoint requires auth, keep the fallback registry.
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const data = (await api.getRegistry()) as unknown as Registry;
        if (alive) setRegistry(data);
      } catch {
        // Falls back to FALLBACK_REGISTRY set in initial state — app remains usable
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authLoading, token]);
  const tickers = registry.tickers ?? {};
  const timeframes =
    registry.timeframes && Object.keys(registry.timeframes).length > 0
      ? registry.timeframes
      : DEFAULT_TIMEFRAMES;
  return (
    <RegistryContext.Provider value={{ registry, loading, tickers, timeframes }}>
      {children}
    </RegistryContext.Provider>
  );
};
export const useRegistry = () => {
  const ctx = useContext(RegistryContext);
  if (!ctx) throw new Error("useRegistry must be used within RegistryProvider");
  return ctx;
};
// Timeframes Yahoo Finance can fetch live for any ticker with useful history, so
// they're always offered — even when a stored ticker's CSVs only cover 4h/1D.
const YAHOO_TIMEFRAMES = ["1h", "1D"];
const TIMEFRAME_ORDER = ["1m", "5m", "15m", "1h", "4h", "1D", "1wk", "1mo"];

// Available timeframes across selected tickers: the intersection of their stored
// timeframes, always widened with the Yahoo-fetchable ones (so 1h is offered).
export const availableTimeframesFor = (
  selectedTickers: string[],
  tickers: Record<string, { name: string; available_timeframes: string[] }>,
  timeframes: Record<string, string>,
): string[] => {
  const allKeys = Object.keys(timeframes);
  const known = selectedTickers
    .map((t) => tickers[t]?.available_timeframes)
    .filter((x): x is string[] => Array.isArray(x));
  const set: Set<string> =
    known.length === 0
      ? new Set(allKeys)
      : known.reduce<Set<string>>(
          (acc, list) => new Set(list.filter((tf) => acc.has(tf))),
          new Set(known[0]),
        );
  YAHOO_TIMEFRAMES.forEach((tf) => set.add(tf));
  const ordered = TIMEFRAME_ORDER.filter((tf) => set.has(tf));
  const extra = allKeys.filter((k) => set.has(k) && !TIMEFRAME_ORDER.includes(k));
  return [...ordered, ...extra];
};