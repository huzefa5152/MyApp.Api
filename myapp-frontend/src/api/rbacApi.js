import httpClient from "./httpClient";

// ── Permissions (catalog is read-only from the UI) ───────────────────────
export const getAllPermissions = () => httpClient.get("/permissions");
export const getPermissionTree = () => httpClient.get("/permissions/tree");
export const getMyPermissions = () => httpClient.get("/permissions/me");
// Asked at start-up alongside the sign-in check (utils/bootPrefetch); fails quietly.
export const prefetchMyPermissions = () =>
  httpClient.get("/permissions/me", { _skipAuthRedirect: true });

// ── Roles ────────────────────────────────────────────────────────────────
export const getRoles = () => httpClient.get("/roles");
export const getRole = (id) => httpClient.get(`/roles/${id}`);
export const createRole = (payload) => httpClient.post("/roles", payload);
export const updateRole = (id, payload) => httpClient.put(`/roles/${id}`, payload);
export const deleteRole = (id) => httpClient.delete(`/roles/${id}`);

// ── User ↔ Role assignments ──────────────────────────────────────────────
export const getUserRoles = (userId) => httpClient.get(`/users/${userId}/roles`);
export const assignUserRoles = (userId, roleIds) =>
  httpClient.put(`/users/${userId}/roles`, { roleIds });
