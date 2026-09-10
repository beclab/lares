export function createDraftImageEntry(file) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    file,
    previewUrl: URL.createObjectURL(file),
    status: "uploading",
    path: "",
  };
}

export function draftImageStatus(row) {
  return row?.status ?? "ready";
}

export function draftImagesUploading(images) {
  return (images ?? []).some((row) => draftImageStatus(row) === "uploading");
}

export function draftImagesSendable(images) {
  return (images ?? []).some((row) => draftImageStatus(row) === "ready");
}

export function draftHasSendableContent(draft, images) {
  return Boolean(String(draft ?? "").trim()) || draftImagesSendable(images);
}
