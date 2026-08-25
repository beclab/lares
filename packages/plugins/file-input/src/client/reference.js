/**
 * An uploaded file enters the composer as a dsh reference occurrence rather
 * than literal `@path` text: the occurrence owns its whole range, so the
 * mention deletes in one keystroke and renders as a chip. `reference` is the
 * official `@file` source, whose codec serializes the ref back to the model
 * verbatim and whose clipboard projection is what draft persistence stores.
 */
const REFERENCE_SOURCE = "reference";

function mentionOf(path) {
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
