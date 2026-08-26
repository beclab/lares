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
