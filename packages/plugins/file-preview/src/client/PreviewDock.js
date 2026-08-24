import React from "react";
import { createPortal } from "react-dom";

const h = React.createElement;
const { useEffect, useState, useSyncExternalStore } = React;

export function createPreviewDock(workspace, PreviewView) {
  return function FilePreviewDock({ sessionId }) {
    const [target, setTarget] = useState(null);
    const snapshot = useSyncExternalStore(
      (listener) => workspace.subscribe(sessionId, listener),
      () => workspace.getSnapshot(sessionId),
    );

    useEffect(() => {
      setTarget(document.querySelector("[data-conversation-scroll]"));
    }, []);

    if (!target || snapshot.mode !== "preview" || !snapshot.activePath) return null;
    return createPortal(
      h(
        "div",
        { className: "lares-preview-overlay", "data-file-preview-overlay": "" },
        h(PreviewView, { sessionId }),
      ),
      target,
    );
  };
}
