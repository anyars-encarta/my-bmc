/* eslint-disable */
// Generated from backend/openapi/openapi.json via `npm run types:emit`.

export type ApiPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

export type ApiProblem = {
  type: string;
  title: string;
  status: number;
  error: string;
  message: string;
  code?: string;
  requestId: string;
  details?: unknown;
};

export type MePayload = {
  user: {
    id: string;
    name: string;
    email: string;
    status: string;
  };
  roles: string[];
  unitScopes: Array<Record<string, unknown>>;
  permissions: string[];
};

export type UserListItem = {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: string[];
  permissions: string[];
};
