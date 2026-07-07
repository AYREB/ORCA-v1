import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
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
  const entries = Object.entries(tickers).filter(
    ([sym]) => sym === value || !exclude.includes(sym),
  );
  const current = value ? tickers[value] : undefined;
  const known = !value || !!current;

  const typed = query.trim().toUpperCase();
  // Offer to use whatever the user typed as a custom ticker (fetched from Yahoo
  // Finance by the backend) whenever it isn't already an exact known symbol.
  const showCustom = typed.length > 0 && !tickers[typed];

  const commit = (sym: string) => {
    onChange(sym.trim().toUpperCase());
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
            "h-9 justify-between font-mono uppercase bg-secondary/50 border-border/50",
            !known && "border-yellow-500/50 text-yellow-500",
            className,
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        {/* Free-text: type any symbol (e.g. TSLA, BTC-USD). Known tickers show as
            suggestions; anything else is fetched from Yahoo Finance by the backend. */}
        <Command shouldFilter>
          <CommandInput
            placeholder="Type a ticker (e.g. AAPL, BTC-USD)…"
            className="h-9"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {showCustom && (
              <CommandGroup heading="Use what you typed">
                <CommandItem
                  key={`__custom_${typed}`}
                  value={typed}
                  onSelect={() => commit(typed)}
                  className="flex items-center gap-2"
                >
                  <Check className="h-3.5 w-3.5 opacity-0" />
                  <span className="font-mono font-semibold text-xs">{typed}</span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    fetch from Yahoo Finance
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandEmpty>Type a symbol and press Enter to use it.</CommandEmpty>
            <CommandGroup heading={entries.length ? "Known tickers" : undefined}>
              {entries.map(([sym, meta]) => (
                <CommandItem
                  key={sym}
                  value={`${sym} ${meta.name}`}
                  onSelect={() => commit(sym)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5",
                      value === sym ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-mono font-semibold text-xs">{sym}</span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {meta.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
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