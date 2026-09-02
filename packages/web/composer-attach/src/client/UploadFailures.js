import React from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { messageFor, useT } from "./locale.js";

const h = React.createElement;
const { useMemo, useSyncExternalStore } = React;

/**
 * Only failures take a row of their own: an upload in flight is already told by
 * the attach button's spinner and the composer's own block placeholder.
 */
export function createUploadFailures(intake, commitFor) {
  return function UploadFailures(props) {
    const t = useT();
    const sessionId = props.sessionId ?? props.session?.sessionId;
    const state = useSyncExternalStore(
      (listener) => intake.subscribe(sessionId, listener),
      () => intake.getSnapshot(sessionId),
    );
    const commit = useMemo(() => commitFor(sessionId), [sessionId]);

    if (state.failures.length === 0) return null;
    return h(
      "div",
      { className: "lares-upload-failures", role: "alert" },
      state.failures.map((failure) =>
        h(
          "div",
          { key: failure.id, className: "lares-upload-status is-error" },
          h(
            "span",
            { className: "lares-upload-status-text" },
            t("upload.failed", { name: failure.name, reason: messageFor(t, failure.code) }),
          ),
          h(
            Button,
            {
              variant: "ghost",
              size: "sm",
              onClick: () => void intake.retry(sessionId, failure.id, commit),
            },
            t("upload.retry"),
          ),
          h(
            Button,
            {
              variant: "ghost",
              size: "sm",
              onClick: () => intake.dismiss(sessionId, failure.id),
            },
            t("upload.dismiss"),
          ),
        ),
      ),
    );
  };
}
