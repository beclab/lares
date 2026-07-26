import { describe, expect, it } from "vitest";
import { renderInlineMarkdown, renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown", () => {
	it("splits top-level fences into their own segments", () => {
		const segments = renderMarkdown("before\n\n```ts\nconst a = 1;\n```\n\nafter");

		expect(segments.map((segment) => segment.kind)).toEqual(["html", "code", "html"]);
		expect(segments[1]).toMatchObject({ kind: "code", lang: "ts", code: "const a = 1;\n" });
	});

	it("keeps a fence without a language usable", () => {
		const [segment] = renderMarkdown("```\nplain\n```");

		expect(segment).toMatchObject({ kind: "code", lang: "", code: "plain\n" });
	});

	it("highlights a fence nested in a list without splitting it out", () => {
		const segments = renderMarkdown("- item\n\n  ```js\n  nested();\n  ```\n");

		expect(segments.every((segment) => segment.kind === "html")).toBe(true);
		const html = segments[0]?.kind === "html" ? segments[0].html : "";
		expect(html).toContain("hljs");
		expect(html).toContain("nested");
	});

	it("renders GitHub tables", () => {
		const [segment] = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");

		expect(segment?.kind === "html" && segment.html).toContain("<table>");
	});

	it("strips script tags but keeps ordinary html", () => {
		const [segment] = renderMarkdown('<div class="ok">safe</div><script>alert(1)</script>');

		const html = segment?.kind === "html" ? segment.html : "";
		expect(html).toContain("safe");
		expect(html).not.toContain("<script");
	});

	it("drops event handler attributes", () => {
		const [segment] = renderMarkdown('<img src="x" onerror="alert(1)">');

		expect(segment?.kind === "html" && segment.html).not.toContain("onerror");
	});

	it("renders inline math through katex", () => {
		const [segment] = renderMarkdown("energy is $e = mc^2$ exactly");

		expect(segment?.kind === "html" && segment.html).toContain("katex");
	});

	it("produces no segments for empty input", () => {
		expect(renderMarkdown("")).toEqual([]);
	});
});

describe("renderInlineMarkdown", () => {
	it("emits inline markup without wrapping it in a paragraph", () => {
		const html = renderInlineMarkdown("a **bold** word");

		expect(html).toBe("a <strong>bold</strong> word");
	});
});
