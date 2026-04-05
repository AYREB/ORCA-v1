import { useState, useCallback, useEffect } from "react";

export interface AppSettings {
  profile: {
    displayName: string;
    email: string;
  };
  appearance: {
    theme: "dark" | "light" | "system";
    chartColorScheme: "classic" | "neon" | "muted";
    layoutDensity: "compact" | "comfortable";
  };
  backtestDefaults: {
    initialBalance: number;
    spread: number;
    takeProfitPercent: number;
    stopLossPercent: number;
    timeframe: string;
  };
}

const STORAGE_KEY = "orca-settings";

const DEFAULT_SETTINGS: AppSettings = {
  profile: {
    displayName: "",
    email: "",
  },
  appearance: {
    theme: "dark",
    chartColorScheme: "classic",
    layoutDensity: "comfortable",
  },
  backtestDefaults: {
    initialBalance: 10000,
    spread: 0.001,
    takeProfitPercent: 10,
    stopLossPercent: 6,
    timeframe: "1h",
  },
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.appearance.theme;

    const applyTheme = (prefersDark: boolean) => {
      if (theme === "dark" || (theme === "system" && prefersDark)) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mq.matches);

    if (theme === "system") {
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [settings.appearance.theme]);

  // Apply density class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.appearance.layoutDensity === "compact") {
      root.classList.add("density-compact");
    } else {
      root.classList.remove("density-compact");
    }
  }, [settings.appearance.layoutDensity]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev };
      if (partial.profile) next.profile = { ...prev.profile, ...partial.profile };
      if (partial.appearance) next.appearance = { ...prev.appearance, ...partial.appearance };
      if (partial.backtestDefaults) next.backtestDefaults = { ...prev.backtestDefaults, ...partial.backtestDefaults };
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
