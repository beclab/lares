import { PRODUCT_NAME, THEME_COLOR } from "@lares/core/brand/identity";
import { MARK_PATH } from "@lares/core/icons/mark";

export { MARK_PATH, MARK_SVG, MARK_DATA_URI } from "@lares/core/icons/mark";

export const MANIFEST_PATH = "/lares/manifest.webmanifest";

export const MANIFEST = {
  id: "/",
  name: PRODUCT_NAME,
  short_name: PRODUCT_NAME,
  start_url: "/",
  scope: "/",
  display: "fullscreen",
  theme_color: THEME_COLOR,
  icons: [{ src: MARK_PATH, sizes: "any", type: "image/svg+xml", purpose: "any" }],
};
