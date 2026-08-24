import { PRODUCT_NAME } from "./identity.js";
import { MARK_DATA_URI } from "./mark.js";

/**
 * Brand CSS for the surfaces dsh exposes no slot for: the boot splash (painted
 * before client plugins load) and the hero headline text. Everything the shell
 * offers a seat for is a slot occupant in @lares/client-lares — CSS over the
 * shell's own SVGs silently un-brands the app whenever dsh reshapes its markup.
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

/* Hero headline: flex so ::after wordmark baselines correctly; drop preview badge */
[class*="_headlineText"] { display: flex; align-items: center; font-size: 0; }
[class*="_headlineText"]::after { content: "${PRODUCT_NAME}"; font-size: 26px; line-height: 32px; }
[class*="_previewBadge"] { display: none; }
`;
