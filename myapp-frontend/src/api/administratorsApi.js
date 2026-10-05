import httpClient from "./httpClient";

// Seed-admin console: the management tree (top-level Administrators with
// their users, companies and tenant-access grants). Read-only — writes go
// through usersApi / rbacApi / userCompaniesApi so there is one write path.
export const getAdministratorTree = () => httpClient.get("/administrators");
