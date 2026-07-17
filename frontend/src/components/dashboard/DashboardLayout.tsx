import { ReactNode, useState } from "react";
import VerifyEmailBanner from "@/components/dashboard/VerifyEmailBanner";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { Menu } from "lucide-react";
import orcaLogo from "@/assets/orca-logo.png";
import FinanceBackground from "@/components/effects/FinanceBackground";

const SIDEBAR_STORAGE_KEY = "orca_sidebar_collapsed";

interface DashboardLayoutProps {
  /** Document title, rendered as "<title> - Orca". */
  title: string;
  metaDescription?: string;
  /** Tailwind max-width class for the content column. */
  maxWidth?: string;
  children: ReactNode;
}

/**
 * Shared shell for every authenticated page: sidebar, animated finance
 * backdrop (same canvas as the sign-in experience, heavily subdued), and a
 * centered content column. Sidebar collapse state persists across pages.
 */
const DashboardLayout = ({
  title,
  metaDescription,
  maxWidth = "max-w-7xl",
  children,
}: DashboardLayoutProps) => {
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1"
  );
  // Mobile drawer — closed on every page load; opened via the hamburger.
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () =>
    setIsCollapsed((previous) => {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, previous ? "0" : "1");
      return !previous;
    });

  return (
    <>
      <Helmet>
        <title>{`${title} - Orca`}</title>
        {metaDescription && <meta name="description" content={metaDescription} />}
      </Helmet>

      <div className="relative min-h-screen bg-background">
        {/* Ambient market backdrop — kept faint so data stays readable. */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 opacity-30">
            <FinanceBackground />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-background/85 via-background/60 to-background/90" />
          <div className="absolute -top-48 left-1/3 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        {/* Mobile top bar — hamburger + brand. md+ uses the fixed sidebar. */}
        <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-xl md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card/60 text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
          <img src={orcaLogo} alt="Orca" className="h-7 w-7 rounded-md" />
          <span className="text-base font-bold tracking-tight">Orca</span>
          <span className="ml-auto truncate text-xs text-muted-foreground">{title}</span>
        </header>

        {/* Backdrop behind the mobile drawer */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        <DashboardSidebar
          isCollapsed={isCollapsed}
          onToggle={toggleSidebar}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        <main
          className={`relative transition-all duration-300 ml-0 pt-14 md:pt-0 ${isCollapsed ? "md:ml-16" : "md:ml-64"}`}
        >
          <div className={`${maxWidth} mx-auto space-y-6 p-4 sm:p-6`}>
            <VerifyEmailBanner />
            {children}
          </div>
        </main>
      </div>
    </>
  );
};

interface PageHeaderProps {
  icon?: LucideIcon;
  /** Small uppercase tag line above the title. */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Hero header with the sign-in card's gradient-border + glow treatment.
 */
export const PageHeader = ({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  children,
}: PageHeaderProps) => (
  <motion.section
    initial={{ opacity: 0, y: -12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, ease: "easeOut" }}
    className="relative rounded-2xl bg-gradient-to-b from-primary/40 via-border/60 to-border/40 p-px shadow-xl"
  >
    <div className="relative overflow-hidden rounded-[calc(1rem-1px)] bg-card/80 p-6 backdrop-blur-xl">
      <div className="absolute -right-24 -top-24 h-52 w-52 rounded-full bg-primary/15 blur-3xl" />
      <div className="absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          {Icon && (
            <div className="relative mt-0.5 hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 sm:flex">
              <div className="absolute inset-0 rounded-xl bg-primary/15 blur-md animate-pulse-glow" />
              <Icon className="relative h-6 w-6 text-primary" />
            </div>
          )}
          <div className="space-y-1.5">
            {eyebrow && (
              <p className="text-xs font-medium uppercase tracking-widest text-primary/90">
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
            {description && (
              <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children && <div className="relative z-10 mt-4">{children}</div>}
    </div>
  </motion.section>
);

export default DashboardLayout;
