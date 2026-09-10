import assert from "node:assert/strict";
import test from "node:test";
import {
  createDraftImageEntry,
  draftHasSendableContent,
  draftImagesSendable,
  draftImagesUploading,
} from "@olares/lares-core/files/draft-images";

test("draft image helpers track upload readiness for send", () => {
  const uploading = [{ status: "uploading", previewUrl: "blob:x" }];
  const ready = [{ status: "ready", previewUrl: "https://host/a.png" }];
  assert.equal(draftImagesUploading(uploading), true);
  assert.equal(draftImagesUploading(ready), false);
  assert.equal(draftImagesSendable(uploading), false);
  assert.equal(draftImagesSendable(ready), true);
  assert.equal(draftHasSendableContent("", uploading), false);
  assert.equal(draftHasSendableContent("", ready), true);
  assert.equal(draftHasSendableContent("hi", uploading), true);
});

test("createDraftImageEntry starts in uploading state with a blob preview", () => {
  const file = new File(["x"], "a.png", { type: "image/png" });
  const row = createDraftImageEntry(file);
  assert.equal(row.status, "uploading");
  assert.equal(row.file, file);
  assert.match(row.previewUrl, /^blob:/);
  assert.equal(row.path, "");
});
