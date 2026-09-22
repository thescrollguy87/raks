// Derives print-legible {bg, text} colors from a Shift Definition's own
// configured `color` — used by the Shift Roster PDF export (see
// reportRenderService.toRosterPdfBuffer). A shift's configured color is
// picked for a solid on-screen block (RosterCell in RosterPage.jsx) and is
// often too light/saturated to read as text on white paper, so this
// re-expresses the SAME hue as a pale print background plus a darker,
// readable text color, rather than using the raw hex for both. Never a
// hardcoded per-code palette — every derivation starts from the tenant's
// actual configured color.
const FALLBACK_HEX = "#94A3B8"; // neutral gray — a roster cell whose code has no matching Shift Definition at all falls back to this

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r1, g1, b1;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`.toUpperCase();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// hue preserved from the configured color; background pinned pale (L=93%,
// saturation softened so it reads as a tint, not a highlighter); text
// pinned dark (L=30%) so every derived pair has the same, reliable
// print contrast regardless of how light/saturated the source color is.
function deriveCellColors(hex) {
  const rgb = hexToRgb(hex) || hexToRgb(FALLBACK_HEX);
  const { h, s } = rgbToHsl(rgb);
  const bg = hslToHex(h, clamp(s * 0.7, 8, 55), 93);
  const text = hslToHex(h, clamp(s * 0.85, 12, 75), 30);
  return { bg, text };
}

module.exports = { deriveCellColors, FALLBACK_HEX };
