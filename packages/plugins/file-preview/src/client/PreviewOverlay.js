import React from "react";
import { createPortal } from "react-dom";

const h = React.createElement;
const { useEffect, useState, useSyncExternalStore } = React;

export function createPreviewOverlay(workspace, PreviewView) {
  return function FilePreviewOverlay({ sessionId }) {
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
        {
          className: "lares-preview-overlay",
          "data-file-preview-overlay": "",
          // dsh contract: a view owning the scrollport pins the composer seat
          // and clips the chat flow, so this surface is the only scroller.
          "data-conversation-composer-overlay": "",
        },
        h(PreviewView, { sessionId }),
      ),
      target,
    );
  };
}
