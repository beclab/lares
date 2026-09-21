const HEAD_OPEN = /<head[^>]*>/i;

/**
 * Put an inline script at the top of <head> so it runs before the shell bundle.
 * The marker attribute keeps repeated index taps idempotent.
 *
 * @param {string} html
 * @param {{marker: string, code: string}} script
 */
export function injectHeadScript(html, { marker, code }) {
  if (html.includes(marker)) return html;
  const tag = `<script ${marker}>${code}</script>`;
  const head = HEAD_OPEN.exec(html);
  return head === null ? `${tag}${html}` : html.replace(HEAD_OPEN, `${head[0]}${tag}`);
}
