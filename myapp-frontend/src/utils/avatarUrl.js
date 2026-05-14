// Build a cache-busted avatar URL. The server reuses the same filename
// (user-{id}.{ext}) on every upload, so without a version query string
// the browser would keep serving the cached image after a change.
//
// `version` comes from AuthContext.avatarVersion — it bumps on every
// refreshUser() / login, which covers every code path that mutates the
// avatar (upload, remove, log-back-in).
export function getAvatarUrl(user, version) {
  if (!user?.avatarPath) return null;
  const sep = user.avatarPath.includes("?") ? "&" : "?";
  return `${user.avatarPath}${sep}v=${version || 1}`;
}
