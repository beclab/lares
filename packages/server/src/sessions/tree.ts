import type { SessionTreeNode as PiTreeNode, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionTreeNode } from "@lares/shared";

const PREVIEW_LIMIT = 120;

function truncate(value: string): string {
	const oneLine = value.replace(/\s+/g, " ").trim();
	return oneLine.length > PREVIEW_LIMIT ? `${oneLine.slice(0, PREVIEW_LIMIT)}…` : oneLine;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return typeof part === "object" && part !== null && (part as { type?: string }).type === "text";
		})
		.map((part) => part.text)
		.join(" ");
}

/** A short human label for a node, so the tree reads as a conversation. */
export function entryPreview(entry: SessionEntry): { role?: string; preview: string } {
	switch (entry.type) {
		case "message": {
			const message = entry.message;
			if (message.role === "user") return { role: "user", preview: truncate(textOf(message.content)) };
			if (message.role === "assistant") {
				const text = message.content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join(" ");
				const tools = message.content.filter((block) => block.type === "toolCall").map((block) => block.name);
				return { role: "assistant", preview: truncate(text || tools.join(", ")) };
			}
			if (message.role === "toolResult") return { role: "toolResult", preview: truncate(message.toolName) };
			if (message.role === "bashExecution") return { role: "bashExecution", preview: truncate(message.command) };
			return { role: message.role, preview: "" };
		}
		case "compaction":
			return { preview: truncate(entry.summary) };
		case "branch_summary":
			return { preview: truncate(entry.summary) };
		case "model_change":
			return { preview: `${entry.provider}/${entry.modelId}` };
		case "thinking_level_change":
			return { preview: entry.thinkingLevel };
		case "session_info":
			return { preview: entry.name ?? "" };
		default:
			return { preview: "" };
	}
}

/**
 * Walks up from the leaf so the UI can highlight the live path; every other
 * branch is history the user can navigate back into.
 */
function pathToLeaf(nodes: PiTreeNode[], leafId: string | null): Set<string> {
	if (!leafId) return new Set();

	const parents = new Map<string, string | null>();
	const walk = (list: PiTreeNode[]): void => {
		for (const node of list) {
			parents.set(node.entry.id, node.entry.parentId);
			walk(node.children);
		}
	};
	walk(nodes);

	const path = new Set<string>();
	let current: string | null | undefined = leafId;
	while (current && !path.has(current)) {
		path.add(current);
		current = parents.get(current) ?? null;
	}
	return path;
}

export function toTree(nodes: PiTreeNode[], leafId: string | null): SessionTreeNode[] {
	const onPath = pathToLeaf(nodes, leafId);

	const convert = (node: PiTreeNode): SessionTreeNode => {
		const { role, preview } = entryPreview(node.entry);
		return {
			id: node.entry.id,
			parentId: node.entry.parentId,
			kind: node.entry.type,
			...(role ? { role } : {}),
			preview,
			...(node.label ? { label: node.label } : {}),
			timestamp: node.entry.timestamp,
			onCurrentPath: onPath.has(node.entry.id),
			children: node.children.map(convert),
		};
	};

	return nodes.map(convert);
}

/** User messages are the only sensible places to restart a conversation from. */
export function forkPoints(entries: SessionEntry[]): { entryId: string; text: string }[] {
	const points: { entryId: string; text: string }[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		points.push({ entryId: entry.id, text: truncate(textOf(entry.message.content)) });
	}
	return points;
}
