import { preflightDownload } from "@lares/core/files/disposition";

export { filenameFromDisposition } from "@lares/core/files/disposition";

const FRAME_NAME = "lares-file-preview-download";

function saveThroughFrame(url) {
  let frame = document.querySelector(`iframe[name="${FRAME_NAME}"]`);
  if (frame === null) {
    frame = document.createElement("iframe");
    frame.name = FRAME_NAME;
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-downloads");
    document.body.append(frame);
  }
  frame.src = url;
}

/**
 * HEAD keeps failures observable without buffering the file. The GET then runs
 * in an invisible frame: attachment responses stream to disk, while a deletion
 * racing the preflight can only replace that frame, never the conversation.
 */
export async function downloadCurrentFile(url, { fetchFn = fetch, save = saveThroughFrame } = {}) {
  const name = await preflightDownload(url, fetchFn);
  save(url, name);
}
