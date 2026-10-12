import { isDuplicateProducedMention } from "@olares/lares-core/files/produced-mentions";

function mentionLabels(el) {
  return [el.getAttribute("title") || "", el.textContent || "", el.getAttribute("href") || ""];
}

/** Author `display` on the official card beats the `hidden` attribute. */
function conceal(el, hide) {
  el.hidden = hide;
  if (hide) el.style?.setProperty?.("display", "none", "important");
  else el.style?.removeProperty?.("display");
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
  // Official presented-file cards repeat the same delivery as a filename chip
  // plus a "no desktop" line. Once this tail previews the file, that chip is
  // the duplicate. A row whose cards are all duplicates takes its notice with it.
  const tail = root.closest("[data-turn-tail]") ?? scope;
  for (const card of tail.querySelectorAll("[data-presented-file]")) {
    const button = card.querySelector("button");
    const labels = [
      ...(button ? mentionLabels(button) : []),
      ...[...card.querySelectorAll("span")].map((span) => span.textContent || ""),
    ];
    conceal(card, labels.some((label) => isDuplicateProducedMention(label, paths)));
  }
  for (const row of tail.querySelectorAll("[data-presented-files-row]")) {
    const cards = [...row.querySelectorAll("[data-presented-file]")];
    const box = row.parentElement;
    if (!box || box === tail) continue;
    conceal(box, cards.length > 0 && cards.every((card) => card.hidden));
  }
}
