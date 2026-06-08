import { useState, useCallback, useEffect } from "react";

export type ChartColorScheme = "classic" | "neon" | "muted";
export type ChartType = "candles" | "line" | "area";

export interface ChartColors {
  candleUp: string;
  candleDown: string;
  wickUp: string;
  wickDown: string;
  line: string;
  areaTop: string;
  areaBottom: string;
  background: string;
  grid: string;
  crosshair: string;
}

export interface ChartOptions {
  showGrid: boolean;
  defaultShowMarkers: boolean;
  defaultShowTPSL: boolean;
  replaySpeed: number;
}

export interface AppSettings {
  profile: {
    displayName: string;
    email: string;
  };
  appearance: {
    theme: "dark" | "light" | "system";
    chartColorScheme: ChartColorScheme;
    chartType: ChartType;
    chartColors: ChartColors;
    chartOptions: ChartOptions;
    layoutDensity: "compact" | "comfortable";
  };
  backtestDefaults: {
    initialBalance: number;
    spread: number;
    takeProfitPercent: number;
    stopLossPercent: number;
    timeframe: string;
  };
  notifications: {
    backtestComplete: boolean;
    optimizationComplete: boolean;
    soundEnabled: boolean;
  };
}

const STORAGE_KEY = "orca-settings";

export const CHART_COLOR_PRESETS: Record<ChartColorScheme, ChartColors> = {
  classic: {
    candleUp: "#22c55e",
    candleDown: "#ef4444",
    wickUp: "#22c55e",
    wickDown: "#ef4444",
    line: "#38bdf8",
    areaTop: "#38bdf8",
    areaBottom: "#0f172a",
    background: "#0a0a0a",
    grid: "#1f2937",
    crosshair: "#14b8a6",
  },
  neon: {
    candleUp: "#00ff88",
    candleDown: "#ff2bd6",
    wickUp: "#72ffd2",
    wickDown: "#ff7ae7",
    line: "#00d5ff",
    areaTop: "#00d5ff",
    areaBottom: "#16052c",
    background: "#08070f",
    grid: "#30213f",
    crosshair: "#facc15",
  },
  muted: {
    candleUp: "#7fb685",
    candleDown: "#c08457",
    wickUp: "#a8c6ad",
    wickDown: "#d2a17d",
    line: "#7e9cc8",
    areaTop: "#7e9cc8",
    areaBottom: "#1b2430",
    background: "#111318",
    grid: "#303640",
    crosshair: "#c8a96a",
  },
};

const DEFAULT_SETTINGS: AppSettings = {
  profile: {
    displayName: "",
    email: "",
  },
  appearance: {
    theme: "dark",
    chartColorScheme: "classic",
    chartType: "candles",
    chartColors: CHART_COLOR_PRESETS.classic,
    chartOptions: {
      showGrid: true,
      defaultShowMarkers: true,
      defaultShowTPSL: false,
      replaySpeed: 5,
    },
    layoutDensity: "comfortable",
  },
  backtestDefaults: {
    initialBalance: 10000,
    spread: 0.001,
    takeProfitPercent: 10,
    stopLossPercent: 6,
    timeframe: "1h",
  },
  notifications: {
    backtestComplete: true,
    optimizationComplete: true,
    soundEnabled: true,
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeSettings = (raw: unknown): AppSettings => {
  if (!isRecord(raw)) return DEFAULT_SETTINGS;

  const appearance = isRecord(raw.appearance) ? raw.appearance : {};
  const chartColors = isRecord(appearance.chartColors) ? appearance.chartColors : {};
  const chartOptions = isRecord(appearance.chartOptions) ? appearance.chartOptions : {};

  return {
    profile: {
      ...DEFAULT_SETTINGS.profile,
      ...(isRecord(raw.profile) ? (raw.profile as Partial<AppSettings["profile"]>) : {}),
    },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(appearance as Partial<AppSettings["appearance"]>),
      chartColors: {
        ...DEFAULT_SETTINGS.appearance.chartColors,
        ...(chartColors as Partial<ChartColors>),
      },
      chartOptions: {
        ...DEFAULT_SETTINGS.appearance.chartOptions,
        ...(chartOptions as Partial<ChartOptions>),
      },
    } as AppSettings["appearance"],
    backtestDefaults: {
      ...DEFAULT_SETTINGS.backtestDefaults,
      ...(isRecord(raw.backtestDefaults) ? (raw.backtestDefaults as Partial<AppSettings["backtestDefaults"]>) : {}),
    },
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...(isRecord(raw.notifications) ? (raw.notifications as Partial<AppSettings["notifications"]>) : {}),
    },
  };
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return mergeSettings(JSON.parse(raw));
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

  const updateSettings = useCallback((partial: DeepPartial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev };
      if (partial.profile) next.profile = { ...prev.profile, ...partial.profile };
      if (partial.appearance) {
        const { chartColors, chartOptions, ...appearancePatch } = partial.appearance;
        next.appearance = {
          ...prev.appearance,
          ...appearancePatch,
          chartColors: {
            ...prev.appearance.chartColors,
            ...(chartColors || {}),
          },
          chartOptions: {
            ...prev.appearance.chartOptions,
            ...(chartOptions || {}),
          },
        };
      }
      if (partial.backtestDefaults) next.backtestDefaults = { ...prev.backtestDefaults, ...partial.backtestDefaults };
      if (partial.notifications) next.notifications = { ...prev.notifications, ...partial.notifications };
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
