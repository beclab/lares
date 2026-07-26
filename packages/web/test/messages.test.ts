import type { AgentMessage, ToolResultMessage, UserMessage } from "@lares/shared";
import { describe, expect, it } from "vitest";
import {
	commitUserEcho,
	extractPatch,
	formatCost,
	formatTokens,
	indexToolResults,
	isEmptyThinking,
	parseDiff,
	toolPreview,
	toolResultImages,
	toolResultText,
	userContent,
} from "../src/lib/messages";

function toolResult(overrides: Partial<ToolResultMessage> = {}): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "text", text: "file contents" }],
		isError: false,
		timestamp: 0,
		...overrides,
	} as ToolResultMessage;
}

describe("userContent", () => {
	it("passes a plain string body through", () => {
		expect(userContent("hello")).toEqual({ text: "hello", images: [] });
	});

	it("separates text from attached images", () => {
		const result = userContent([
			{ type: "text", text: "look" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]);

		expect(result.text).toBe("look");
		expect(result.images).toHaveLength(1);
	});

	it("joins multiple text parts with newlines", () => {
		const result = userContent([
			{ type: "text", text: "one" },
			{ type: "text", text: "two" },
		]);

		expect(result.text).toBe("one\ntwo");
	});
});

describe("indexToolResults", () => {
	it("keys results by the call they answer and skips other roles", () => {
		const messages = [
			{ role: "user", content: "hi", timestamp: 0 },
			toolResult({ toolCallId: "a" }),
			toolResult({ toolCallId: "b" }),
		] as AgentMessage[];

		const index = indexToolResults(messages);

		expect([...index.keys()]).toEqual(["a", "b"]);
	});
});

describe("toolPreview", () => {
	it("prefers the command over other arguments", () => {
		expect(toolPreview({ path: "/tmp", command: "ls -la" })).toBe("ls -la");
	});

	it("collapses whitespace and truncates long values", () => {
		const preview = toolPreview({ command: `echo ${"x".repeat(300)}` });

		expect(preview.endsWith("…")).toBe(true);
		expect(preview.length).toBeLessThanOrEqual(141);
	});

	it("falls back to the first value when no known key is present", () => {
		expect(toolPreview({ unusual: "value" })).toBe("value");
	});

	it("returns an empty string for empty arguments", () => {
		expect(toolPreview({})).toBe("");
	});
});

describe("extractPatch", () => {
	it("prefers a unified patch over the display diff", () => {
		const result = toolResult({ details: { patch: "--- a\n+++ b", diff: "other" } });

		expect(extractPatch(result)).toBe("--- a\n+++ b");
	});

	it("ignores whitespace-only patches", () => {
		expect(extractPatch(toolResult({ details: { patch: "   " } }))).toBeNull();
	});

	it("returns null when the tool reports no details", () => {
		expect(extractPatch(toolResult())).toBeNull();
		expect(extractPatch(undefined)).toBeNull();
	});
});

describe("parseDiff", () => {
	it("classifies each line of a unified patch", () => {
		const lines = parseDiff("--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n unchanged");

		expect(lines.map((line) => line.kind)).toEqual(["meta", "meta", "meta", "del", "add", "context"]);
	});
});

describe("tool result content", () => {
	it("concatenates text parts", () => {
		const result = toolResult({
			content: [
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			],
		});

		expect(toolResultText(result)).toBe("a\nb");
	});

	it("separates image parts", () => {
		const result = toolResult({
			content: [
				{ type: "text", text: "a" },
				{ type: "image", data: "AA", mimeType: "image/png" },
			],
		});

		expect(toolResultImages(result)).toHaveLength(1);
		expect(toolResultText(result)).toBe("a");
	});
});

describe("commitUserEcho", () => {
	const user = (text: string, timestamp = 0): UserMessage =>
		({ role: "user", content: text, timestamp }) as UserMessage;

	it("replaces the optimistic bubble instead of appending a second copy", () => {
		const bubble = user("hello");
		const echo = user("hello", 99);

		const result = commitUserEcho([bubble], [bubble], echo);

		expect(result.messages).toEqual([echo]);
		expect(result.pending).toEqual([]);
	});

	it("appends a steered message, which never had a bubble", () => {
		const earlier = user("first");
		const steered = user("stop and do this instead", 99);

		const result = commitUserEcho([earlier], [], steered);

		expect(result.messages).toEqual([earlier, steered]);
	});

	it("keeps both copies of the same text sent twice", () => {
		const first = user("again");
		const second = user("again");
		const messages = [first, second];
		const pending = [first, second];

		const afterFirst = commitUserEcho(messages, pending, user("again", 1));
		const afterSecond = commitUserEcho(afterFirst.messages, afterFirst.pending, user("again", 2));

		expect(afterSecond.messages).toHaveLength(2);
		expect(afterSecond.messages.map((message) => message.timestamp)).toEqual([1, 2]);
		expect(afterSecond.pending).toEqual([]);
	});

	it("matches a bubble that carried images alongside its text", () => {
		const bubble = {
			role: "user",
			content: [
				{ type: "text", text: "look at this" },
				{ type: "image", data: "AA", mimeType: "image/png" },
			],
			timestamp: 0,
		} as UserMessage;
		const echo = user("look at this", 99);

		const result = commitUserEcho([bubble], [bubble], echo);

		expect(result.messages).toEqual([echo]);
	});

	it("appends assistant messages untouched", () => {
		const bubble = user("hello");
		const assistant = { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 1 } as AgentMessage;

		const result = commitUserEcho([bubble], [bubble], assistant);

		expect(result.messages).toEqual([bubble, assistant]);
		expect(result.pending).toEqual([bubble]);
	});

	it("appends the echo when its bubble is gone from the transcript", () => {
		const bubble = user("hello");
		const echo = user("hello", 99);

		const result = commitUserEcho([], [bubble], echo);

		expect(result.messages).toEqual([echo]);
		expect(result.pending).toEqual([]);
	});
});

describe("isEmptyThinking", () => {
	it("flags a thinking block with no content", () => {
		expect(isEmptyThinking({ type: "thinking", thinking: "  " })).toBe(true);
		expect(isEmptyThinking({ type: "thinking", thinking: "reasoning" })).toBe(false);
		expect(isEmptyThinking({ type: "text", text: "" })).toBe(false);
	});
});

describe("formatting", () => {
	it("abbreviates token counts", () => {
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(2_500_000)).toBe("2.5M");
	});

	it("keeps sub-cent costs readable", () => {
		expect(formatCost(0)).toBe("$0");
		expect(formatCost(0.0012)).toBe("$0.0012");
		expect(formatCost(1.5)).toBe("$1.50");
	});
});
