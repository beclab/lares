function candidatePath(element) {
  const title = element.getAttribute("title")?.trim();
  if (!title || title === "." || title.endsWith("/") || title.endsWith("\\")) return null;
  if (/^(?:https?:|mailto:|data:|blob:|javascript:)/i.test(title)) return null;
  return title;
}

export function previewPathFromClick(target) {
  if (!(target instanceof Element)) return null;
  const control = target.closest("button, a");
  if (!control || !control.closest("[data-conversation-scroll]")) return null;

  const producedRow = control.closest("[data-produced-files-row]");
  if (producedRow) return candidatePath(control);

  const path = candidatePath(control);
  if (!path) return null;
  const inlineCode = control.matches("code") || control.querySelector("code") || control.closest("code");
  if (!inlineCode) return null;
  return path;
}

export function installPreviewClicks(ctx, workspace) {
  ctx.effect(() => {
    const onClick = (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const path = previewPathFromClick(event.target);
      if (!path || !workspace.openCurrent(path)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, "lares-file-preview-clicks");
}
