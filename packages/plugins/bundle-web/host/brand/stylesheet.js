import { PRODUCT_NAME } from "./identity.js";
import { MARK_DATA_URI } from "./mark.js";

/**
 * Brand CSS over the shell (no logo slot). Prefer SVG viewBox + class* substrings
 * so hashed CSS-module suffixes survive dsh frontend rebuilds.
 */
export const BRAND_CSS = `
:root { --lares-mark: ${MARK_DATA_URI}; }

/* Boot splash */
[class*="_boot_"] [class*="_wordmark_"] { font-size: 0; letter-spacing: 0; }
[class*="_boot_"] [class*="_wordmark_"]::after {
  content: "${PRODUCT_NAME}";
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

/* Sidebar wordmark (expanded) */
button:has(> svg[viewBox="0 0 182 24"]) > svg[viewBox="0 0 182 24"] { display: none; }
button:has(> svg[viewBox="0 0 182 24"])::after {
  content: "${PRODUCT_NAME}";
  padding-left: 26px;
  background: var(--lares-mark) left center / 20px 20px no-repeat;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* Collapsed rail + hero mark */
svg[viewBox="0 0 23.16 17.04"] > path { display: none; }
svg[viewBox="0 0 23.16 17.04"] {
  background: var(--lares-mark) center / contain no-repeat;
  animation: none;
}

/* Hero headline: flex so ::after wordmark baselines correctly; drop preview badge */
[class*="_headlineText"] { display: flex; align-items: center; font-size: 0; }
[class*="_headlineText"]::after { content: "${PRODUCT_NAME}"; font-size: 26px; line-height: 32px; }
[class*="_previewBadge"] { display: none; }

/* Grow fish column to 40px; -1px optical align with the wordmark (no descenders) */
div:has(> [class*="_fishHitbox"]) { grid-template-columns: 40px auto auto; }
[class*="_fishHitbox"] > svg[viewBox="0 0 23.16 17.04"] {
  width: 40px;
  height: 40px;
  margin-top: -1px;
}
`;
