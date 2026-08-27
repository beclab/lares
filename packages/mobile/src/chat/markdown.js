import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("rel", "noreferrer");
  tokens[idx].attrSet("target", "_blank");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source) {
  return md.render(String(source ?? ""));
}
