/**
 * The host's slash commands, for a composer that offers them instead of making
 * people remember the names.
 *
 * dsh keeps its command registry behind a Typert remote, which this client's
 * plain `POST /api/<method>` transport cannot reach, so the Lares Host exposes
 * the registry over `/api/lares/commands` instead. Running one stays ordinary:
 * a prompt whose single text block starts with `/` is dispatched by the host to
 * the registry and never reaches the model.
 */

export const COMMANDS_PATH = "/api/lares/commands";

export function commandsUrl(sessionId) {
  return sessionId ? `${COMMANDS_PATH}?sessionId=${encodeURIComponent(sessionId)}` : COMMANDS_PATH;
}

/**
 * @param {unknown} body - the endpoint's payload.
 * @returns {Array<{ name: string, description: string, hint: string }>}
 */
export function normalizeCommands(body) {
  const rows = Array.isArray(body?.commands) ? body.commands : [];
  return rows
    .filter((row) => typeof row?.name === "string" && row.name.trim())
    .map((row) => ({
      name: row.name.trim(),
      description: String(row.description || ""),
      hint: String(row.input?.hint ?? row.hint ?? ""),
    }));
}

/** A command that takes input is handed over with the cursor past the space. */
export function commandLine(command) {
  return command?.hint ? `/${command.name} ` : `/${command?.name ?? ""}`;
}

/**
 * Put a chosen command on the composer. The host reads a command only as the
 * whole message, so the line replaces any command already typed there while
 * keeping the words after it — picking `goal` over `plan` keeps the input the
 * person had already written for it.
 */
export function applyCommand(draft, command) {
  const line = commandLine(command);
  const rest = String(draft ?? "").replace(/^\s*\/\S*\s*/, "").trimStart();
  if (!rest) return line;
  return line.endsWith(" ") ? `${line}${rest}` : `${line} ${rest}`;
}
