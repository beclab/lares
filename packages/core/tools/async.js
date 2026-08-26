export function createInFlightCoalescer() {
  let current = null;
  return (start) => {
    if (current) return current;
    const shared = Promise.resolve().then(start).finally(() => {
      if (current === shared) current = null;
    });
    current = shared;
    return shared;
  };
}

/** Last successful payload survives remounts; Refresh / save pass `{ force: true }`. */
export function createSnapshotStore() {
  let value = null;
  const coalesce = createInFlightCoalescer();
  return {
    peek() {
      return value;
    },
    remember(next) {
      value = next;
      return next;
    },
    load(start, options = {}) {
      if (!options.force && value !== null) return Promise.resolve(value);
      return coalesce(async () => {
        const next = await start();
        value = next;
        return next;
      });
    },
  };
}
