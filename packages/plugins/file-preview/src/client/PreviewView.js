import React from "react";
import { Button, IconLoadingOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import { errorMessage } from "./locale.js";
import { rawFileUrl } from "./workspace.js";

const h = React.createElement;
const { useSyncExternalStore } = React;

function PreviewBody({ data, sessionId, t }) {
  if (data.kind === "image") {
    return h(
      "div",
      { className: "lares-preview-media" },
      h("img", {
        className: "lares-preview-image",
        src: rawFileUrl(sessionId, data.path),
        alt: data.name,
      }),
    );
  }
  if (data.kind === "video") {
    return h(
      "div",
      { className: "lares-preview-media" },
      h("video", {
        className: "lares-preview-video",
        src: rawFileUrl(sessionId, data.path),
        controls: true,
        playsInline: true,
      }),
    );
  }
  if (data.kind === "audio") {
    return h(
      "div",
      { className: "lares-preview-audio-wrap" },
      h("div", { className: "lares-preview-audio-name" }, data.name),
      h("audio", {
        className: "lares-preview-audio",
        src: rawFileUrl(sessionId, data.path),
        controls: true,
      }),
    );
  }
  if (data.kind === "pdf") {
    return h("iframe", {
      className: "lares-preview-pdf",
      src: rawFileUrl(sessionId, data.path),
      title: data.name,
    });
  }
  if (data.kind === "text" || data.kind === "markdown") {
    return h(
      React.Fragment,
      null,
      data.truncated && h("div", { className: "lares-preview-banner" }, t("truncated")),
      h("pre", { className: `lares-preview-text is-${data.kind}` }, data.text ?? ""),
    );
  }
  return h(
    "div",
    { className: "lares-preview-empty" },
    h("strong", null, t("unsupportedTitle")),
    h("span", null, t("unsupported")),
  );
}

export function createPreviewView(workspace, t) {
  return function FilePreviewView({ sessionId }) {
    const snapshot = useSyncExternalStore(
      (listener) => workspace.subscribe(sessionId, listener),
      () => workspace.getSnapshot(sessionId),
    );
    const path = snapshot.activePath;
    const content = snapshot.content;

    if (!path) {
      return h("div", { className: "lares-preview-empty" }, t("empty"));
    }
    return h(
      "section",
      { className: "lares-preview-view", "aria-label": t("preview") },
      h("div", { className: "lares-preview-path", title: path }, path),
      h(
        "div",
        { className: "lares-preview-content" },
        (content.status === "idle" || content.status === "loading") && h(
          "div",
          { className: "lares-preview-empty" },
          h(IconLoadingOutline16, { className: "lares-preview-spinner" }),
          h("span", null, t("loading")),
        ),
        content.status === "error" && h(
          "div",
          { className: "lares-preview-empty" },
          h("strong", null, t("failed")),
          h("span", null, errorMessage(t, content.message)),
          h(
            Button,
            {
              variant: "outline",
              size: "sm",
              onClick: () => workspace.retry(sessionId, path),
            },
            t("retry"),
          ),
        ),
        content.status === "ready" && h(PreviewBody, { data: content.data, sessionId, t }),
      ),
    );
  };
}
