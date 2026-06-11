import type {
  BaseRecord,
  CrudFilter,
  CrudFilters,
  CrudSorting,
  DataProvider,
  HttpError,
} from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
  message?: string;
  success?: boolean;
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  };
};

const apiUrl = BACKEND_BASE_URL.replace(/\/+$/, "");
const listCache = new Map<string, BaseRecord[]>();

const isUsersResource = (resource: string) => resource === "users";

const toError = (response: Response, payload: unknown) => {
  const payloadMessage =
    payload && typeof payload === "object"
      ? "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "message" in payload && typeof payload.message === "string"
          ? payload.message
          : null
      : null;

  const error = new Error(payloadMessage || response.statusText) as HttpError;
  error.statusCode = response.status;
  error.message = payloadMessage || response.statusText;
  error.errors = payload;

  return error;
};

const unwrapData = <T>(payload: ApiEnvelope<T> | T): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data as T;
  }

  return payload as T;
};

const buildUrl = (resource: string, id?: string | number) =>
  `${apiUrl}/${resource}${id !== undefined ? `/${id}` : ""}`;

const normalizeValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase();
};

const collectSearchableValues = (value: unknown, depth = 0): string[] => {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (depth >= 2) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSearchableValues(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      collectSearchableValues(entry, depth + 1),
    );
  }

  return [];
};

const applyFilter = <T extends BaseRecord>(records: T[], filter: CrudFilter) => {
  if (!("field" in filter)) {
    return records;
  }

  const { field, operator, value } = filter;

  if (field === "search" && operator === "contains") {
    const normalizedSearch = normalizeValue(value).trim();

    if (!normalizedSearch) {
      return records;
    }

    return records.filter((record) =>
      collectSearchableValues(record).some((entry) =>
        normalizeValue(entry).includes(normalizedSearch),
      ),
    );
  }

  return records.filter((record) => {
    const rawValue = record[field];

    switch (operator) {
      case "eq":
        return normalizeValue(rawValue) === normalizeValue(value);
      case "contains":
        return normalizeValue(rawValue).includes(normalizeValue(value));
      default:
        return true;
    }
  });
};

const applyClientFilters = <T extends BaseRecord>(
  records: T[],
  filters?: CrudFilters,
) => {
  if (!filters?.length) {
    return records;
  }

  return filters.reduce((result, filter) => applyFilter(result, filter), records);
};

const applyClientSorters = <T extends BaseRecord>(
  records: T[],
  sorters?: CrudSorting,
) => {
  if (!sorters?.length) {
    return records;
  }

  return [...records].sort((left, right) => {
    for (const sorter of sorters) {
      const leftValue = left[sorter.field];
      const rightValue = right[sorter.field];

      if (leftValue === rightValue) {
        continue;
      }

      if (leftValue === undefined || leftValue === null) {
        return sorter.order === "asc" ? -1 : 1;
      }

      if (rightValue === undefined || rightValue === null) {
        return sorter.order === "asc" ? 1 : -1;
      }

      if (leftValue > rightValue) {
        return sorter.order === "asc" ? 1 : -1;
      }

      if (leftValue < rightValue) {
        return sorter.order === "asc" ? -1 : 1;
      }
    }

    return 0;
  });
};

const applyClientPagination = <T extends BaseRecord>(
  records: T[],
  currentPage = 1,
  pageSize = 10,
) => {
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;

  return records.slice(start, end);
};

const buildUsersListParams = (
  filters?: CrudFilters,
  currentPage = 1,
  pageSize = 10,
) => {
  const params = new URLSearchParams({
    page: String(currentPage),
    limit: String(pageSize),
  });

  filters?.forEach((filter) => {
    if (!("field" in filter)) {
      return;
    }

    if (filter.field === "search" && filter.operator === "contains") {
      params.set("search", String(filter.value ?? ""));
      return;
    }

    if ((filter.field === "role" || filter.field === "status") && filter.operator === "eq") {
      params.set(filter.field, String(filter.value ?? ""));
    }
  });

  return params;
};

const requestJson = async <T>(
  input: string,
  init?: RequestInit,
): Promise<{ payload: T; response: Response }> => {
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  let payload: T;
  if (!text) {
    payload = {} as T;
  } else if (contentType.includes("application/json")) {
    payload = JSON.parse(text) as T;
  } else {
    // Some server/proxy failures return HTML instead of JSON.
    // Preserve a readable error payload rather than crashing on JSON.parse.
    payload = ({
      message: text.slice(0, 200),
    } as unknown) as T;
  }

  if (!response.ok) {
    throw toError(response, payload);
  }

  return { payload, response };
};

export const dataProvider: DataProvider = {
  getApiUrl: () => apiUrl,

  getList: async ({ resource, pagination, filters, sorters }) => {
    const currentPage = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 10;

    if (isUsersResource(resource)) {
      const params = buildUsersListParams(filters, currentPage, pageSize);
      const { payload } = await requestJson<ApiEnvelope<BaseRecord[]>>(
        `${buildUrl(resource)}?${params.toString()}`,
      );

      const data = unwrapData<BaseRecord[]>(payload) ?? [];

      return {
        data,
        total: Number(payload.pagination?.total ?? data.length),
      };
    }

    let allData = listCache.get(resource);

    if (!allData) {
      const { payload } = await requestJson<ApiEnvelope<BaseRecord[]>>(buildUrl(resource));
      allData = unwrapData<BaseRecord[]>(payload) ?? [];
      listCache.set(resource, allData);
    }

    const filtered = applyClientFilters(allData, filters);
    const sorted = applyClientSorters(filtered, sorters);
    const paged = applyClientPagination(sorted, currentPage, pageSize);

    return {
      data: paged,
      total: sorted.length,
    };
  },

  getOne: async ({ resource, id }) => {
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildUrl(resource, id));

    return {
      data: unwrapData<BaseRecord>(payload),
    };
  },

  getMany: async ({ resource, ids }) => {
    const records = await Promise.all(
      ids.map(async (id) => {
        const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildUrl(resource, id));
        return unwrapData<BaseRecord>(payload);
      }),
    );

    return { data: records };
  },

  create: async ({ resource, variables }) => {
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildUrl(resource), {
      method: "POST",
      body: JSON.stringify(variables),
    });

    listCache.delete(resource);

    return {
      data: unwrapData<BaseRecord>(payload),
    };
  },

  update: async ({ resource, id, variables }) => {
    const method = isUsersResource(resource) ? "PUT" : "PATCH";
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildUrl(resource, id), {
      method,
      body: JSON.stringify(variables),
    });

    listCache.delete(resource);

    return {
      data: unwrapData<BaseRecord>(payload),
    };
  },

  deleteOne: async ({ resource, id, variables }) => {
    const { payload } = await requestJson<ApiEnvelope<BaseRecord>>(buildUrl(resource, id), {
      method: "DELETE",
      body: variables ? JSON.stringify(variables) : undefined,
    });

    listCache.delete(resource);

    return {
      data: unwrapData<BaseRecord | undefined>(payload) ?? ({ id } as BaseRecord),
    };
  },

  custom: async ({ url, method = "get", payload, query, headers }) => {
    const targetUrl = query
      ? `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(
          Object.entries(query).reduce<Record<string, string>>((acc, [key, value]) => {
            if (value !== undefined && value !== null) {
              acc[key] = String(value);
            }
            return acc;
          }, {}),
        ).toString()}`
      : url;

    const { payload: responsePayload } = await requestJson<ApiEnvelope<BaseRecord> | BaseRecord>(
      targetUrl,
      {
        method: method.toUpperCase(),
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      },
    );

    return {
      data: unwrapData(responsePayload),
    };
  },
};
