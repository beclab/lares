import React from "react";
import { attachModel3dHost } from "../../../shared/client/model3d-host.js";
import { rawFileUrl } from "@olares/lares-core/files/preview-workspace";

const h = React.createElement;
const { useEffect, useRef } = React;

export function Model3dHost({ item, sessionId, compact }) {
  const ref = useRef(null);
  const src = rawFileUrl(sessionId, item.path, item.modifiedAt);

  useEffect(
    () => attachModel3dHost(ref.current, {
      src,
      title: item.path,
      compact,
    }),
    [src, item.path, compact],
  );

  return h("div", {
    ref,
    className: compact ? "lares-turn-media-model3d" : "lares-preview-model3d",
    role: "img",
    "aria-label": item.name,
  });
}
