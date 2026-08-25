import React from "react";
import { Button, IconLoadingOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import { partitionPreviews } from "./preview-groups.js";
import { fetchPreview, rawFileUrl } from "./workspace.js";

const h = React.createElement;
const { useEffect, useMemo, useState } = React;

function basename(path) {
  const parts = String(path).split(/[/\\]/);
  return parts.at(-1) || path;
}

function MediaBody({ item, sessionId }) {
  const common = {
    src: rawFileUrl(sessionId, item.path, item.modifiedAt),
    title: item.path,
  };
  if (item.kind === "image") {
    return h("img", {
      ...common,
      className: "lares-turn-media-image",
      alt: item.name,
      loading: "lazy",
    });
  }
  if (item.kind === "video") {
    return h("video", {
      ...common,
      className: "lares-turn-media-video",
      controls: true,
      playsInline: true,
      preload: "metadata",
    });
  }
  return h("audio", {
    ...common,
    className: "lares-turn-media-audio",
    controls: true,
    preload: "metadata",
  });
}

export function createTurnMedia(t) {
  return function TurnMedia({ matched: paths, openFile, sessionId }) {
    const [previews, setPreviews] = useState(new Map());
    const key = paths.join("\0");

    useEffect(() => {
      let live = true;
      setPreviews(new Map());
      void Promise.all(paths.map(async (path) => {
        try {
          return [path, await fetchPreview(sessionId, path)];
        } catch {
          return [path, null];
        }
      })).then((entries) => {
        if (live) setPreviews(new Map(entries));
      });
      return () => {
        live = false;
      };
    }, [key, sessionId]);

    const { media, files, loading } = useMemo(
      () => partitionPreviews(paths, previews),
      [key, previews],
    );

    return h(
      "section",
      { className: "lares-turn-deliverables", "aria-label": t("produced") },
      loading && h(
        "div",
        { className: "lares-turn-media-loading", role: "status" },
        h(IconLoadingOutline16, { className: "lares-preview-spinner" }),
        h("span", null, t("mediaLoading")),
      ),
      media.length > 0 && h(
        "div",
        { className: "lares-turn-media-list" },
        media.map((item) => h(
          "figure",
          { className: "lares-turn-media", key: item.path },
          h(
            "figcaption",
            { className: "lares-turn-media-caption" },
            h("span", { title: item.path }, item.name),
            h(
              Button,
              {
                variant: "ghost",
                size: "sm",
                onClick: () => openFile(item.path),
              },
              t("openInTab"),
            ),
          ),
          h(MediaBody, { item, sessionId }),
        )),
      ),
      files.length > 0 && h(
        "div",
        { className: "lares-turn-files" },
        h("span", { className: "lares-turn-files-label" }, t("produced")),
        h(
          "div",
          { className: "lares-turn-files-row" },
          files.map((path) => h(
            "button",
            {
              key: path,
              type: "button",
              className: "lares-turn-file",
              title: path,
              onClick: () => openFile(path),
            },
            basename(path),
          )),
        ),
      ),
    );
  };
}
