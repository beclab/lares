import katexImport from "@vscode/markdown-it-katex";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";

// The package is CommonJS with an `exports.default`. The dev server unwraps
// that to the function, the production bundle hands back the module object,
// and markdown-it then calls `.apply` on a non-function.
const katexPlugin = (katexImport as { default?: typeof katexImport }).default ?? katexImport;

const md = new MarkdownIt({
	html: true,
	linkify: true,
	breaks: false,
	highlight: (code, lang) => `<pre class="hljs"><code>${highlight(code, lang)}</code></pre>`,
});

md.use(katexPlugin, { throwOnError: false, strict: false });

/**
 * Top-level fences become their own segment so the caller can render them as
 * live components. Mermaid diagrams and copy buttons need real Vue nodes;
 * everything else is static HTML and goes through `v-html`.
 */
export type MarkdownSegment = { kind: "html"; html: string } | { kind: "code"; lang: string; code: string };

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * KaTeX and highlight.js rely on class names a default sanitizer profile
 * strips, so the allow-list is widened rather than the sanitizer disabled.
 */
function sanitize(html: string): string {
	return DOMPurify.sanitize(html, {
		ADD_ATTR: ["target", "rel"],
		FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
	});
}

export function renderMarkdown(source: string): MarkdownSegment[] {
	const tokens = md.parse(source, {});
	const segments: MarkdownSegment[] = [];
	let pending: typeof tokens = [];

	const flush = () => {
		if (pending.length === 0) return;
		const html = sanitize(md.renderer.render(pending, md.options, {}));
		if (html.trim()) segments.push({ kind: "html", html });
		pending = [];
	};

	for (const token of tokens) {
		if (token.type === "fence" && token.level === 0) {
			flush();
			segments.push({ kind: "code", lang: (token.info || "").trim().split(/\s+/)[0] ?? "", code: token.content });
			continue;
		}
		pending.push(token);
	}
	flush();

	return segments;
}

/** Renders inline markdown without block elements, for one-line previews. */
export function renderInlineMarkdown(source: string): string {
	return sanitize(md.renderInline(source));
}

export function highlight(code: string, lang: string): string {
	if (lang && hljs.getLanguage(lang)) {
		try {
			return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
		} catch {
			// Fall through to the escaped plain-text rendering below.
		}
	}
	return escapeHtml(code);
}
