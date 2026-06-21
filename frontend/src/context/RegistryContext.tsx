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
// Intersection of available timeframes across selected tickers.
// Unknown tickers are ignored. Returns ordered list using the registry's key order.
export const availableTimeframesFor = (
  selectedTickers: string[],
  tickers: Record<string, { name: string; available_timeframes: string[] }>,
  timeframes: Record<string, string>,
): string[] => {
  const allKeys = Object.keys(timeframes);
  const known = selectedTickers
    .map((t) => tickers[t]?.available_timeframes)
    .filter((x): x is string[] => Array.isArray(x));
  if (known.length === 0) return allKeys;
  const set = known.reduce<Set<string>>(
    (acc, list) => new Set(list.filter((tf) => acc.has(tf))),
    new Set(known[0]),
  );
  return allKeys.filter((k) => set.has(k));
};