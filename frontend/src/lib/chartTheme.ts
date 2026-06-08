// Shared helpers for applying the user's custom chart color scheme
// (settings.appearance.chartColors, see @/hooks/useSettings) to chart
// rendering. `ChartColors` values are validated as #rrggbb hex on save, but
// these stay defensive — `safeColor` falls back to a sane default for
// anything else, and `colorWithAlpha` builds an rgba() string for grid lines,
// fills, and other translucent strokes from a hex value.

export const safeColor = (value: string | undefined, fallback: string) =>
  /^#[0-9a-fA-F]{6}$/.test(value || "") ? value! : fallback;

export const colorWithAlpha = (value: string | undefined, alpha: number, fallback: string) => {
  const hex = safeColor(value, fallback).replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

// Linearly blends two #rrggbb colors (t=0 -> from, t=1 -> to) and returns an
// rgba() string at the given alpha — used for loss/profit gradients (e.g.
// Monte Carlo sample paths, genetic optimizer node fills) so the gradient
// endpoints follow the user's candleDown/candleUp scheme instead of fixed hues.
export const mixColors = (
  fromHex: string | undefined,
  toHex: string | undefined,
  t: number,
  alpha: number,
  fromFallback: string,
  toFallback: string,
) => {
  const from = hexToRgb(safeColor(fromHex, fromFallback));
  const to = hexToRgb(safeColor(toHex, toFallback));
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(from.r + (to.r - from.r) * clamped);
  const g = Math.round(from.g + (to.g - from.g) * clamped);
  const b = Math.round(from.b + (to.b - from.b) * clamped);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
