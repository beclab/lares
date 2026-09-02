const EVENTS = "/api/lares/models/events";

/**
 * Follow Host catalog revision. The first event is the snapshot; later
 * different revisions call onBump. EventSource reconnects on its own.
 *
 * @param {(revision: number) => void} onBump
 * @returns {() => void}
 */
export function watchCatalogRevision(onBump) {
  const source = new EventSource(EVENTS);
  let last = null;
  source.onmessage = (event) => {
    let revision;
    try {
      revision = JSON.parse(event.data).revision;
    } catch {
      return;
    }
    if (!Number.isInteger(revision)) return;
    if (last !== null && revision !== last) onBump(revision);
    last = revision;
  };
  return () => source.close();
}
