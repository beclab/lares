export { FileIntake, documentPasteFiles, partitionDocumentsBySize, splitComposerFiles } from "@lares/core/files/intake";

export function claimComposerBlock(registry, sessionId, reason) {
  const store = registry.storeFor(sessionId);
  if (store.getSnapshot() !== undefined) return () => {};
  const block = { reason };
  registry.set(sessionId, block);
  return () => {
    if (store.getSnapshot() === block) registry.set(sessionId, undefined);
  };
}
