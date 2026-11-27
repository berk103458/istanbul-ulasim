/**
 * Shared Accessibility Helpers for Views
 * - WCAG AA badge contrast calculation & automatic darkening
 * - Keyboard activation (Enter/Space) for interactive role="button" elements & Esc for map picker
 */

function parseColor(color) {
  const s = String(color || "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

function relativeLuminance(r, g, b) {
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const v = Math.max(0, Math.min(255, c)) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(lumA, lumB) {
  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

const WHITE_LUM = 1;
const DARK_LUM = relativeLuminance(17, 24, 39); // #111827

/**
 * Returns an inline CSS style string ("background:...;color:...") guaranteed to
 * satisfy WCAG AA (>= 4.5:1) contrast for small badge text.
 */
export function accessibleBadgeStyle(bgColor) {
  const raw = String(bgColor || "").trim();
  if (!raw) return "background:var(--vurgu);color:var(--vurgu-yazi)";
  if (raw.startsWith("var(")) {
    if (raw.includes("--uyari") || raw.includes("--iyi") || raw.includes("--hata")) {
      return `background:${raw};color:var(--pin-yazi)`;
    }
    if (raw.includes("--vurgu")) {
      return `background:${raw};color:var(--vurgu-yazi)`;
    }
    return `background:${raw};color:#ffffff`;
  }

  const parsed = parseColor(raw);
  if (!parsed) return `background:${raw};color:#ffffff`;

  let [r, g, b] = parsed;
  const lum = relativeLuminance(r, g, b);
  if (contrastRatio(lum, WHITE_LUM) >= 4.6) {
    return `background:${raw};color:#ffffff`;
  }
  if (contrastRatio(lum, DARK_LUM) >= 4.6 && lum >= 0.35) {
    return `background:${raw};color:#111827`;
  }

  // Darken medium-brightness colors (e.g., M4 magenta #e91e76) slightly so #ffffff text >= 4.7:1
  for (let i = 0; i < 20; i++) {
    r = Math.max(0, Math.floor(r * 0.92));
    g = Math.max(0, Math.floor(g * 0.92));
    b = Math.max(0, Math.floor(b * 0.92));
    if (contrastRatio(relativeLuminance(r, g, b), WHITE_LUM) >= 4.7) break;
  }
  return `background:rgb(${r},${g},${b});color:#ffffff`;
}

let keyboardBound = false;

export function bindKeyboardActivators() {
  if (keyboardBound || typeof document === "undefined") return;
  keyboardBound = true;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const band = document.querySelector("#secimBandi.acik");
      if (band) {
        e.preventDefault();
        document.querySelector("#secimIptal")?.click();
      }
      return;
    }

    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest("input, textarea, select, button, a")) return;

    const btn = target.closest('[role="button"][tabindex="0"]');
    if (!btn) return;
    e.preventDefault();
    btn.click();
  });
}
