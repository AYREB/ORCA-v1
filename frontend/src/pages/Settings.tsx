import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Palette, SlidersHorizontal, Moon, Sun, Monitor, Bell,
  Check, ChartCandlestick, ChartLine, ChartArea, Grid3x3,
  MousePointer2, Target, LogOut, Shield, Database, Calendar,
  Mail, RotateCcw, AlertTriangle, Volume2, VolumeX, Zap,
  Activity, Plus, Minus, ChevronRight,
} from "lucide-react";
import DashboardLayout, { PageHeader } from "@/components/dashboard/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CHART_COLOR_PRESETS, useSettings,
  type AppSettings, type ChartColorScheme, type ChartColors, type ChartType,
} from "@/hooks/useSettings";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
type SectionId = "profile" | "appearance" | "defaults" | "notifications" | "account";

const NAV: Array<{ id: SectionId; label: string; icon: typeof User; shortcut: string }> = [
  { id: "profile",       label: "Profile",           icon: User,             shortcut: "1" },
  { id: "appearance",    label: "Appearance",         icon: Palette,          shortcut: "2" },
  { id: "defaults",      label: "Backtest Defaults",  icon: SlidersHorizontal, shortcut: "3" },
  { id: "notifications", label: "Notifications",      icon: Bell,             shortcut: "4" },
  { id: "account",       label: "Account",            icon: Shield,           shortcut: "5" },
];

const CHART_TYPES: Array<{ value: ChartType; label: string; icon: typeof ChartCandlestick }> = [
  { value: "candles", label: "Candles", icon: ChartCandlestick },
  { value: "line",    label: "Line",    icon: ChartLine },
  { value: "area",    label: "Area",    icon: ChartArea },
];

const CHART_COLORS: Array<{ key: keyof ChartColors; label: string }> = [
  { key: "candleUp",   label: "Candle Up" },
  { key: "candleDown", label: "Candle Down" },
  { key: "wickUp",     label: "Wick Up" },
  { key: "wickDown",   label: "Wick Down" },
  { key: "line",       label: "Line" },
  { key: "areaTop",    label: "Area Top" },
  { key: "areaBottom", label: "Area Base" },
  { key: "background", label: "Background" },
  { key: "grid",       label: "Grid" },
  { key: "crosshair",  label: "Crosshair" },
];

const SCHEME_LABELS: Record<ChartColorScheme, string> = { classic: "Classic", neon: "Neon", muted: "Muted" };

// ─── Helpers ─────────────────────────────────────────────────────────────────
const hexAlpha = (hex: string, a: number) => {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#38bdf8";
  return `${h}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
};
const safeHex = (v: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : "#000000");

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── Saved Pill ───────────────────────────────────────────────────────────────
const SavedPill = ({ show }: { show: boolean }) => (
  <AnimatePresence>
    {show && (
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.18 }}
        className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary border border-primary/20"
      >
        <Check className="h-3 w-3" /> Saved
      </motion.span>
    )}
  </AnimatePresence>
);

// Pending dot shown on nav when a section has unsaved work
const PendingDot = () => (
  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
);

// ─── Number Stepper ──────────────────────────────────────────────────────────
const Stepper = ({
  value, onChange, step = 1, min, max, className = "",
}: {
  value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; className?: string;
}) => {
  const clamp = (v: number) => {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  };
  return (
    <div className={`flex items-center rounded-lg border border-border/50 overflow-hidden bg-secondary/50 ${className}`}>
      <button
        type="button"
        onClick={() => onChange(clamp(parseFloat((value - step).toFixed(10))))}
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(clamp(v));
        }}
        className="w-20 bg-transparent text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(parseFloat((value + step).toFixed(10))))}
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
};

// ─── Row ────────────────────────────────────────────────────────────────────
const Row = ({
  icon: Icon, label, sub, control, last = false,
}: {
  icon?: typeof User; label: string; sub?: string; control: React.ReactNode; last?: boolean;
}) => (
  <div className={`flex items-center justify-between gap-6 px-4 py-3.5 ${!last ? "border-b border-border/40" : ""}`}>
    <div className="flex items-start gap-3 min-w-0">
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug">{label}</p>
        {sub && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{sub}</p>}
      </div>
    </div>
    <div className="shrink-0">{control}</div>
  </div>
);

// ─── Block ──────────────────────────────────────────────────────────────────
const Block = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">{title}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
    {children}
  </div>
);

// ─── Chart Preview ───────────────────────────────────────────────────────────
const ChartPreview = ({ app }: { app: AppSettings["appearance"] }) => {
  const { theme, chartColors: c, chartOptions, chartType, layoutDensity } = app;
  const isDark =
    theme === "dark" ||
    (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const compact = layoutDensity === "compact";
  const bg = isDark ? "#0a0a0f" : "#f0f2f5";
  const border = isDark ? "#1e1e2a" : "#e2e4ea";
  const muted = isDark ? "#52525b" : "#a1a1aa";
  const pts = "8,26 20,20 32,22 44,16 56,17 68,12 80,14 92,9 104,11";

  const candles = [
    { x:8,  o:28, cl:14, h:10, l:32 }, { x:20, o:14, cl:20, h:10, l:24 },
    { x:32, o:22, cl:12, h:8,  l:26 }, { x:44, o:12, cl:18, h:6,  l:22 },
    { x:56, o:18, cl:10, h:6,  l:22 }, { x:68, o:10, cl:16, h:6,  l:20 },
    { x:80, o:16, cl:8,  h:4,  l:20 }, { x:92, o:8,  cl:14, h:4,  l:18 },
    { x:104,o:14, cl:6,  h:2,  l:18 },
  ];

  return (
    <div className="overflow-hidden rounded-xl border transition-all duration-300" style={{ borderColor: border, background: bg }}>
      <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: border, color: muted }}>
        Live preview
      </div>
      <div className="flex gap-3" style={{ padding: compact ? 10 : 14 }}>
        {/* Chart */}
        <div className="flex-1 overflow-hidden rounded-lg border" style={{ borderColor: border, background: c.background, padding: compact ? 8 : 12 }}>
          <div className="mb-1.5 text-[9px] font-semibold" style={{ color: muted }}>AAPL · 1H</div>
          <svg viewBox="0 0 120 40" className="w-full" style={{ height: compact ? 30 : 40 }}>
            {chartOptions.showGrid && (
              <g opacity="0.4">
                {[12, 26].map(y => <line key={y} x1="0" x2="120" y1={y} y2={y} stroke={c.grid} strokeWidth="0.5" />)}
                {[30, 72].map(x => <line key={x} x1={x} x2={x} y1="0" y2="40" stroke={c.grid} strokeWidth="0.5" />)}
              </g>
            )}
            {chartType === "area" && (
              <>
                <polygon points={`8,40 ${pts} 104,40`} fill={hexAlpha(c.areaTop, 0.26)} />
                <polyline points={pts} fill="none" stroke={c.areaTop} strokeWidth="1.7" strokeLinecap="round" />
              </>
            )}
            {chartType === "line" && <polyline points={pts} fill="none" stroke={c.line} strokeWidth="1.8" strokeLinecap="round" />}
            {chartType === "candles" && candles.map((cd, i) => {
              const up = cd.cl < cd.o;
              return (
                <g key={i}>
                  <line x1={cd.x} x2={cd.x} y1={cd.h} y2={cd.l} stroke={up ? c.wickUp : c.wickDown} strokeWidth="1" />
                  <rect x={cd.x - 3} y={Math.min(cd.o, cd.cl)} width="6" height={Math.abs(cd.o - cd.cl) || 1} fill={up ? c.candleUp : c.candleDown} rx="0.5" />
                </g>
              );
            })}
            <line x1="74" x2="74" y1="3" y2="37" stroke={c.crosshair} strokeWidth="0.8" opacity="0.6" strokeDasharray="2 2" />
          </svg>
        </div>
        {/* Stat cards */}
        <div className="flex flex-col gap-2">
          {[
            { label: "Win Rate", value: "68%", color: c.candleUp },
            { label: "P&L",      value: "+12.4%", color: c.candleUp },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex flex-col justify-between rounded-lg border" style={{ borderColor: border, background: c.background, padding: compact ? "6px 8px" : "8px 10px", minWidth: 68 }}>
              <div className="text-[8px] uppercase tracking-wider" style={{ color: muted }}>{label}</div>
              <div className="font-bold tabular-nums" style={{ color, fontSize: compact ? 13 : 16 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Option Pill row ────────────────────────────────────────────────────────
const Pills = <T extends string>({
  options, value, onChange, renderLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  renderLabel?: (v: T) => React.ReactNode;
}) => (
  <div className="flex gap-1.5 flex-wrap">
    {options.map((opt) => (
      <button
        key={opt}
        type="button"
        onClick={() => onChange(opt)}
        className={`relative flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-150 ${
          value === opt
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-border"
        }`}
      >
        {value === opt && <Check className="h-3 w-3 shrink-0" />}
        {renderLabel ? renderLabel(opt) : <span className="capitalize">{opt}</span>}
      </button>
    ))}
  </div>
);

// ─── Main ────────────────────────────────────────────────────────────────────
const Settings = () => {
  const { settings, updateSettings } = useSettings();
  const { user, logout, refreshUser, updateToken } = useAuth();

  const [section, setSection] = useState<SectionId>("profile");

  // Profile: local edit state synced from auth
  const [nameInput, setNameInput] = useState(user?.name ?? "");
  const [nameSaving, setNameSaving] = useState(false);
  const nameChanged = nameInput.trim() !== (user?.name ?? "");

  // Change password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Delete account
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleChangePassword = useCallback(async () => {
    if (!currentPw || !newPw || !confirmPw) {
      toast.error("Please fill in all password fields.");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("New passwords don't match.");
      return;
    }
    if (newPw.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await api.changePassword(currentPw, newPw);
      updateToken(res.token);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      toast.success("Password changed successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setPwSaving(false);
    }
  }, [currentPw, newPw, confirmPw, updateToken]);

  const handleDeleteAccount = useCallback(async () => {
    if (!deletePw) {
      toast.error("Please enter your password to confirm.");
      return;
    }
    setDeleteLoading(true);
    try {
      await api.deleteAccount(deletePw);
      logout();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account.");
      setDeleteLoading(false);
    }
  }, [deletePw, logout]);

  // Other sections
  const [appearance, setAppearance]       = useState(settings.appearance);
  const [defaults, setDefaults]           = useState(settings.backtestDefaults);
  const [notifications, setNotifications] = useState(settings.notifications);

  // Saved flash
  const [savedSection, setSavedSection] = useState<SectionId | null>(null);
  const flashSaved = useCallback((id: SectionId) => {
    setSavedSection(id);
    setTimeout(() => setSavedSection(null), 2000);
  }, []);

  const defaultsChanged = JSON.stringify(defaults) !== JSON.stringify(settings.backtestDefaults);

  // ── Save name to backend ──
  const saveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === user?.name) return;
    setNameSaving(true);
    try {
      await api.updateProfile(trimmed);
      await refreshUser();
      flashSaved("profile");
    } catch {
      toast.error("Failed to save name");
    } finally {
      setNameSaving(false);
    }
  }, [nameInput, user?.name, refreshUser, flashSaved]);

  // Keep nameInput in sync if user changes elsewhere
  useEffect(() => {
    setNameInput(user?.name ?? "");
  }, [user?.name]);

  // ── Auto-save: defaults (700ms debounce) ──
  const dDefaults = useDebounce(defaults, 700);
  const defaultsSaveInit = useRef(true);
  useEffect(() => {
    if (defaultsSaveInit.current) { defaultsSaveInit.current = false; return; }
    updateSettings({ backtestDefaults: dDefaults });
    flashSaved("defaults");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dDefaults]);

  // ── Auto-save: appearance (immediate) ──
  const appearanceInit = useRef(true);
  useEffect(() => {
    if (appearanceInit.current) { appearanceInit.current = false; return; }
    updateSettings({ appearance });
    flashSaved("appearance");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance]);

  // ── Auto-save: notifications (immediate) ──
  const notifsInit = useRef(true);
  useEffect(() => {
    if (notifsInit.current) { notifsInit.current = false; return; }
    updateSettings({ notifications });
    flashSaved("notifications");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications]);

  // ── Keyboard shortcuts: 1-5 to switch sections ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < NAV.length) setSection(NAV[idx].id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Derived ──
  const initials = (user?.name || user?.email || "?")
    .split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const memberSince = user?.date_joined
    ? new Date(user.date_joined).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  const patchAppearance = (patch: Partial<AppSettings["appearance"]>) =>
    setAppearance((p) => ({ ...p, ...patch }));

  const patchChartColor = (key: keyof ChartColors, val: string) =>
    setAppearance((p) => ({ ...p, chartColors: { ...p.chartColors, [key]: val } }));

  const patchChartOptions = (patch: Partial<AppSettings["appearance"]["chartOptions"]>) =>
    setAppearance((p) => ({ ...p, chartOptions: { ...p.chartOptions, ...patch } }));

  const applyPreset = (scheme: ChartColorScheme) =>
    setAppearance((p) => ({ ...p, chartColorScheme: scheme, chartColors: CHART_COLOR_PRESETS[scheme] }));

  const resetAllSettings = () => {
    localStorage.removeItem("orca-settings");
    window.location.reload();
  };

  const handleLogout = () => {
    logout();
    window.location.href = "/";
  };

  const pending: Partial<Record<SectionId, boolean>> = {
    profile: nameChanged,
    defaults: defaultsChanged,
  };

  // ── Section content ──────────────────────────────────────────────────────
  const sections: Record<SectionId, React.ReactNode> = {

    // ── PROFILE ──────────────────────────────────────────────────────────
    profile: (
      <div className="space-y-7">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Profile</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Your name appears in the sidebar and across the platform.</p>
          </div>
          <SavedPill show={savedSection === "profile" && !nameChanged} />
        </div>

        {/* Avatar card */}
        <div className="flex items-center gap-5 rounded-xl border border-border/50 bg-muted/10 px-5 py-4">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/40 to-accent/30 blur-md" />
            <Avatar className="relative h-16 w-16 border-2 border-primary/30">
              <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-xl font-bold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{user?.name || "—"}</p>
            <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
            {memberSince && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Member since {memberSince}</span>
              </div>
            )}
          </div>
        </div>

        {/* Name field */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
            <div className="flex gap-2">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                placeholder="Your name"
                className="bg-secondary/40 border-border/50"
              />
              <Button
                onClick={saveName}
                disabled={!nameChanged || nameSaving}
                size="sm"
                className="shrink-0 px-4"
              >
                {nameSaving ? "Saving…" : "Save"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/60">
              This updates your name everywhere — sidebar, dashboard greeting, and profile.
            </p>
          </div>

          {/* Email read-only */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="email"
                value={user?.email || ""}
                readOnly
                className="cursor-not-allowed pl-9 bg-secondary/20 border-border/30 text-muted-foreground"
              />
            </div>
            <p className="text-[11px] text-muted-foreground/60">Email is bound to your account and cannot be changed here.</p>
          </div>
        </div>
      </div>
    ),

    // ── APPEARANCE ───────────────────────────────────────────────────────
    appearance: (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Appearance</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Theme, charts, and layout — saves instantly.</p>
          </div>
          <SavedPill show={savedSection === "appearance"} />
        </div>

        <ChartPreview app={appearance} />

        <Block title="Display">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Theme</p>
              <Pills
                options={["dark", "light", "system"] as const}
                value={appearance.theme}
                onChange={(v) => patchAppearance({ theme: v })}
                renderLabel={(v) => {
                  const Icon = v === "dark" ? Moon : v === "light" ? Sun : Monitor;
                  return <><Icon className="h-3.5 w-3.5" /><span className="capitalize">{v}</span></>;
                }}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Layout density</p>
              <Pills
                options={["comfortable", "compact"] as const}
                value={appearance.layoutDensity}
                onChange={(v) => patchAppearance({ layoutDensity: v })}
              />
            </div>
          </div>
        </Block>

        <Block title="Chart style" sub="Default chart type for the Charts page.">
          <div className="grid grid-cols-3 gap-2">
            {CHART_TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => patchAppearance({ chartType: value })}
                className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-all ${
                  appearance.chartType === value
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </Block>

        <Block title="Color preset" sub="Applies a full palette — you can fine-tune below.">
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(CHART_COLOR_PRESETS) as ChartColorScheme[]).map((scheme) => {
              const p = CHART_COLOR_PRESETS[scheme];
              const active = appearance.chartColorScheme === scheme;
              return (
                <button
                  key={scheme}
                  type="button"
                  onClick={() => applyPreset(scheme)}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-5 py-3 text-sm transition-all ${
                    active ? "border-primary/40 bg-primary/10" : "border-border/50 bg-muted/20 hover:bg-muted/50"
                  }`}
                >
                  <div className="flex gap-1">
                    {[p.candleUp, p.line, p.candleDown].map((col, i) => (
                      <div key={i} className="h-4 w-4 rounded-full" style={{ background: col }} />
                    ))}
                  </div>
                  <span className={`text-xs font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>
                    {SCHEME_LABELS[scheme]}
                  </span>
                </button>
              );
            })}
          </div>
        </Block>

        <Block title="Chart colors" sub="Fine-tune individual chart colors.">
          <div className="grid gap-2 sm:grid-cols-2">
            {CHART_COLORS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/15 px-3 py-2.5">
                <span className="text-xs text-muted-foreground">{label}</span>
                <div className="flex items-center gap-2">
                  <label className="relative cursor-pointer">
                    <input
                      type="color"
                      value={safeHex(appearance.chartColors[key])}
                      onChange={(e) => patchChartColor(key, e.target.value)}
                      className="sr-only"
                    />
                    <div
                      className="h-7 w-7 rounded-md border border-border/50 transition-transform hover:scale-110"
                      style={{ background: appearance.chartColors[key] }}
                    />
                  </label>
                  <Input
                    value={appearance.chartColors[key]}
                    onChange={(e) => patchChartColor(key, e.target.value)}
                    className="h-7 w-24 font-mono text-xs bg-secondary/40 border-border/40"
                  />
                </div>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Chart overlays" sub="Default display state when you open a chart.">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30 divide-y divide-border/30">
            <Row icon={Grid3x3}     label="Grid lines"     sub="Horizontal and vertical price grid"            control={<Switch checked={appearance.chartOptions.showGrid}          onCheckedChange={(v) => patchChartOptions({ showGrid: v })} />} />
            <Row icon={MousePointer2} label="Trade markers" sub="Entry and exit arrows on the chart"           control={<Switch checked={appearance.chartOptions.defaultShowMarkers} onCheckedChange={(v) => patchChartOptions({ defaultShowMarkers: v })} />} />
            <Row icon={Target}      label="TP / SL zones"  sub="Take profit and stop loss shading"             control={<Switch checked={appearance.chartOptions.defaultShowTPSL}   onCheckedChange={(v) => patchChartOptions({ defaultShowTPSL: v })} />} />
            <Row icon={Zap} label="Replay speed" sub="Bars per second during chart replay" last control={
              <Stepper
                value={appearance.chartOptions.replaySpeed}
                onChange={(v) => patchChartOptions({ replaySpeed: v })}
                step={1} min={1} max={60}
              />
            } />
          </div>
        </Block>
      </div>
    ),

    // ── DEFAULTS ─────────────────────────────────────────────────────────
    defaults: (
      <div className="space-y-7">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Backtest Defaults</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Pre-fill values when creating a new backtest.</p>
          </div>
          <SavedPill show={savedSection === "defaults" && !defaultsChanged} />
        </div>

        <Block title="Account & Risk">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30 divide-y divide-border/30">
            <Row label="Starting Balance" sub="Initial cash available to the strategy" icon={Database} control={
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">$</span>
                <Stepper value={defaults.initialBalance} onChange={(v) => setDefaults((p) => ({ ...p, initialBalance: v }))} step={500} min={0} />
              </div>
            } />
            <Row label="Take Profit %" sub="Default distance from entry — 0 disables it" icon={Target} control={
              <div className="flex items-center gap-2">
                <Stepper value={defaults.takeProfitPercent} onChange={(v) => setDefaults((p) => ({ ...p, takeProfitPercent: v }))} step={0.5} min={0} />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            } />
            <Row label="Stop Loss %" sub="Default SL distance — 0 disables it" icon={AlertTriangle} control={
              <div className="flex items-center gap-2">
                <Stepper value={defaults.stopLossPercent} onChange={(v) => setDefaults((p) => ({ ...p, stopLossPercent: v }))} step={0.5} min={0} />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            } />
            <Row label="Transaction Costs" sub={
              defaults.feeMode === "commission"
                ? `Commission per trade · round-trip ${(defaults.feeValue * 2).toFixed(2)}%`
                : `Bid-ask spread · round-trip ${defaults.feeValue.toFixed(2)}%`
            } icon={Activity} last control={
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {(["commission", "spread"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDefaults((p) => ({ ...p, feeMode: m }))}
                      className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-all ${
                        defaults.feeMode === m
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      {m === "commission" ? "Fee" : "Spread"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <Stepper value={defaults.feeValue} onChange={(v) => setDefaults((p) => ({ ...p, feeValue: v }))} step={0.01} min={0} />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
            } />
          </div>
        </Block>

        <Block title="Execution">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30">
            <Row label="Default Timeframe" sub="Pre-selected timeframe in the strategy builder" icon={Zap} last control={
              <Select value={defaults.timeframe} onValueChange={(v) => setDefaults((p) => ({ ...p, timeframe: v }))}>
                <SelectTrigger className="w-28 h-8 bg-secondary/40 border-border/40 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                    <SelectItem key={tf} value={tf} className="font-mono">{tf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            } />
          </div>
        </Block>

        <p className="text-[11px] text-muted-foreground/50">Changes save automatically after a short pause.</p>
      </div>
    ),

    // ── NOTIFICATIONS ────────────────────────────────────────────────────
    notifications: (
      <div className="space-y-7">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Notifications</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">In-app alerts and sounds — no emails sent.</p>
          </div>
          <SavedPill show={savedSection === "notifications"} />
        </div>

        <Block title="Alerts">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30 divide-y divide-border/30">
            <Row icon={Activity} label="Backtest complete"     sub="Toast when a backtest finishes"          control={<Switch checked={notifications.backtestComplete}    onCheckedChange={(v) => setNotifications((p) => ({ ...p, backtestComplete: v }))} />} />
            <Row icon={Zap}      label="Optimization complete" sub="Toast when the optimizer finishes"       control={<Switch checked={notifications.optimizationComplete} onCheckedChange={(v) => setNotifications((p) => ({ ...p, optimizationComplete: v }))} />} last />
          </div>
        </Block>

        <Block title="Sound">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30">
            <Row
              icon={notifications.soundEnabled ? Volume2 : VolumeX}
              label="Sound effects"
              sub="Chime when tasks complete"
              last
              control={<Switch checked={notifications.soundEnabled} onCheckedChange={(v) => setNotifications((p) => ({ ...p, soundEnabled: v }))} />}
            />
          </div>
        </Block>

        <div className="flex items-start gap-3 rounded-xl border border-border/30 bg-muted/10 px-4 py-3.5">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Orca only sends in-app notifications. No email or push notifications are sent. All changes save immediately.
          </p>
        </div>
      </div>
    ),

    // ── ACCOUNT ──────────────────────────────────────────────────────────
    account: (
      <div className="space-y-7">
        <div>
          <h2 className="text-base font-semibold">Account</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Your account details and security options.</p>
        </div>

        <Block title="Details">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30 divide-y divide-border/30">
            {[
              { label: "Account ID",    value: user?.id ? `#${user.id}` : "—", mono: true },
              { label: "Email",         value: user?.email ?? "—" },
              ...(memberSince ? [{ label: "Member since", value: memberSince }] : []),
              { label: "Plan",          value: "Free", badge: <Badge className="text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary border-primary/20">Active</Badge> },
            ].map(({ label, value, mono, badge }, i, arr) => (
              <div key={label} className={`flex items-center justify-between px-4 py-3 ${i < arr.length - 1 ? "border-b border-border/30" : ""}`}>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
                  {badge}
                </div>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Change Password">
          <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Current password</Label>
                <Input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="••••••••"
                  className="bg-secondary border-border h-9 text-sm"
                  autoComplete="current-password"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">New password</Label>
                <Input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="••••••••"
                  className="bg-secondary border-border h-9 text-sm"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Confirm new password</Label>
                <Input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="••••••••"
                  className="bg-secondary border-border h-9 text-sm"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleChangePassword}
              disabled={pwSaving || !currentPw || !newPw || !confirmPw}
              className="gap-1.5"
            >
              {pwSaving ? "Saving…" : "Update password"}
            </Button>
          </div>
        </Block>

        <Block title="Session">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30">
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <LogOut className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Sign out</p>
                  <p className="text-xs text-muted-foreground">End your session on this device</p>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out?</AlertDialogTitle>
                    <AlertDialogDescription>You'll need to sign in again to access your account.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLogout}>Sign out</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </Block>

        <Block title="Data & settings">
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card/30">
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <RotateCcw className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Reset local settings</p>
                  <p className="text-xs text-muted-foreground">Restore theme, colors, and defaults. No data is deleted.</p>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This restores all appearance and default backtest settings to factory values. Your strategies, history, and indicators are not affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={resetAllSettings} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Reset settings
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </Block>

        <Block title="Danger zone">
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-4 py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">Delete account</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permanently removes your account, all strategies, backtest history, and associated data. This cannot be undone.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground shrink-0"
                onClick={() => { setDeletePw(""); setDeleteDialogOpen(true); }}
              >
                Delete account
              </Button>
            </div>
          </div>
        </Block>

        {/* Delete account confirmation dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => { if (!deleteLoading) setDeleteDialogOpen(open); }}>
          <AlertDialogContent className="border-border/70 bg-card/95 backdrop-blur-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-destructive">Delete your account?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  This permanently deletes your account and <strong>all</strong> associated data — strategies, backtest history, custom indicators, and paper accounts. There is no way to recover this.
                </span>
                <span className="block pt-1">Enter your password to confirm.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              type="password"
              placeholder="Your password"
              value={deletePw}
              onChange={(e) => setDeletePw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDeleteAccount()}
              autoComplete="current-password"
              className="mt-1"
              disabled={deleteLoading}
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleDeleteAccount(); }}
                disabled={deleteLoading || !deletePw}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteLoading ? "Deleting…" : "Delete my account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    ),
  };

  return (
    <DashboardLayout title="Settings" metaDescription="Configure your Orca workspace" maxWidth="max-w-5xl">
      <PageHeader
        icon={SlidersHorizontal}
        eyebrow="Workspace"
        title="Settings"
        description="Profile, appearance, backtest defaults, and account management."
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="flex gap-6"
      >
        {/* ── Left nav (desktop) ── */}
        <aside className="hidden md:flex flex-col w-52 shrink-0">
          <nav className="sticky top-6 space-y-0.5">
            {NAV.map(({ id, label, icon: Icon, shortcut }) => {
              const active = section === id;
              const hasPending = !!pending[id];
              return (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  {/* active accent strip */}
                  <span
                    className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full transition-all duration-200 ${
                      active ? "h-5 bg-primary" : "h-0"
                    }`}
                  />
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">{label}</span>
                  {/* keyboard shortcut badge */}
                  <kbd className={`hidden rounded px-1.5 py-0.5 text-[10px] font-mono transition-opacity group-hover:flex ${active ? "hidden" : ""}`}
                    style={{ opacity: 0.4 }}>
                    {shortcut}
                  </kbd>
                  {hasPending && <PendingDot />}
                </button>
              );
            })}

            {/* Keyboard hint */}
            <div className="mt-4 rounded-lg border border-border/30 bg-muted/10 px-3 py-2.5">
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                Press <kbd className="rounded bg-muted/40 px-1 font-mono text-[9px]">1</kbd>–<kbd className="rounded bg-muted/40 px-1 font-mono text-[9px]">5</kbd> to jump between sections
              </p>
            </div>
          </nav>
        </aside>

        {/* ── Mobile scroll nav ── */}
        <div className="md:hidden flex gap-1 overflow-x-auto pb-2 w-full shrink-0 -mx-1 px-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-all ${
                section === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {!!pending[id] && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
            </button>
          ))}
        </div>

        {/* ── Content panel ── */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="glass-card p-6"
            >
              {sections[section]}
            </motion.div>
          </AnimatePresence>

          {/* Section breadcrumb (mobile) */}
          <div className="md:hidden mt-3 flex items-center gap-1.5 text-xs text-muted-foreground px-1">
            <SlidersHorizontal className="h-3 w-3" />
            <ChevronRight className="h-3 w-3" />
            <span>{NAV.find((n) => n.id === section)?.label}</span>
          </div>
        </div>
      </motion.div>
    </DashboardLayout>
  );
};

export default Settings;
