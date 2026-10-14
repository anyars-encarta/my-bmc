import type { components, paths } from "./api.generated";

export type ApiPagination = components["schemas"]["Pagination"];
export type ApiProblem = components["schemas"]["ProblemError"];

export type MeResponse = paths["/me"]["get"]["responses"][200]["content"]["application/json"]["data"];

export type MePayload = Omit<components["schemas"]["MePayload"], "unitScopes"> & {
  unitScopes: MeResponse["unitScopes"];
};

export type UserListItem = components["schemas"]["UserListResponseEnvelope"]["data"][number];
