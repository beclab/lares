import { activeReferenceToken, insertReference } from "@olares/lares-core/larepass/references";

export const REFERENCE_DEBOUNCE_MS = 100;

export function referenceRows(references, t) {
  let previous = "";
  return (references ?? []).map((row) => {
    const group = row.kind === "session" ? "sessions" : "files";
    const section = group === previous ? "" : t(`references.section.${group}`);
    previous = group;
    return { ...row, section, name: `${t(`references.${row.kind}`)} · ${row.label}` };
  });
}

export function visibleCommands(commands, draft, commandTyped) {
  const rows = commands ?? [];
  if (!commandTyped) return rows;
  const needle = String(draft).match(/^\/([^\s]*)$/)?.[1]?.toLowerCase() ?? "";
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

export function isCommandLine(draft) {
  return /^\/[^\s]*$/.test(String(draft ?? ""));
}

export function activeReference(draft, caret) {
  return activeReferenceToken(draft, caret);
}

export function applyReference(draft, token, row) {
  return insertReference(draft, token, row);
}
