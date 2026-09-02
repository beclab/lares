import React from "react";

const h = React.createElement;
const { useEffect, useSyncExternalStore } = React;

function FileGlyph() {
  return h(
    "svg",
    { viewBox: "0 0 16 16", "aria-hidden": "true" },
    h("path", { d: "M4 1.75h5l3 3V14.25H4zM9 1.75v3h3" }),
  );
}

function CloseGlyph() {
  return h(
    "svg",
    { viewBox: "0 0 16 16", "aria-hidden": "true" },
    h("path", { d: "m4.5 4.5 7 7m0-7-7 7" }),
  );
}

export function createHeaderTabs(workspace, t) {
  return function FilePreviewTabs({ sessionId }) {
    const snapshot = useSyncExternalStore(
      (listener) => workspace.subscribe(sessionId, listener),
      () => workspace.getSnapshot(sessionId),
    );

    useEffect(() => workspace.bindCurrent(sessionId), [sessionId]);

    if (snapshot.tabs.length === 0) return null;
    return h(
      "div",
      { className: "lares-preview-tabs", role: "tablist", "aria-label": t("tabs") },
      h(
        "button",
        {
          type: "button",
          role: "tab",
          className: `lares-preview-chat-tab${snapshot.mode === "chat" ? " is-active" : ""}`,
          "aria-selected": snapshot.mode === "chat",
          onClick: () => workspace.showChat(sessionId),
        },
        t("chat"),
      ),
      h("span", { className: "lares-preview-tabs-divider", "aria-hidden": "true" }),
      h(
        "div",
        { className: "lares-preview-file-tabs" },
        snapshot.tabs.map((tab) => {
          const active = snapshot.mode === "preview" && snapshot.activePath === tab.path;
          return h(
            "div",
            {
              key: tab.path,
              className: `lares-preview-file-tab${active ? " is-active" : ""}`,
              role: "tab",
              "aria-selected": active,
            },
            h(
              "button",
              {
                type: "button",
                className: "lares-preview-file-tab-label",
                title: tab.path,
                onClick: () => workspace.activate(sessionId, tab.path),
              },
              h(FileGlyph),
              h("span", null, tab.name),
            ),
            h(
              "button",
              {
                type: "button",
                className: "lares-preview-file-tab-close",
                "aria-label": t("close", { name: tab.name }),
                title: t("close", { name: tab.name }),
                onClick: (event) => {
                  event.stopPropagation();
                  workspace.close(sessionId, tab.path);
                },
              },
              h(CloseGlyph),
            ),
          );
        }),
      ),
      h(
        "span",
        { className: "lares-preview-evicted", "aria-live": "polite" },
        snapshot.evictedName ? t("evicted", { name: snapshot.evictedName }) : "",
      ),
    );
  };
}
