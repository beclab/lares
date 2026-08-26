import { uploadReference } from "@lares/core/files/mention";

export { uploadReference } from "@lares/core/files/mention";

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
