// This comparison only protects browser state; the server validates JWTs and permissions.
export function sessionIdentity(token) {
  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const sid = claims.sid || (claims.jti ? `legacy:${claims.jti}` : null);
    if (!claims.sub || !claims.stamp || !sid) return null;
    return JSON.stringify([String(claims.sub), claims.stamp, sid]);
  } catch { return null; }
}
export function sameSession(first, second) {
  if (first === second) return true;
  const identity = sessionIdentity(first);
  return identity !== null && identity === sessionIdentity(second);
}
