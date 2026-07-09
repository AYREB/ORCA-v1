import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRegistry, availableTimeframesFor } from "@/context/RegistryContext";
import { useTickerSearch, useTickerName, rememberTickerName } from "@/hooks/useTickerSearch";

interface TickerComboboxProps {
  value: string;
  onChange: (v: string) => void;
  exclude?: string[];
  placeholder?: string;
  className?: string;
}

export const TickerCombobox = ({
  value,
  onChange,
  exclude = [],
  placeholder = "Type a ticker…",
  className,
}: TickerComboboxProps) => {
  const { tickers } = useRegistry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const typed = query.trim();
  const typedUpper = typed.toUpperCase();
  const queryLower = typed.toLowerCase();

  // Registry (pre-pulled) tickers matching the query — always shown first.
  const registryMatches = Object.entries(tickers).filter(([sym, meta]) => {
    if (sym !== value && exclude.includes(sym)) return false;
    if (!queryLower) return true;
    return (
      sym.toLowerCase().includes(queryLower) ||
      (meta.name || "").toLowerCase().includes(queryLower)
    );
  });
  const registrySymbols = new Set(Object.keys(tickers).map((s) => s.toUpperCase()));

  // Live Yahoo Finance search while the dropdown is open.
  const { results: searchResults, isSearching } = useTickerSearch(typed, open);
  const yahooMatches = searchResults.filter(
    (r) => !r.local && !registrySymbols.has(r.symbol.toUpperCase()) && !exclude.includes(r.symbol),
  );

  // Full name of the current selection: registry -> search cache (resolves
  // lazily for unknown symbols so the label fills in once known).
  const current = value ? tickers[value] : undefined;
  const resolvedName = useTickerName(!current ? value : undefined);
  const currentName = current?.name || resolvedName;

  const exactMatchShown =
    registryMatches.some(([sym]) => sym === typedUpper) ||
    yahooMatches.some((r) => r.symbol.toUpperCase() === typedUpper);
  const showCustom = typed.length > 0 && !exactMatchShown;

  const commit = (sym: string, name?: string) => {
    const symbol = sym.trim().toUpperCase();
    if (name) rememberTickerName(symbol, name);
    onChange(symbol);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 justify-between bg-secondary/50 border-border/50",
            className,
          )}
        >
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-mono uppercase">{value || placeholder}</span>
            {value && currentName && (
              <span className="truncate text-[11px] font-normal normal-case text-muted-foreground">
                {currentName}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="start">
        {/* Filtering is done manually: registry matches + live Yahoo Finance
            search results, so Command's built-in filter must stay off. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search ticker or company name…"
            className="h-9"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {registryMatches.length > 0 && (
              <CommandGroup heading="Orca data">
                {registryMatches.map(([sym, meta]) => (
                  <CommandItem
                    key={sym}
                    value={sym}
                    onSelect={() => commit(sym, meta.name)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        value === sym ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono font-semibold text-xs">{sym}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {meta.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {typed.length > 0 && (isSearching || yahooMatches.length > 0) && (
              <CommandGroup heading="Yahoo Finance">
                {yahooMatches.map((r) => (
                  <CommandItem
                    key={r.symbol}
                    value={r.symbol}
                    onSelect={() => commit(r.symbol, r.name)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        value === r.symbol ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono font-semibold text-xs">{r.symbol}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {r.name}
                    </span>
                    {(r.exchange || r.type) && (
                      <span className="shrink-0 text-[10px] text-muted-foreground/60">
                        {[r.type, r.exchange].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </CommandItem>
                ))}
                {isSearching && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Searching Yahoo Finance…
                  </div>
                )}
              </CommandGroup>
            )}
            {showCustom && !isSearching && (
              <CommandGroup heading="Use what you typed">
                <CommandItem
                  key={`__custom_${typedUpper}`}
                  value={`__custom_${typedUpper}`}
                  onSelect={() => commit(typedUpper)}
                  className="flex items-center gap-2"
                >
                  <Check className="h-3.5 w-3.5 opacity-0" />
                  <span className="font-mono font-semibold text-xs">{typedUpper}</span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    fetch from Yahoo Finance
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {registryMatches.length === 0 && yahooMatches.length === 0 && !isSearching && !showCustom && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                Type a ticker or company name to search.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

interface TimeframeSelectProps {
  value: string;
  onChange: (v: string) => void;
  tickers?: string[];
  className?: string;
}

export const TimeframeSelect = ({
  value,
  onChange,
  tickers: selectedTickers = [],
  className,
}: TimeframeSelectProps) => {
  const { tickers, timeframes } = useRegistry();
  const available = availableTimeframesFor(selectedTickers, tickers, timeframes);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9 bg-secondary/50 border-border/50", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {available.map((tf) => (
          <SelectItem key={tf} value={tf}>
            {timeframes[tf] || tf}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};