const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveApiBaseUrl = () => {
  // In production, use same-origin requests so Vercel rewrites keep auth cookies first-party.
  if (import.meta.env.PROD && typeof window !== "undefined") {
    return normalizeBaseUrl(window.location.origin);
  }

  const rawBaseUrl = import.meta.env.VITE_API_URL?.trim();
  return rawBaseUrl && rawBaseUrl.length > 0 ? normalizeBaseUrl(rawBaseUrl) : "";
};

const API_BASE_URL = resolveApiBaseUrl();

const buildApiUrl = (path: string) => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const withoutApiPrefix = normalized.replace(/^\/api\//, "/");

  if (API_BASE_URL.endsWith("/api")) {
    return `${API_BASE_URL}${withoutApiPrefix}`;
  }

  return `${API_BASE_URL}/api${withoutApiPrefix}`;
};

type QueryParamValue = string | number | boolean | null | undefined;

const withQuery = (
  path: string,
  query?: Record<string, QueryParamValue>,
) => {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  if (!queryString) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${queryString}`;
};

export class ApiError extends Error {
  status: number;
  details?: string[];

  constructor(message: string, status: number, details?: string[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function apiGet<T>(
  path: string,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: "include",
    signal: options?.signal,
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let details: string[] | undefined;

    try {
      const errorBody = (await response.json()) as {
        message?: string;
        error?: string;
        details?: string[];
      };
      message = errorBody.message ?? errorBody.error ?? message;
      details = errorBody.details;
    } catch {
      // Keep fallback message when response body is not JSON.
    }

    throw new ApiError(message, response.status, details);
  }

  return (await response.json()) as T;
}

type PaginatedResponse<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
};

export async function apiGetAllPages<T>(
  path: string,
  options?: {
    query?: Record<string, QueryParamValue>;
    pageSize?: number;
    signal?: AbortSignal;
  },
): Promise<T[]> {
  const pageSize = options?.pageSize ?? 200;
  const baseQuery = options?.query ?? {};

  const firstPage = await apiGet<PaginatedResponse<T>>(
    withQuery(path, {
      ...baseQuery,
      page: 1,
      limit: pageSize,
    }),
    { signal: options?.signal },
  );

  const allRows = [...firstPage.data];
  const limit = Math.max(1, firstPage.pagination.limit || pageSize);
  const totalPages = Math.max(1, Math.ceil(firstPage.pagination.total / limit));

  if (totalPages === 1) {
    return allRows;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      apiGet<PaginatedResponse<T>>(
        withQuery(path, {
          ...baseQuery,
          page: index + 2,
          limit,
        }),
        { signal: options?.signal },
      ),
    ),
  );

  for (const page of remainingPages) {
    allRows.push(...page.data);
  }

  return allRows;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let details: string[] | undefined;
    try {
      const errorBody = (await response.json()) as {
        message?: string;
        error?: string;
        details?: string[];
      };
      message = errorBody.message ?? errorBody.error ?? message;
      details = errorBody.details;
    } catch {
      // Keep fallback message when response body is not JSON.
    }
    throw new ApiError(message, response.status, details);
  }

  return (await response.json()) as T;
}

export async function apiPut<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let details: string[] | undefined;
    try {
      const errorBody = (await response.json()) as {
        message?: string;
        error?: string;
        details?: string[];
      };
      message = errorBody.message ?? errorBody.error ?? message;
      details = errorBody.details;
    } catch {
      // Keep fallback message when response body is not JSON.
    }
    throw new ApiError(message, response.status, details);
  }

  return (await response.json()) as T;
}

export async function apiDelete<T = { success: boolean }>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    method: "DELETE",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let details: string[] | undefined;
    try {
      const errorBody = (await response.json()) as {
        message?: string;
        error?: string;
        details?: string[];
      };
      message = errorBody.message ?? errorBody.error ?? message;
      details = errorBody.details;
    } catch {
      // Keep fallback message when response body is not JSON.
    }
    throw new ApiError(message, response.status, details);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export { withQuery };
