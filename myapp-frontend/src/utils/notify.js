// Simple pub/sub for bridging httpClient (non-React) to React notification UI
let listener = null;

export function onNotify(callback) {
  listener = callback;
  return () => { listener = null; };
}

export function notify(message, severity = "error") {
  if (listener) listener({ message, severity });
}
