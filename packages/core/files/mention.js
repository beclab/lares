const REFERENCE_SOURCE = "reference";

export function mentionOf(path) {
  return /[\s"]/u.test(path) ? `@"${path}"` : `@${path}`;
}

export function uploadReference(path) {
  const ref = mentionOf(path);
  return {
    source: REFERENCE_SOURCE,
    ref,
    label: path.slice(path.lastIndexOf("/") + 1),
    appearance: "file",
    clipboardText: ref,
  };
}

/**
 * Append one reference per uploaded path at the end of the draft.
 * @returns the paths the input machine refused, in order.
 */
export function insertUploadReferences(input, paths) {
  const refused = [];
  for (const path of paths) {
    const current = input.state.getSnapshot();
    if (current.draft !== "" && !/\s$/u.test(current.draft)) input.setDraft(`${current.draft} `);
    const state = input.state.getSnapshot();
    const at = state.draft.length;
    const applied = input.insertReference(uploadReference(path), {
      start: at,
      end: at,
      draftRev: state.draftRev,
    });
    if (!applied) refused.push(path);
  }
  return refused;
}

export function commitUploadPaths(input, paths, notifyUnlinked) {
  if (!input) return;
  for (const path of insertUploadReferences(input, paths)) {
    notifyUnlinked(path);
  }
}

export function createUploadCommit({ scopeSession, inputFor, unlinkedMessage }) {
  return (sessionId) => (paths) => {
    const sessionCtx = scopeSession(sessionId);
    if (sessionCtx === undefined) return;
    const input = inputFor(sessionCtx);
    commitUploadPaths(input, paths, (path) => input.notify("error", unlinkedMessage(path)));
  };
}
