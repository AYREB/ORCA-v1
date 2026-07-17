// One-off generator for the social share card (og:image / twitter:image).
// Renders a 1200x630 PNG into public/og-image.png.
//
//   node scripts/gen-og-image.mjs
//
// Requires `sharp` (devDependency). Re-run whenever the branding/copy changes.
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const logo = readFileSync(resolve(root, "public/orca-favicon.png")).toString("base64");

// Brand palette (dark theme, matches src/index.css)
const bgTop = "#060b16";
const bgBottom = "#0a1526";
const teal = "#1ae5d4";
const tealSoft = "#19b8ac";
const muted = "#93a4bd";

// A gentle rising equity curve for flavour, kept in the bottom band so it
// stays clear of the headline/subhead text.
const points = [0, 20, 12, 36, 28, 50, 40, 62, 78, 92, 108];
const curve = points
  .map((y, i) => `${(i / (points.length - 1)) * 1200},${605 - y}`)
  .join(" ");

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBottom}"/>
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="12%" r="55%">
      <stop offset="0%" stop-color="${teal}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${teal}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${teal}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${teal}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- equity curve flourish -->
  <polygon points="0,630 ${curve} 1200,630" fill="url(#curveFill)"/>
  <polyline points="${curve}" fill="none" stroke="${teal}" stroke-width="4" stroke-linejoin="round"/>

  <!-- brand row -->
  <image href="data:image/png;base64,${logo}" x="80" y="86" width="64" height="64"/>
  <text x="160" y="132" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#ffffff" letter-spacing="1">ORCA</text>
  <rect x="288" y="98" width="240" height="40" rx="20" fill="${teal}" fill-opacity="0.12"/>
  <text x="308" y="125" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="600" fill="${teal}">No Coding Required</text>

  <!-- headline -->
  <text x="80" y="300" font-family="Arial, Helvetica, sans-serif" font-size="82" font-weight="800" fill="#ffffff">Backtest your trading</text>
  <text x="80" y="392" font-family="Arial, Helvetica, sans-serif" font-size="82" font-weight="800" fill="${teal}">strategies. No code.</text>

  <!-- subhead -->
  <text x="82" y="462" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="400" fill="${muted}">Build, test &amp; optimize on real market data — free to start.</text>

  <!-- url pill -->
  <text x="82" y="556" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${tealSoft}">orcabacktest.com</text>
</svg>`;

const out = resolve(root, "public/og-image.png");
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(out, png);
console.log(`Wrote ${out} (${(png.length / 1024).toFixed(1)} KB)`);
