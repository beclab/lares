/**
 * dsh's MarkdownText keeps only http / https / mailto targets: a workspace-relative
 * link or image renders as inert text. Rewriting those targets to the plugin's own
 * same-origin raw URL is what makes them render at all; the view maps the URL back
 * to a workspace path when a click lands on one.
 */

const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+).*?\1/g;
const TARGET = /(!?)\[((?:[^\][\\]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s()]*)([^)]*)\)/g;
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function directorySegments(path) {
  const segments = String(path ?? "").split(/[/\\]/).filter((part) => part !== "");
  segments.pop();
  return segments;
}

/**
 * Resolve a markdown link or image target against the previewed file.
 * @returns the workspace-relative path, or null when the target is external,
 * empty, or climbs out of the workspace.
 */
export function workspaceTargetPath(fromPath, target) {
  const raw = String(target ?? "").trim().replace(/^<|>$/g, "");
  if (raw === "" || ABSOLUTE.test(raw)) return null;
  const [locator] = raw.split(/[?#]/);
  if (locator === "") return null;
  let decoded = locator;
  try {
    decoded = decodeURIComponent(locator);
  } catch {
    // A malformed escape is a literal path; the host validates it either way.
  }
  const segments = decoded.startsWith("/") ? [] : directorySegments(fromPath);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      segments.push(part);
      continue;
    }
    if (segments.length === 0) return null;
    segments.pop();
  }
  return segments.length === 0 ? null : segments.join("/");
}

function rewriteSpan(span, fromPath, hrefFor) {
  return span.replace(TARGET, (match, bang, label, target, tail) => {
    const path = workspaceTargetPath(fromPath, target);
    return path === null ? match : `${bang}[${label}](${hrefFor(path)}${tail})`;
  });
}

/**
 * Rewrite every workspace-relative link and image target in `text` to an absolute
 * URL. Fenced blocks and inline code keep their source verbatim.
 * @param hrefFor - workspace path → absolute URL the renderer accepts.
 */
export function rewriteWorkspaceTargets(text, fromPath, hrefFor) {
  const lines = String(text ?? "").split("\n");
  let fence = null;
  return lines
    .map((line) => {
      const marker = FENCE.exec(line);
      if (fence !== null) {
        if (marker !== null && marker[1].startsWith(fence[0]) && marker[1].length >= fence.length) fence = null;
        return line;
      }
      if (marker !== null) {
        fence = marker[1];
        return line;
      }
      let cursor = 0;
      let out = "";
      INLINE_CODE.lastIndex = 0;
      for (let code = INLINE_CODE.exec(line); code !== null; code = INLINE_CODE.exec(line)) {
        out += rewriteSpan(line.slice(cursor, code.index), fromPath, hrefFor) + code[0];
        cursor = code.index + code[0].length;
      }
      return out + rewriteSpan(line.slice(cursor), fromPath, hrefFor);
    })
    .join("\n");
}
