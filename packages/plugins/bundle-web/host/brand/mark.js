/** The Dina mark: favicon, PWA icon, and the in-app logo the stylesheet paints. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Dina">
  <defs>
    <linearGradient id="dina-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6366F1"/>
      <stop offset="1" stop-color="#22D3EE"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#dina-mark)"/>
  <path fill="#fff" fill-rule="evenodd" d="M10 8h5.4a8 8 0 0 1 0 16H10V8Zm3.6 3.4v9.2h1.8a4.6 4.6 0 0 0 0-9.2h-1.8Z"/>
</svg>`;

/** Inline form for CSS `background-image`, which cannot reference a route that may 404 mid-boot. */
export const MARK_DATA_URI = `url("data:image/svg+xml,${encodeURIComponent(MARK_SVG)}")`;

export const MARK_PATH = "/dina/mark.svg";
export const MANIFEST_PATH = "/dina/manifest.webmanifest";

export const MANIFEST = {
  id: "/",
  name: "Dina",
  short_name: "Dina",
  start_url: "/",
  scope: "/",
  display: "fullscreen",
  theme_color: "#6366F1",
  icons: [{ src: MARK_PATH, sizes: "any", type: "image/svg+xml", purpose: "any" }],
};
