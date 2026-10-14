import type {
  BaseRecord,
  CreateParams,
  CrudFilters,
  CrudSorting,
  CustomParams,
  DataProvider,
  DeleteOneParams,
  GetListParams,
  GetManyParams,
  GetOneParams,
  HttpError,
  UpdateParams,
} from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "./me";

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
  message?: string;
  code?: string;
  details?: unknown;
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    hasMore?: boolean;
  };
};

type ResourceConfig = {
  api: "legacy" | "v1";
  path: string;
  singleton?: boolean;
};

const ERROR_CODE_MESSAGES: Record<string, string> = {
  LIST_FIELD_UNKNOWN: "This view requested an unsupported list field.",
  BREAK_GLASS_REQUIRED: "Restricted record access needs break-glass approval.",
  CONSENT_REQUIRED: "Required consent is missing.",
  CONCURRENT_MODIFICATION: "This record changed. Refresh and try again.",
};

const RESOURCE_CONFIG: Record<string, ResourceConfig> = {
  users: { api: "v1", path: "users" },
  staff: { api: "v1", path: "staff" },
  setup: { api: "v1", path: "facility", singleton: true },
  "org-units": { api: "v1", path: "org-units" },
  payments: { api: "legacy", path: "payments" },
  categories: { api: "legacy", path: "categories" },
  approval_queue: { api: "legacy", path: "payments" },
  disbursements: { api: "legacy", path: "payments" },
};

const baseUrl = BACKEND_BASE_URL.replace(/\/+$/, "");

const getConfig = (resource: string): ResourceConfig =>
  RESOURCE_CONFIG[resource] ?? { api: "legacy", path: resource };

const buildResourceUrl = (resource: string, id?: string | number) => {
  const config = getConfig(resource);
  const base = config.api === "v1" ? `${baseUrl}/v1` : baseUrl;
  const entityPath = config.path.replace(/^\/+/, "");
  const finalId = id ?? (config.singleton ? "" : undefined);
  return `${base}/${entityPath}${finalId !== undefined && finalId !== "" ? `/${finalId}` : ""}`;
};

const unwrapData = <T>(payload: ApiEnvelope<T> | T): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data as T;
  }
  return payload as T;
};

const toError = (response: Response, payload: unknown) => {
  const envelope =
    payload && typeof payload === "object" ? (payload as ApiEnvelope<unknown>) : undefined;
  const mappedByCode =
    envelope?.code && ERROR_CODE_MESSAGES[envelope.code]
      ? ERROR_CODE_MESSAGES[envelope.code]
      : null;
  const rawMessage =
    mappedByCode ??
    envelope?.message ??
    envelope?.error ??
    response.statusText ??
    "Request failed";

  const error = new Error(rawMessage) as unknown as HttpError;
  error.statusCode = response.status;
  error.message = rawMessage;
  error.errors = envelope?.details as HttpError["errors"];

  return error;
};

const requestJson = async <T>(input: string, init?: RequestInit) => {
  const response = await fetch(input, {
    credentials: "include",
    headers: createAuthHeaders(init?.headers),
    ...init,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const payload = text
    ? contentType.includes("application/json")
      ? (JSON.parse(text) as T)
      : ({ message: text } as unknown as T)
    : ({} as T);

  if (!response.ok) {
    throw toError(response, payload);
  }

  return { payload, response };
};

const buildListParams = (
  pagination?: GetListParams["pagination"],
  filters?: CrudFilters,
  sorters?: CrudSorting,
) => {
  const params = new URLSearchParams();
  params.set("page", String(pagination?.currentPage ?? 1));
  params.set("limit", String(pagination?.pageSize ?? 10));

  if (sorters?.length) {
    const sort = sorters
      .map((entry) => `${entry.order === "desc" ? "-" : ""}${entry.field}`)
      .join(",");
    params.set("sort", sort);
  }

  filters?.forEach((filter) => {
    if (!("field" in filter)) return;

    const value = filter.value;
    if (value === undefined || value === null || value === "") return;

    if (filter.field === "search" && filter.operator === "contains") {
      params.set("q", String(value));
      return;
    }

    if (filter.operator === "eq") {
      params.set(filter.field, String(value));
      return;
    }

    if (filter.operator === "in" && Array.isArray(value)) {
      params.set(`${filter.field}__in`, value.map(String).join(","));
      return;
    }

    if (["gt", "gte", "lt", "lte", "ne"].includes(filter.operator)) {
      params.set(`${filter.field}__${filter.operator}`, String(value));
      return;
    }

    if (filter.operator === "null") {
      params.set(`${filter.field}__null`, String(Boolean(value)));
    }
  });

  return params;
};

const singletonList = async (resource: string) => {
  const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildResourceUrl(resource));
  const item = unwrapData(payload);
  return {
    data: item ? [item] : [],
    total: item ? 1 : 0,
  } as never;
};

export const dataProvider: DataProvider = {
  getApiUrl: () => baseUrl,

  getList: async ({ resource, pagination, filters, sorters }: GetListParams) => {
    const config = getConfig(resource);
    if (config.singleton) {
      return singletonList(resource);
    }

    const params = buildListParams(pagination, filters, sorters);
    const { payload } = await requestJson<ApiEnvelope<BaseRecord[]>>(
      `${buildResourceUrl(resource)}?${params.toString()}`,
    );
    const data = unwrapData<BaseRecord[]>(payload) ?? [];
    const total = Number(payload.pagination?.total ?? data.length);

    return { data: data as never, total } as never;
  },

  getOne: async ({ resource, id }: GetOneParams) => {
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(
      buildResourceUrl(resource, getConfig(resource).singleton ? undefined : id),
    );
    return { data: unwrapData(payload) as never } as never;
  },

  getMany: async ({ resource, ids }: GetManyParams) => {
    const records = await Promise.all(
      ids.map(async (id) => {
        const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildResourceUrl(resource, id));
        return unwrapData(payload);
      }),
    );
    return { data: records as never } as never;
  },

  create: (async ({ resource, variables }: CreateParams) => {
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildResourceUrl(resource), {
      method: "POST",
      body: JSON.stringify(variables),
    });
    return { data: unwrapData(payload) as never } as never;
  }) as DataProvider["create"],

  update: (async ({ resource, id, variables }: UpdateParams) => {
    const method = getConfig(resource).api === "v1" ? "PATCH" : "PATCH";
    const target = buildResourceUrl(resource, getConfig(resource).singleton ? undefined : id);
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(target, {
      method,
      body: JSON.stringify(variables),
    });
    return { data: unwrapData(payload) as never } as never;
  }) as DataProvider["update"],

  deleteOne: (async ({ resource, id, variables }: DeleteOneParams) => {
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildResourceUrl(resource, id), {
      method: "DELETE",
      body: variables ? JSON.stringify(variables) : undefined,
    });
    return {
      data: (unwrapData<BaseRecord | undefined>(payload) ?? ({ id } as BaseRecord)) as never,
    } as never;
  }) as DataProvider["deleteOne"],

  custom: async ({ url, method = "get", payload, query, headers }: CustomParams) => {
    const normalizedMethod = method.toUpperCase();
    const targetUrl = query
      ? `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(
          Object.entries(query).reduce<Record<string, string>>((acc, [key, value]) => {
            if (value !== undefined && value !== null) acc[key] = String(value);
            return acc;
          }, {}),
        ).toString()}`
      : url;

    const { payload: responsePayload } = await requestJson<ApiEnvelope<BaseRecord> | BaseRecord>(
      targetUrl,
      {
        method: normalizedMethod,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      },
    );

    return { data: unwrapData(responsePayload) as never } as never;
  },
};
