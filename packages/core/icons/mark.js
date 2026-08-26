import { PRODUCT_NAME } from "../brand/identity.js";

/**
 * Product mark: favicon, PWA icon, CSS splash, and slot occupants.
 * An eave over a resident orb — two strokes, readable at 20px collapsed rail.
 */
export const MARK_PATH = "/lares/mark.svg";

export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="${PRODUCT_NAME}">
  <defs>
    <linearGradient id="lares-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6366F1"/>
      <stop offset="1" stop-color="#22D3EE"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#lares-mark)"/>
  <path fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" d="M6.8 17.4 16 9.2l9.2 8.2"/>
  <circle cx="16" cy="22" r="3.2" fill="#fff"/>
</svg>`;

/** Inline form for CSS `background-image`, which cannot reference a route that may 404 mid-boot. */
export const MARK_DATA_URI = `url("data:image/svg+xml,${encodeURIComponent(MARK_SVG)}")`;
