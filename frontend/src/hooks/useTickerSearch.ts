import { useEffect, useRef, useState } from "react";
import { api, TickerSearchResult } from "@/lib/api";

// Session-wide symbol -> full-name cache, fed by every search result, so
// selected tickers keep their display name after the dropdown closes.
const nameCache = new Map<string, string>();

export const rememberTickerName = (symbol: string, name: string) => {
  if (symbol && name && name !== symbol) nameCache.set(symbol.toUpperCase(), name);
};

export const cachedTickerName = (symbol: string): string | undefined =>
  nameCache.get(symbol.trim().toUpperCase());

/**
 * Debounced Yahoo-Finance-backed symbol search (via /api/tickers/search/).
 * Returns live results for the current query; stale responses are discarded.
 */
export function useTickerSearch(query: string, enabled = true, debounceMs = 300) {
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 1) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(async () => {
      try {
        const found = await api.searchTickers(q);
        if (requestSeq.current !== seq) return; // stale
        found.forEach((r) => rememberTickerName(r.symbol, r.name));
        setResults(found);
      } catch {
        if (requestSeq.current === seq) setResults([]);
      } finally {
        if (requestSeq.current === seq) setIsSearching(false);
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [query, enabled, debounceMs]);

  return { results, isSearching };
}

/**
 * Resolve the full asset name of a single symbol (one cached lookup per
 * unknown symbol per session). Returns undefined until resolved.
 */
export function useTickerName(symbol: string | undefined | null): string | undefined {
  const sym = (symbol || "").trim().toUpperCase();
  const [name, setName] = useState<string | undefined>(() => (sym ? nameCache.get(sym) : undefined));

  useEffect(() => {
    if (!sym) {
      setName(undefined);
      return;
    }
    const cached = nameCache.get(sym);
    if (cached) {
      setName(cached);
      return;
    }
    let cancelled = false;
    api
      .searchTickers(sym)
      .then((found) => {
        found.forEach((r) => rememberTickerName(r.symbol, r.name));
        if (!cancelled) setName(nameCache.get(sym));
      })
      .catch(() => {
        /* name stays undefined — symbol alone is still shown */
      });
    return () => {
      cancelled = true;
    };
  }, [sym]);

  return name;
}
