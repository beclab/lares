/** Same row model as dsh-client-ui-tool `toolRowModel` (titles are design literals). */

const VARIANT_TITLES = {
  search: "Search",
  read: "Read",
  bash: "Bash",
  write: "Write",
  edit: "Edit",
  code: "Code",
  others: "Tool call",
};

const TOOL_VARIANTS = {
  bash: "bash",
  pwsh: "bash",
  read: "read",
  web_fetch: "read",
  web_search: "search",
  grep: "search",
  glob: "search",
  write: "write",
  edit: "edit",
  run_code: "code",
  cordis_package_inspect: "read",
  cordis_runtime_inspect: "read",
  cordis_run: "others",
  cordis_stop: "others",
  cordis_undefine: "others",
};

const TOOL_TITLES = {
  cordis_package_inspect: "Inspect",
  cordis_runtime_inspect: "Inspect",
  cordis_run: "Run Cordis Plugin",
  cordis_stop: "Stop Cordis Plugin",
  cordis_undefine: "Remove Cordis Plugin",
  pwsh: "Pwsh",
};

const SUMMARY_KEYS = {
  bash: ["description", "command"],
  read: ["path", "file_path", "url"],
  search: ["query", "pattern", "url"],
  write: ["path", "file_path"],
  edit: ["path", "file_path"],
  code: ["description"],
  others: [],
};

function firstLine(text) {
  const newline = String(text ?? "").indexOf("\n");
  return newline === -1 ? String(text ?? "") : String(text).slice(0, newline);
}

function parseArgs(argsRaw) {
  try {
    return JSON.parse(argsRaw);
  } catch {
    return undefined;
  }
}

function pickString(args, keys) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value !== "") return value;
  }
}

function deriveSummary(variant, argsRaw) {
  const parsed = parseArgs(argsRaw);
  if (typeof parsed !== "object" || parsed === null) return firstLine(argsRaw);
  if (variant === "search" && Array.isArray(parsed.queries)) {
    const queries = parsed.queries.filter((query) => typeof query === "string" && query !== "");
    if (queries.length > 0) return queries.map(firstLine).join(", ");
  }
  const picked = pickString(parsed, SUMMARY_KEYS[variant]);
  if (picked !== undefined) return firstLine(picked);
  for (const value of Object.values(parsed)) {
    if (typeof value === "string" && value !== "") return firstLine(value);
  }
  return firstLine(argsRaw);
}

function deriveBody(variant, argsRaw) {
  if (!argsRaw) return "";
  const parsed = parseArgs(argsRaw);
  if (parsed === undefined) return argsRaw;
  if (variant === "code" && parsed && typeof parsed === "object" && typeof parsed.code === "string") {
    return parsed.code;
  }
  return JSON.stringify(parsed, null, 2);
}

export function classifyTool(toolName) {
  return TOOL_VARIANTS[toolName] ?? "others";
}

const VARIANT_ICONS = {
  search: "search",
  read: "browse",
  bash: "api",
  write: "edit",
  edit: "edit",
  code: "code",
  others: "sparkle",
};

export function toolVariantIcon(variant) {
  return VARIANT_ICONS[variant] ?? "sparkle";
}

export function toolRowModel(toolName, argsRaw = "") {
  const name = String(toolName || "");
  const variant = classifyTool(name);
  const base = argsRaw === "" ? "" : deriveSummary(variant, argsRaw);
  const toolTitle = TOOL_TITLES[name];
  const summary = variant === "others" && name && toolTitle === undefined && base
    ? `${name} · ${base}`
    : base;
  return {
    variant,
    title: toolTitle ?? VARIANT_TITLES[variant],
    summary,
    body: deriveBody(variant, argsRaw),
  };
}
