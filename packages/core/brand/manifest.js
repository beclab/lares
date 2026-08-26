import { PRODUCT_NAME, THEME_COLOR } from "./identity.js";
import { MARK_PATH } from "../icons/mark.js";

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
