export const REFERENCES_PATH = "/api/lares/references";

export function referencesUrl(sessionId, query = "") {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  if (query) params.set("query", query);
  const suffix = params.toString();
  return suffix ? `${REFERENCES_PATH}?${suffix}` : REFERENCES_PATH;
}

export function activeReferenceToken(draft, caret = String(draft ?? "").length) {
  const text = String(draft ?? "");
  const end = Math.max(0, Math.min(Number(caret) || 0, text.length));
  const prefix = text.slice(0, end);
  const match = prefix.match(/(?:^|\s)(@(?:"[^"]*|[^\s]*))$/u);
  if (!match) return null;
  const token = match[1];
  const start = end - token.length;
  if (token.startsWith('@"')) {
    const query = token.slice(2);
    if (query.includes('"')) return null;
    return { start, end, query, quoted: true };
  }
  const query = token.slice(1);
  if (/\s/.test(query)) return null;
  return { start, end, query, quoted: false };
}

export function formatFileMention(candidate, preserveQuote = false) {
  if (!candidate || typeof candidate.path !== "string") return null;
  const directory = candidate.kind === "directory";
  const path = directory ? `${candidate.path.replace(/\/$/, "")}/` : candidate.path;
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return null;
  if (!(preserveQuote || /\s/u.test(path))) return `@${path}`;
  return directory ? `@"${path}` : `@"${path}"`;
}

export function normalizeReferenceCandidates(body, preserveQuote = false) {
  const files = (Array.isArray(body?.files) ? body.files : []).flatMap((candidate) => {
    const mention = formatFileMention(candidate, preserveQuote);
    if (!mention) return [];
    const directory = candidate.kind === "directory";
    const label = candidate.path.slice(candidate.path.lastIndexOf("/") + 1) || candidate.path;
    return [{
      id: `file:${candidate.path}:${directory ? "d" : "f"}`,
      kind: directory ? "directory" : "file",
      label: `${label}${directory ? "/" : ""}`,
      description: candidate.path,
      mention,
      continuation: directory,
    }];
  });
  const sessions = (Array.isArray(body?.sessions) ? body.sessions : []).flatMap((candidate) => {
    if (typeof candidate?.mention !== "string" || !candidate.mention) return [];
    return [{
      id: `session:${candidate.sessionId || candidate.mention}`,
      kind: "session",
      label: candidate.label || candidate.sessionId || candidate.mention,
      description: candidate.cwd || candidate.sessionId || "",
      mention: candidate.mention,
      continuation: false,
    }];
  });
  return [...files, ...sessions];
}

function base64Url(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function sessionReferenceCandidates(sessions, currentSessionId, query = "") {
  const needle = String(query).toLocaleLowerCase();
  return (Array.isArray(sessions) ? sessions : []).flatMap((session) => {
    if (!session?.sessionId || session.sessionId === currentSessionId) return [];
    const label = String(session.title || session.sessionId);
    const haystack = `${label}\n${session.sessionId}\n${session.cwd || ""}`.toLocaleLowerCase();
    if (needle && !haystack.includes(needle)) return [];
    const escaped = label.replace(/[\\\]]/gu, (match) => `\\${match}`);
    return [{
      id: `session:${session.sessionId}`,
      kind: "session",
      label,
      description: session.cwd || session.sessionId,
      mention: `@[${escaped}](dsh-session:${base64Url(session.sessionId)})`,
      continuation: false,
    }];
  });
}

export function insertReference(draft, token, candidate) {
  const text = String(draft ?? "");
  const suffix = candidate.continuation || /\s/.test(text[token.end] ?? "") ? "" : " ";
  const next = `${text.slice(0, token.start)}${candidate.mention}${suffix}${text.slice(token.end)}`;
  return {
    draft: next,
    caret: token.start + candidate.mention.length + suffix.length,
  };
}
