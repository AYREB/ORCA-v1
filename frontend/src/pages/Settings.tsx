import { useState, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { motion, AnimatePresence } from "framer-motion";
import { User, Palette, SlidersHorizontal, Save, Moon, Sun, Monitor, Bell, Check } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "@/hooks/use-toast";

/* ─── Chart color palettes ─── */
const CHART_PALETTES = {
  classic: { up: "hsl(var(--success))", down: "hsl(var(--destructive))", line: "hsl(var(--primary))" },
  neon: { up: "#00ff88", down: "#ff00cc", line: "#00ccff" },
  muted: { up: "#a3c1ad", down: "#c3a38b", line: "#8b9dc3" },
} as const;

/* ─── Appearance Preview ─── */
const AppearancePreview = ({
  theme,
  chartColorScheme,
  density,
}: {
  theme: "dark" | "light" | "system";
  chartColorScheme: "classic" | "neon" | "muted";
  density: "compact" | "comfortable";
}) => {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const palette = CHART_PALETTES[chartColorScheme];
  const isCompact = density === "compact";

  const bg = isDark ? "#0a0a0f" : "#f8f9fa";
  const cardBg = isDark ? "#13131a" : "#ffffff";
  const border = isDark ? "#1e1e2a" : "#e2e2e8";
  const textPrimary = isDark ? "#e4e4e7" : "#18181b";
  const textMuted = isDark ? "#71717a" : "#a1a1aa";

  return (
    <div
      className="rounded-lg border overflow-hidden transition-all duration-300"
      style={{ borderColor: border, backgroundColor: bg }}
    >
      <div className="px-3 py-1.5 text-[10px] font-medium" style={{ color: textMuted, borderBottom: `1px solid ${border}` }}>
        Preview
      </div>
      <div className="p-3 flex gap-3" style={{ padding: isCompact ? "8px" : "12px" }}>
        {/* Mini chart */}
        <div
          className="flex-1 rounded-md border"
          style={{ borderColor: border, backgroundColor: cardBg, padding: isCompact ? "6px" : "10px" }}
        >
          <div className="text-[9px] font-medium mb-1.5" style={{ color: textMuted }}>BTC/USD</div>
          <svg viewBox="0 0 120 40" className="w-full" style={{ height: isCompact ? 28 : 36 }}>
            {/* Candles */}
            {[
              { x: 8, o: 28, c: 14, h: 10, l: 32 },
              { x: 20, o: 14, c: 20, h: 10, l: 24 },
              { x: 32, o: 22, c: 12, h: 8, l: 26 },
              { x: 44, o: 12, c: 18, h: 6, l: 22 },
              { x: 56, o: 18, c: 10, h: 6, l: 22 },
              { x: 68, o: 10, c: 16, h: 6, l: 20 },
              { x: 80, o: 16, c: 8, h: 4, l: 20 },
              { x: 92, o: 8, c: 14, h: 4, l: 18 },
              { x: 104, o: 14, c: 6, h: 2, l: 18 },
            ].map((c, i) => {
              const isUp = c.c < c.o;
              const color = isUp ? palette.up : palette.down;
              const top = Math.min(c.o, c.c);
              const height = Math.abs(c.o - c.c) || 1;
              return (
                <g key={i}>
                  <line x1={c.x} x2={c.x} y1={c.h} y2={c.l} stroke={color} strokeWidth="1" />
                  <rect x={c.x - 3} y={top} width="6" height={height} fill={color} rx="0.5" />
                </g>
              );
            })}
            {/* Indicator line */}
            <polyline
              points="8,22 20,16 32,18 44,14 56,13 68,12 80,11 92,10 104,8"
              fill="none"
              stroke={palette.line}
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.7"
            />
          </svg>
        </div>
        {/* Mini stat card */}
        <div
          className="rounded-md border flex flex-col justify-between"
          style={{
            borderColor: border,
            backgroundColor: cardBg,
            padding: isCompact ? "6px 8px" : "10px 12px",
            minWidth: 80,
          }}
        >
          <div className="text-[9px]" style={{ color: textMuted }}>Win Rate</div>
          <div className="font-bold" style={{ color: palette.up, fontSize: isCompact ? 14 : 18 }}>68.2%</div>
          <div className="text-[8px]" style={{ color: textMuted }}>24 trades</div>
        </div>
      </div>
    </div>
  );
};

/* ─── Main Settings Page ─── */
const Settings = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  const [profile, setProfile] = useState(settings.profile);
  const [appearance, setAppearance] = useState(settings.appearance);
  const [defaults, setDefaults] = useState(settings.backtestDefaults);
  const [notifications, setNotifications] = useState(settings.notifications);

  // Auto-save appearance
  const isFirstRender = useRef(true);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    updateSettings({ appearance });
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 1500);
    return () => clearTimeout(t);
  }, [appearance, updateSettings]);

  // Auto-save notifications
  const notifFirstRender = useRef(true);
  useEffect(() => {
    if (notifFirstRender.current) {
      notifFirstRender.current = false;
      return;
    }
    updateSettings({ notifications });
  }, [notifications, updateSettings]);

  const initials = profile.displayName
    ? profile.displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : profile.email ? profile.email[0].toUpperCase() : "?";

  const saveSection = (section: "profile" | "backtestDefaults", data: any) => {
    updateSettings({ [section]: data });
    toast({ title: "Settings saved", description: "Your changes have been saved." });
  };

  const themeOptions = [
    { value: "dark", label: "Dark", icon: Moon },
    { value: "light", label: "Light", icon: Sun },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  const chartSchemes = [
    { value: "classic", label: "Classic", colors: [CHART_PALETTES.classic.up, CHART_PALETTES.classic.line, CHART_PALETTES.classic.down] },
    { value: "neon", label: "Neon", colors: ["#00ff88", "#00ccff", "#ff00cc"] },
    { value: "muted", label: "Muted", colors: ["#a3c1ad", "#8b9dc3", "#c3a38b"] },
  ] as const;

  return (
    <div className="min-h-screen bg-background flex">
      <Helmet>
        <title>Settings | ORCA</title>
        <meta name="description" content="Configure your ORCA trading platform settings" />
      </Helmet>

      <DashboardSidebar
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      <main className={`flex-1 transition-all duration-300 ${isSidebarCollapsed ? "ml-16" : "ml-64"}`}>
        <div className="p-6 max-w-3xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <h1 className="text-2xl font-bold text-foreground mb-1">Settings</h1>
            <p className="text-sm text-muted-foreground mb-6">Manage your profile, appearance, and backtest defaults.</p>

            <Tabs defaultValue="profile" className="space-y-6">
              <TabsList className="bg-muted/50 border border-border">
                <TabsTrigger value="profile" className="gap-1.5 text-xs">
                  <User className="h-3.5 w-3.5" /> Profile
                </TabsTrigger>
                <TabsTrigger value="appearance" className="gap-1.5 text-xs">
                  <Palette className="h-3.5 w-3.5" /> Appearance
                </TabsTrigger>
                <TabsTrigger value="defaults" className="gap-1.5 text-xs">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Backtest Defaults
                </TabsTrigger>
                <TabsTrigger value="notifications" className="gap-1.5 text-xs">
                  <Bell className="h-3.5 w-3.5" /> Notifications
                </TabsTrigger>
              </TabsList>

              {/* ─── Profile ─── */}
              <TabsContent value="profile">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-lg">Profile</CardTitle>
                    <CardDescription>Your display name and email.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-16 w-16 border-2 border-primary/20">
                        <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="text-sm text-muted-foreground">Avatar is generated from your initials.</div>
                    </div>
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="displayName">Display Name</Label>
                        <Input id="displayName" value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} placeholder="Your name" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="you@example.com" />
                      </div>
                    </div>
                    <Button onClick={() => saveSection("profile", profile)} className="gap-1.5">
                      <Save className="h-3.5 w-3.5" /> Save Profile
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── Appearance ─── */}
              <TabsContent value="appearance">
                <Card className="border-border bg-card">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Appearance</CardTitle>
                      <CardDescription>Theme, chart colors, and layout density.</CardDescription>
                    </div>
                    <AnimatePresence>
                      {showSaved && (
                        <motion.div
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          className="flex items-center gap-1 text-xs text-primary"
                        >
                          <Check className="h-3.5 w-3.5" /> Saved
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Live Preview */}
                    <AppearancePreview
                      theme={appearance.theme}
                      chartColorScheme={appearance.chartColorScheme}
                      density={appearance.layoutDensity}
                    />

                    {/* Theme */}
                    <div className="space-y-3">
                      <Label>Theme</Label>
                      <div className="flex gap-2">
                        {themeOptions.map(({ value, label, icon: Icon }) => (
                          <button
                            key={value}
                            onClick={() => setAppearance({ ...appearance, theme: value })}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                              appearance.theme === value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Chart Color Scheme */}
                    <div className="space-y-3">
                      <Label>Chart Color Scheme</Label>
                      <div className="flex gap-3">
                        {chartSchemes.map(({ value, label, colors }) => (
                          <button
                            key={value}
                            onClick={() => setAppearance({ ...appearance, chartColorScheme: value })}
                            className={`flex flex-col items-center gap-2 px-4 py-3 rounded-lg border text-sm transition-all ${
                              appearance.chartColorScheme === value
                                ? "border-primary bg-primary/10"
                                : "border-border bg-muted/30 hover:bg-muted/50"
                            }`}
                          >
                            <div className="flex gap-1">
                              {colors.map((c, i) => (
                                <div key={i} className="w-5 h-5 rounded-full" style={{ backgroundColor: c }} />
                              ))}
                            </div>
                            <span className={appearance.chartColorScheme === value ? "text-primary font-medium" : "text-muted-foreground"}>
                              {label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Layout Density */}
                    <div className="space-y-3">
                      <Label>Layout Density</Label>
                      <div className="flex gap-2">
                        {(["compact", "comfortable"] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => setAppearance({ ...appearance, layoutDensity: d })}
                            className={`px-4 py-2.5 rounded-lg border text-sm font-medium capitalize transition-all ${
                              appearance.layoutDensity === d
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── Backtest Defaults ─── */}
              <TabsContent value="defaults">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-lg">Default Backtest Parameters</CardTitle>
                    <CardDescription>Pre-fill values when creating a new backtest.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="balance">Starting Balance ($)</Label>
                        <Input id="balance" type="number" value={defaults.initialBalance} onChange={(e) => setDefaults({ ...defaults, initialBalance: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="spread">Spread</Label>
                        <Input id="spread" type="number" step="0.001" value={defaults.spread} onChange={(e) => setDefaults({ ...defaults, spread: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tp">Take Profit %</Label>
                        <Input id="tp" type="number" value={defaults.takeProfitPercent} onChange={(e) => setDefaults({ ...defaults, takeProfitPercent: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sl">Stop Loss %</Label>
                        <Input id="sl" type="number" value={defaults.stopLossPercent} onChange={(e) => setDefaults({ ...defaults, stopLossPercent: Number(e.target.value) })} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timeframe">Default Timeframe</Label>
                      <Select value={defaults.timeframe} onValueChange={(v) => setDefaults({ ...defaults, timeframe: v })}>
                        <SelectTrigger id="timeframe" className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                            <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={() => saveSection("backtestDefaults", defaults)} className="gap-1.5">
                      <Save className="h-3.5 w-3.5" /> Save Defaults
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── Notifications ─── */}
              <TabsContent value="notifications">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-lg">Notifications & Alerts</CardTitle>
                    <CardDescription>Control in-app notifications and sound effects.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <div>
                        <div className="text-sm font-medium text-foreground">Backtest Complete</div>
                        <div className="text-xs text-muted-foreground">Show a toast when a backtest finishes running</div>
                      </div>
                      <Switch
                        checked={notifications.backtestComplete}
                        onCheckedChange={(v) => setNotifications({ ...notifications, backtestComplete: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <div>
                        <div className="text-sm font-medium text-foreground">Optimization Complete</div>
                        <div className="text-xs text-muted-foreground">Show a toast when the parameter optimizer finishes</div>
                      </div>
                      <Switch
                        checked={notifications.optimizationComplete}
                        onCheckedChange={(v) => setNotifications({ ...notifications, optimizationComplete: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div>
                        <div className="text-sm font-medium text-foreground">Sound Effects</div>
                        <div className="text-xs text-muted-foreground">Play a chime when tasks complete</div>
                      </div>
                      <Switch
                        checked={notifications.soundEnabled}
                        onCheckedChange={(v) => setNotifications({ ...notifications, soundEnabled: v })}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default Settings;
