/**
 * İstanbul Ulaşım v4.0 — Crisp 24x24 inline SVG icon system
 * Consistent 2px stroke geometry inspired by Apple Maps & Citymapper.
 */

export const ICONS = {
  yakin:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>',
  rota:
    '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5.5"/>',
  otobus:
    '<path d="M6 17v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2"/><path d="M21 17v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2"/><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M3 11h18"/><circle cx="7.5" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14" r="1" fill="currentColor" stroke="none"/><path d="M8 4v-1a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1"/>',
  mb:
    '<rect x="2" y="5" width="20" height="12" rx="3"/><path d="M2 11h20"/><path d="M7 17v2"/><path d="M17 17v2"/><circle cx="6.5" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="14" r="1" fill="currentColor" stroke="none"/><path d="M9 8h6"/>',
  metro:
    '<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 11h14"/><circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="14.5" r="1" fill="currentColor" stroke="none"/><path d="M8 18l-2 3"/><path d="M16 18l2 3"/><path d="M9 6h6"/>',
  marmaray:
    '<rect x="4" y="4" width="16" height="14" rx="4"/><path d="M4 11h16"/><circle cx="8" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="14.5" r="1" fill="currentColor" stroke="none"/><path d="M7 18l-2 3"/><path d="M17 18l2 3"/><path d="M2 21c3-1 6-1 10 0s7 1 10 0"/>',
  tram:
    '<path d="M12 2v3"/><path d="M8 2h8"/><rect x="5" y="5" width="14" height="13" rx="3"/><path d="M5 12h14"/><circle cx="8.5" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15" r="1" fill="currentColor" stroke="none"/><path d="M8 18l-1.5 3"/><path d="M16 18l1.5 3"/>',
  fun:
    '<path d="M3 19L21 7"/><rect x="7" y="6" width="10" height="8" rx="2" transform="rotate(-31 12 10)"/><path d="M4 21h16"/>',
  tf:
    '<path d="M3 6l18-3"/><path d="M12 4.5V9"/><rect x="6" y="9" width="12" height="9" rx="2.5"/><path d="M6 13.5h12"/><path d="M10 9v4.5"/><path d="M14 9v4.5"/>',
  vapur:
    '<path d="M4 15l1.5-6h13L20 15"/><path d="M9 9V5h6v4"/><path d="M12 5V3"/><path d="M2 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0 2.5-.5 2-1l-1.5-2H3.5L2 17c-.5.5 0 1 0 1z"/>',
  trafik:
    '<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="7" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1.7" fill="currentColor" stroke="none"/>',
  ispark:
    '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9.5 16V8h3.5a2.5 2.5 0 0 1 0 5H9.5"/>',
  konum:
    '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  katman:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
  swap:
    '<path d="M7 16V4"/><path d="M3 8l4-4 4 4"/><path d="M17 8v12"/><path d="M13 16l4 4 4-4"/>',
  star:
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starFill:
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
  alert:
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  clock:
    '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  walk:
    '<circle cx="13" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><path d="M10 21l2-6 3 2.5V21"/><path d="M7 13l3-4 4 1 3 3"/><path d="M10 15l-2 6"/>',
  share:
    '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.86 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/>',
  moon:
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  chevronRight:
    '<polyline points="9 18 15 12 9 6"/>',
  chevronLeft:
    '<polyline points="15 18 9 12 15 6"/>',
  home:
    '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/>',
  work:
    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  busStop:
    '<circle cx="8" cy="6" r="3"/><path d="M8 9v12"/><path d="M5 21h6"/><rect x="13" y="5" width="7" height="9" rx="1.5"/><path d="M13 10h7"/>',
  close:
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  refresh:
    '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'
};

/**
 * Render an inline SVG icon string.
 * @param {string} name - Key in ICONS
 * @param {number} [size=18] - Width & height in pixels
 * @param {string} [className=''] - Optional CSS class
 * @returns {string}
 */
export function iconSvg(name, size = 18, className = '') {
  const body = ICONS[name] || ICONS.yakin;
  const cls = className ? ` class="${className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls}>${body}</svg>`;
}
