import type { AgentCommand, AgentCommandType, ImageAttachment } from "@lares/shared";

const KNOWN_TYPES = new Set<AgentCommandType>([
	"ensure_session",
	"prompt",
	"steer",
	"follow_up",
	"abort",
	"abort_bash",
	"abort_compaction",
	"get_state",
	"set_model",
	"set_thinking_level",
	"set_tools",
	"get_tools",
	"get_session_stats",
	"get_last_assistant_text",
	"set_session_name",
	"set_auto_compaction",
	"set_auto_retry",
	"clear_queue",
	"compact",
	"navigate_tree",
	"bash",
	"reload",
]);

export class CommandParseError extends Error {}

function requireString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new CommandParseError(`Command field "${key}" must be a non-empty string`);
	}
	return value;
}

function optionalImages(record: Record<string, unknown>): ImageAttachment[] | undefined {
	const value = record.images;
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new CommandParseError('Command field "images" must be an array');
	return value.map((entry) => {
		if (typeof entry !== "object" || entry === null) throw new CommandParseError("Each image must be an object");
		const image = entry as Record<string, unknown>;
		return {
			type: "image" as const,
			data: requireString(image, "data"),
			mimeType: requireString(image, "mimeType"),
		};
	});
}

/**
 * Validate the discriminant and the fields that would otherwise fail deep
 * inside pi with an unhelpful message. Everything else is passed through.
 */
export function parseCommand(input: unknown): AgentCommand {
	if (typeof input !== "object" || input === null) {
		throw new CommandParseError("Command must be an object");
	}
	const record = input as Record<string, unknown>;
	const type = record.type;
	if (typeof type !== "string" || !KNOWN_TYPES.has(type as AgentCommandType)) {
		throw new CommandParseError(`Unknown command type ${JSON.stringify(type)}`);
	}

	switch (type) {
		case "prompt":
		case "steer":
		case "follow_up":
			return { type, message: requireString(record, "message"), images: optionalImages(record) } as AgentCommand;
		case "set_model":
			return { type, provider: requireString(record, "provider"), modelId: requireString(record, "modelId") };
		case "set_thinking_level":
			return { type, level: requireString(record, "level") };
		case "set_session_name":
			return { type, name: requireString(record, "name") };
		case "set_tools": {
			const names = record.toolNames;
			if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
				throw new CommandParseError('Command field "toolNames" must be an array of strings');
			}
			return { type, toolNames: names as string[] };
		}
		case "navigate_tree":
			return { type, targetId: requireString(record, "targetId") };
		case "bash":
			return {
				type,
				command: requireString(record, "command"),
				excludeFromContext: record.excludeFromContext === true,
			};
		case "compact":
			return {
				type,
				...(typeof record.customInstructions === "string" ? { customInstructions: record.customInstructions } : {}),
			};
		case "set_auto_compaction":
		case "set_auto_retry":
			return { type, enabled: record.enabled === true };
		default:
			return { type } as AgentCommand;
	}
}
