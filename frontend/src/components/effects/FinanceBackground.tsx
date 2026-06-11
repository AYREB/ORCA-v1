import { useEffect, useRef } from "react";

/**
 * Animated canvas background for the auth experience.
 * Layers: faint grid, scrolling candlestick chart, two glowing price lines,
 * and floating finance glyphs ($, arrows, %). Colors are read from the
 * theme's CSS variables so it tracks light/dark mode automatically.
 */

interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
}

interface PricePoint {
  y: number;
}

interface Glyph {
  char: string;
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  life: number;
  maxLife: number;
  rotation: number;
  kind: "up" | "down" | "money";
}

const GLYPHS_UP = ["↑", "▲"];
const GLYPHS_DOWN = ["↓", "▼"];
const GLYPHS_MONEY = ["$", "€", "£", "¥", "%"];

const cssHsl = (raw: string, alpha: number) => {
  const [h, s, l] = raw.trim().split(/\s+/);
  return `hsla(${h}, ${s}, ${l}, ${alpha})`;
};

const FinanceBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const styles = getComputedStyle(document.documentElement);
    const readVar = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    const primary = readVar("--primary", "175 80% 50%");
    const profit = readVar("--chart-profit", "142 76% 45%");
    const loss = readVar("--chart-loss", "0 72% 51%");
    const border = readVar("--border", "222 30% 18%");
    const accent = readVar("--accent", "175 60% 40%");

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // --- Candlestick series (random walk) ---
    const CANDLE_W = 14;
    const CANDLE_GAP = 8;
    const candleCount = () => Math.ceil(width / (CANDLE_W + CANDLE_GAP)) + 2;

    let candlePrice = 0.5;
    const nextCandle = (): Candle => {
      const open = candlePrice;
      const move = (Math.random() - 0.48) * 0.09;
      const close = Math.min(0.95, Math.max(0.05, open + move));
      const high = Math.min(1, Math.max(open, close) + Math.random() * 0.03);
      const low = Math.max(0, Math.min(open, close) - Math.random() * 0.03);
      candlePrice = close;
      return { open, close, high, low };
    };

    let candles: Candle[] = Array.from({ length: candleCount() }, nextCandle);
    let candleScroll = 0;

    // --- Price lines (random walk, scrolling left) ---
    const LINE_STEP = 24;
    const makeLine = (start: number, volatility: number): PricePoint[] => {
      let v = start;
      return Array.from({ length: Math.ceil(width / LINE_STEP) + 3 }, () => {
        v = Math.min(0.9, Math.max(0.1, v + (Math.random() - 0.5) * volatility));
        return { y: v };
      });
    };
    let lineA = makeLine(0.45, 0.12);
    let lineB = makeLine(0.6, 0.08);
    let lineScroll = 0;

    // --- Floating glyphs ---
    const spawnGlyph = (initial = false): Glyph => {
      const roll = Math.random();
      const kind: Glyph["kind"] = roll < 0.34 ? "up" : roll < 0.55 ? "down" : "money";
      const pool = kind === "up" ? GLYPHS_UP : kind === "down" ? GLYPHS_DOWN : GLYPHS_MONEY;
      const maxLife = 500 + Math.random() * 400;
      return {
        char: pool[Math.floor(Math.random() * pool.length)],
        x: Math.random() * width,
        y: initial ? Math.random() * height : kind === "down" ? -30 : height + 30,
        size: 14 + Math.random() * 22,
        speed: 0.2 + Math.random() * 0.5,
        drift: (Math.random() - 0.5) * 0.3,
        life: initial ? Math.random() * maxLife : 0,
        maxLife,
        rotation: (Math.random() - 0.5) * 0.4,
        kind,
      };
    };
    let glyphs: Glyph[] = Array.from({ length: 26 }, () => spawnGlyph(true));

    const drawGrid = () => {
      ctx.strokeStyle = cssHsl(border, 0.25);
      ctx.lineWidth = 1;
      const step = 56;
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    };

    const drawCandles = () => {
      const top = height * 0.5;
      const band = height * 0.42;
      const slot = CANDLE_W + CANDLE_GAP;

      candles.forEach((c, i) => {
        const x = i * slot - candleScroll;
        if (x < -slot || x > width + slot) return;
        const bullish = c.close >= c.open;
        const color = cssHsl(bullish ? profit : loss, 0.22);

        const yOf = (v: number) => top + (1 - v) * band;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + CANDLE_W / 2, yOf(c.high));
        ctx.lineTo(x + CANDLE_W / 2, yOf(c.low));
        ctx.stroke();

        ctx.fillStyle = color;
        const bodyTop = yOf(Math.max(c.open, c.close));
        const bodyH = Math.max(2, Math.abs(yOf(c.open) - yOf(c.close)));
        ctx.fillRect(x, bodyTop, CANDLE_W, bodyH);
      });
    };

    const drawLine = (points: PricePoint[], colorVar: string, bandTop: number, bandH: number, alpha: number) => {
      const yOf = (v: number) => bandTop + (1 - v) * bandH;
      const stroke = cssHsl(colorVar, alpha);

      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.shadowColor = stroke;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = i * LINE_STEP - lineScroll;
        const y = yOf(p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;

      // gradient fill under the line
      const lastX = (points.length - 1) * LINE_STEP - lineScroll;
      ctx.lineTo(lastX, height);
      ctx.lineTo(-lineScroll, height);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, bandTop, 0, height);
      grad.addColorStop(0, cssHsl(colorVar, alpha * 0.35));
      grad.addColorStop(1, cssHsl(colorVar, 0));
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    };

    const drawGlyphs = () => {
      glyphs.forEach((g) => {
        const t = g.life / g.maxLife;
        const fade = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
        const color =
          g.kind === "up" ? cssHsl(profit, 0.4 * fade)
          : g.kind === "down" ? cssHsl(loss, 0.35 * fade)
          : cssHsl(primary, 0.35 * fade);

        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.rotation);
        ctx.font = `600 ${g.size}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(g.char, 0, 0);
        ctx.restore();
      });
    };

    const update = () => {
      candleScroll += 0.4;
      if (candleScroll >= CANDLE_W + CANDLE_GAP) {
        candleScroll = 0;
        candles.shift();
        candles.push(nextCandle());
      }

      lineScroll += 0.6;
      if (lineScroll >= LINE_STEP) {
        lineScroll = 0;
        const advance = (line: PricePoint[], volatility: number) => {
          line.shift();
          const last = line[line.length - 1].y;
          line.push({
            y: Math.min(0.9, Math.max(0.1, last + (Math.random() - 0.5) * volatility)),
          });
        };
        advance(lineA, 0.12);
        advance(lineB, 0.08);
      }

      glyphs = glyphs.map((g) => {
        const dir = g.kind === "down" ? 1 : -1;
        const next = {
          ...g,
          y: g.y + dir * g.speed,
          x: g.x + g.drift,
          life: g.life + 1,
        };
        const gone = next.life >= next.maxLife || next.y < -60 || next.y > height + 60;
        return gone ? spawnGlyph() : next;
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      drawGrid();
      drawLine(lineB, accent, height * 0.25, height * 0.55, 0.18);
      drawCandles();
      drawLine(lineA, primary, height * 0.3, height * 0.5, 0.3);
      drawGlyphs();
    };

    let frame = 0;
    let running = false;
    const loop = () => {
      update();
      draw();
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reducedMotion) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    // Only animate while the canvas is actually visible on screen.
    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    observer.observe(canvas);

    if (reducedMotion) {
      draw();
    } else {
      start();
    }

    const handleResize = () => {
      resize();
      candles = Array.from({ length: candleCount() }, nextCandle);
      lineA = makeLine(0.45, 0.12);
      lineB = makeLine(0.6, 0.08);
      if (reducedMotion) draw();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
};

const TICKER = [
  { symbol: "AAPL", price: "228.41", change: "+1.24%", up: true },
  { symbol: "NVDA", price: "131.18", change: "+3.07%", up: true },
  { symbol: "TSLA", price: "294.52", change: "-2.13%", up: false },
  { symbol: "SPY", price: "602.88", change: "+0.54%", up: true },
  { symbol: "BTC", price: "104,210", change: "+2.86%", up: true },
  { symbol: "MSFT", price: "447.92", change: "-0.32%", up: false },
  { symbol: "ETH", price: "3,884", change: "+1.92%", up: true },
  { symbol: "AMZN", price: "219.65", change: "+0.88%", up: true },
  { symbol: "META", price: "688.30", change: "-1.05%", up: false },
  { symbol: "GOOG", price: "186.74", change: "+0.41%", up: true },
];

export const TickerTape = () => (
  <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden border-t border-border/40 bg-background/60 py-2 backdrop-blur-sm">
    <div className="animate-ticker flex w-max">
      {[0, 1].map((copy) => (
        <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
          {TICKER.map((t) => (
            <span key={`${copy}-${t.symbol}`} className="font-mono-data mx-6 flex items-center gap-2 text-xs">
              <span className="font-semibold text-foreground/70">{t.symbol}</span>
              <span className="text-muted-foreground">{t.price}</span>
              <span className={t.up ? "text-[hsl(var(--chart-profit))]" : "text-[hsl(var(--chart-loss))]"}>
                {t.up ? "▲" : "▼"} {t.change}
              </span>
            </span>
          ))}
        </div>
      ))}
    </div>
  </div>
);

export default FinanceBackground;
