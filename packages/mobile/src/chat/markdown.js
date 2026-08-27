function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noreferrer" target="_blank">$1</a>');
}

export function renderMarkdown(source) {
  const fences = [];
  const text = String(source ?? "").replace(/```[\t ]*[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_, code) => {
    const token = `\u0000F${fences.length}\u0000`;
    fences.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\n${token}\n`;
  });
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      const fence = /^\u0000F(\d+)\u0000$/.exec(trimmed);
      if (fence) return fences[Number(fence[1])];
      const lines = trimmed.split("\n");
      if (lines.every((line) => /^[-*] /.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`;
      }
      const heading = /^(#{1,3}) (.*)$/.exec(lines[0]);
      if (heading) {
        const level = heading[1].length;
        const rest = lines.slice(1).map((line) => inline(line)).join("<br>");
        return `<h${level}>${inline(heading[2])}</h${level}>${rest}`;
      }
      return `<p>${lines.map((line) => inline(line)).join("<br>")}</p>`;
    })
    .join("");
}
