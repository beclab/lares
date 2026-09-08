import { PRODUCT_NAME } from "../brand/identity.js";

/**
 * Product mark: favicon, PWA icon, CSS splash, and slot occupants. Consumers
 * cache this URL, so the path and the SVG encoding are fixed — publishing the
 * artwork at a new path leaves stale favicons behind.
 * Geometry is the design delivery verbatim (ids renamed, aria-label injected).
 * Keep it a vector — favicon rasterizers drop <image> data URIs.
 */
export const MARKET_ICON_URL = "https://app.cdn.olares.com/appstore/lares/icon_new.png";

export const MARK_PATH = "/lares/mark.svg";
export const MARK_TYPE = "image/svg+xml";

export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none" role="img" aria-label="${PRODUCT_NAME}">
  <defs>
    <filter id="lares-mark-shadow" x="0" y="0" width="256" height="257.829" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
      <feOffset dy="1.82857"/>
      <feGaussianBlur stdDeviation="0.914286"/>
      <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0"/>
      <feBlend mode="normal" in2="shape" result="effect1_innerShadow"/>
    </filter>
    <linearGradient id="lares-mark" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFED52"/>
      <stop offset="1" stop-color="#EBD304"/>
    </linearGradient>
  </defs>
  <g filter="url(#lares-mark-shadow)">
    <rect width="256" height="256" fill="url(#lares-mark)"/>
    <path fill="#252121" d="M83.5926 125.858C85.7382 144.539 100.433 157.223 120.829 157.998L128.063 158.273H142.829C170.407 158.273 186.978 179.868 179.84 206.507H115.676C86.0222 206.506 68.2049 183.286 75.8798 154.643L83.5926 125.858ZM104.576 47.5429C133.193 47.5429 150.386 69.9505 142.98 97.5918L128.319 152.309C99.7025 152.309 82.5086 129.9 89.915 102.259L100.338 63.3618C102.534 55.1648 97.833 48.3464 89.5437 47.7079L87.3945 47.5429H104.576Z"/>
  </g>
</svg>`;

/** Inline form for CSS `background-image`, which cannot reference a route that may 404 mid-boot. */
export const MARK_DATA_URI = `url("data:image/svg+xml,${encodeURIComponent(MARK_SVG)}")`;
