// Shares only pending reads. Settled results are never cached.
export function createInFlightRead(load, scope) {
  const pending = new Map();
  function read(...args) {
    const key = JSON.stringify([scope(), args]);
    if (pending.has(key)) return pending.get(key);
    const clear = () => {
      if (pending.get(key) === request) pending.delete(key);
    };
    const request = load(...args).then(
      (value) => { clear(); return value; },
      (error) => { clear(); throw error; },
    );
    pending.set(key, request);
    return request;
  }
  read.clear = () => pending.clear();
  return read;
}
