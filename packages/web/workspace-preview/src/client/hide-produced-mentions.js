import { isDuplicateProducedMention } from "@olares/lares-core/files/produced-mentions";

function mentionLabels(el) {
  return [el.getAttribute("title") || "", el.textContent || "", el.getAttribute("href") || ""];
}

/**
 * Hide the in-message path chip/link that dsh paints from a trailing
 * `outputs/…` mention once the turn-tail already previews that file.
 */
export function hideDuplicateProducedMentions(root, paths) {
  if (!root || !Array.isArray(paths) || paths.length === 0) return;
  const scope = root.closest("[data-conversation-scroll], [data-turn]") ?? root.parentElement;
  if (!scope) return;
  for (const el of scope.querySelectorAll("button, a, [role='button'], code")) {
    if (el.closest(".lares-turn-deliverables, [data-file-preview-overlay], .lares-preview-header")) {
      continue;
    }
    if (!mentionLabels(el).some((label) => isDuplicateProducedMention(label, paths))) continue;
    const parent = el.parentElement;
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    if (
      parent
      && parent !== scope
      && !parent.closest(".lares-turn-deliverables")
      && mentionLabels(parent).some((label) => isDuplicateProducedMention(label, paths))
      && mentionLabels(parent).every((label) => !label.trim() || isDuplicateProducedMention(label, paths))
    ) {
      parent.hidden = true;
    }
  }
}
