/** Physical audio is shared; a new page must not silently evict its owner. */
export function createDeviceLease({ now = Date.now, ttlMs = 30_000 } = {}) {
  let lease = null;
  const busy = () => Object.assign(new Error("voice_device_busy"), { code: "voice_device_busy", status: 409 });
  return {
    acquire(owner) {
      if (lease && lease.owner !== owner && lease.until > now()) throw busy();
      lease = { owner, until: now() + ttlMs };
    },
    touch(owner) {
      if (lease?.owner === owner) lease.until = now() + ttlMs;
    },
    release(owner) { if (lease?.owner === owner) lease = null; },
    owns: (owner) => lease?.owner === owner && lease.until > now(),
  };
}
