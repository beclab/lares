import type { AgentMessage, ImageContent, TextContent, ToolResultMessage, UserMessage } from "@lares/shared";

export type AssistantBlock = AgentMessage extends { role: "assistant"; content: infer C }
	? C extends readonly (infer B)[]
		? B
		: never
	: never;

export function isText(block: unknown): block is TextContent {
	return typeof block === "object" && block !== null && (block as { type?: string }).type === "text";
}

export function isImage(block: unknown): block is ImageContent {
	return typeof block === "object" && block !== null && (block as { type?: string }).type === "image";
}

/** Normalises the two shapes a user message body can take. */
export function userContent(content: string | (TextContent | ImageContent)[]): {
	text: string;
	images: ImageContent[];
} {
	if (typeof content === "string") return { text: content, images: [] };
	const text = content
		.filter(isText)
		.map((block) => block.text)
		.join("\n");
	return { text, images: content.filter(isImage) };
}

/**
 * Reconcile a user message arriving on the stream with the bubble already shown.
 *
 * pi echoes every user message back, including the one `submit` rendered
 * optimistically. The echo cannot simply be dropped: steered and queued
 * messages travel the same path and never had a bubble, so they would vanish.
 * Instead the matching bubble is swapped for the authoritative message, which
 * also picks up the real timestamp and id.
 */
export function commitUserEcho(
	messages: AgentMessage[],
	pending: UserMessage[],
	echo: AgentMessage,
): { messages: AgentMessage[]; pending: UserMessage[] } {
	if (echo.role !== "user") return { messages: [...messages, echo], pending };

	const text = userContent(echo.content).text;
	const bubble = pending.find((candidate) => userContent(candidate.content).text === text);
	if (!bubble) return { messages: [...messages, echo], pending };

	const remaining = pending.filter((candidate) => candidate !== bubble);
	const index = messages.indexOf(bubble);
	if (index === -1) return { messages: [...messages, echo], pending: remaining };

	const next = [...messages];
	next[index] = echo;
	return { messages: next, pending: remaining };
}

export function toolResultText(result: ToolResultMessage): string {
	return result.content
		.filter(isText)
		.map((block) => block.text)
		.join("\n");
}

export function toolResultImages(result: ToolResultMessage): ImageContent[] {
	return result.content.filter(isImage);
}

export function imageDataUrl(image: ImageContent): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

/** Tool results are rendered under their call, so they need to be findable by id. */
export function indexToolResults(messages: AgentMessage[]): Map<string, ToolResultMessage> {
	const map = new Map<string, ToolResultMessage>();
	for (const message of messages) {
		if (message.role === "toolResult") map.set(message.toolCallId, message);
	}
	return map;
}

const PREVIEW_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "name"];

/** One-line summary shown on a collapsed tool call. */
export function toolPreview(args: Record<string, unknown>): string {
	for (const key of PREVIEW_KEYS) {
		const value = args[key];
		if (typeof value === "string" && value) return truncate(value);
	}
	const first = Object.values(args).find((value) => value !== undefined && value !== null);
	if (first === undefined) return "";
	return truncate(typeof first === "string" ? first : JSON.stringify(first));
}

function truncate(value: string, max = 140): string {
	const oneLine = value.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** The edit tool ships a unified patch that is worth rendering as a diff. */
export function extractPatch(result: ToolResultMessage | undefined): string | null {
	const details = result?.details as { patch?: unknown; diff?: unknown } | undefined;
	if (typeof details?.patch === "string" && details.patch.trim()) return details.patch;
	if (typeof details?.diff === "string" && details.diff.trim()) return details.diff;
	return null;
}

export interface DiffLine {
	kind: "add" | "del" | "context" | "meta";
	text: string;
}

export function parseDiff(patch: string): DiffLine[] {
	return patch.split("\n").map((text) => {
		if (text.startsWith("@@") || text.startsWith("---") || text.startsWith("+++") || text.startsWith("diff ")) {
			return { kind: "meta" as const, text };
		}
		if (text.startsWith("+")) return { kind: "add" as const, text };
		if (text.startsWith("-")) return { kind: "del" as const, text };
		return { kind: "context" as const, text };
	});
}

/** Thinking blocks that never received content would otherwise render as empty boxes. */
export function isEmptyThinking(block: unknown): boolean {
	return (
		typeof block === "object" &&
		block !== null &&
		(block as { type?: string }).type === "thinking" &&
		!(block as { thinking?: string }).thinking?.trim()
	);
}

/** Whether a submitted message interrupts the current turn or waits for it. */
export type SubmitIntent = "auto" | "steer" | "followUp";

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
	return String(count);
}

export function formatCost(cost: number): string {
	if (cost === 0) return "$0";
	return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}
