import { ApiError } from "./errors.js";

type IcdTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

type IcdSearchEntity = {
  id?: unknown;
  theCode?: unknown;
  title?: unknown;
};

type IcdSearchResponse = {
  destinationEntities?: unknown;
};

type IcdCodeInfoResponse = {
  code?: unknown;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

export type Icd11SearchResult = {
  id: string;
  code: string;
  description: string;
  codeSystem: "ICD-11";
};

let tokenCache: CachedToken | null = null;
let tokenRequest: Promise<string> | null = null;

const ICD_TOKEN_ENDPOINT = "https://icdaccessmanagement.who.int/connect/token";
const ICD_API_BASE = "https://id.who.int";

export const parseBoundedTimeoutMs = (setting?: string) => {
  const parsedTimeout = setting?.trim() ? Number(setting) : 8_000;
  if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1) {
    throw new ApiError(500, "ICD11_TIMEOUT_CONFIG_INVALID", "ICD_API_TIMEOUT_MS must be a positive integer.");
  }
  return Math.max(1_000, Math.min(30_000, parsedTimeout));
};

const getIcdConfig = () => {
  const clientId = (process.env.ICD_API_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.ICD_API_CLIENT_SECRET ?? "").trim();
  const releaseVersion = (process.env.ICD_API_RELEASE_VERSION ?? "").trim();
  const defaultLanguage = (process.env.ICD_API_LANGUAGE ?? "en").trim();
  const timeoutMs = parseBoundedTimeoutMs(process.env.ICD_API_TIMEOUT_MS);

  return { clientId, clientSecret, releaseVersion, defaultLanguage, timeoutMs };
};

const getCachedToken = () => {
  if (!tokenCache) return null;
  if (Date.now() >= tokenCache.expiresAt) {
    tokenCache = null;
    return null;
  }
  return tokenCache.accessToken;
};

const parseTitle = (title: unknown) => {
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && "@value" in title && typeof title["@value"] === "string") {
    return title["@value"];
  }
  return "";
};

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");

export const sanitizeIcdTitle = (value: string) =>
  decodeHtmlEntities(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

export const mapIcd11Entities = (entities: unknown): Icd11SearchResult[] => {
  if (!Array.isArray(entities)) return [];
  return entities.flatMap((rawEntity) => {
    if (!rawEntity || typeof rawEntity !== "object") return [];
    const entity = rawEntity as IcdSearchEntity;
    const code = typeof entity.theCode === "string" ? entity.theCode.trim() : "";
    const description = sanitizeIcdTitle(parseTitle(entity.title));
    if (!code || !description) return [];
    return [{
      id: typeof entity.id === "string" && entity.id ? entity.id : `${code}-${description}`,
      code,
      description,
      codeSystem: "ICD-11" as const,
    }];
  });
};

const fetchJson = async (url: string | URL, init: RequestInit, timeoutMs: number, timeoutMessage: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new ApiError(504, "ICD11_UPSTREAM_TIMEOUT", timeoutMessage);
      }
    }
    return { response, payload };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(504, "ICD11_UPSTREAM_TIMEOUT", timeoutMessage);
    }
    throw new ApiError(502, "ICD11_UPSTREAM_UNAVAILABLE", "Could not connect to the WHO ICD-11 API.");
  } finally {
    clearTimeout(timeout);
  }
};

const requestAccessToken = async (timeoutMs: number) => {
  const cached = getCachedToken();
  if (cached) return cached;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const { clientId, clientSecret } = getIcdConfig();
    if (!clientId || !clientSecret) {
      throw new ApiError(
        500,
        "ICD11_CREDENTIALS_MISSING",
        "ICD-11 API credentials are not configured. Set ICD_API_CLIENT_ID and ICD_API_CLIENT_SECRET.",
      );
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const { response, payload: rawPayload } = await fetchJson(ICD_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "icdapi_access" }).toString(),
      cache: "no-store",
    }, timeoutMs, "Timed out while authenticating to the WHO ICD-11 API.");

    const payload = rawPayload as IcdTokenResponse | null;
    if (!response.ok || typeof payload?.access_token !== "string" || !payload.access_token) {
      throw new ApiError(502, "ICD11_AUTH_FAILED", "Unable to authenticate with the WHO ICD-11 API.");
    }

    const advertisedLifetimeSeconds =
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? Math.max(1, payload.expires_in)
        : 300;
    const refreshSkewSeconds = Math.min(Math.floor(advertisedLifetimeSeconds * 0.2), 60);
    tokenCache = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(1, advertisedLifetimeSeconds - refreshSkewSeconds) * 1_000,
    };
    return payload.access_token;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
};

export const searchIcd11 = async (query: string, limit = 8, language?: string) => {
  const config = getIcdConfig();
  if (!config.releaseVersion) {
    throw new ApiError(500, "ICD11_RELEASE_MISSING", "ICD_API_RELEASE_VERSION must be configured.");
  }
  const token = await requestAccessToken(config.timeoutMs);
  const searchUrl = new URL(
    `${ICD_API_BASE}/icd/release/11/${encodeURIComponent(config.releaseVersion)}/mms/search`,
  );
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("useFlexisearch", "true");
  searchUrl.searchParams.set("flatResults", "true");
  searchUrl.searchParams.set("subtreeFilterUsesFoundationDescendants", "false");

  const { response, payload: rawPayload } = await fetchJson(searchUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": language ?? config.defaultLanguage,
      "API-Version": "v2",
    },
    cache: "no-store",
  }, config.timeoutMs, "Timed out while searching WHO ICD-11 diagnoses.");

  if (!response.ok) {
    if (response.status === 401) tokenCache = null;
    throw new ApiError(502, "ICD11_SEARCH_FAILED", "Failed to search the WHO ICD-11 API.");
  }

  const payload = rawPayload as IcdSearchResponse | null;
  if (!payload || typeof payload !== "object") {
    throw new ApiError(502, "ICD11_RESPONSE_INVALID", "The WHO ICD-11 API returned an invalid search response.");
  }
  return mapIcd11Entities(payload?.destinationEntities).slice(0, limit);
};

export const findIcd11Code = async (code: string) => {
  const config = getIcdConfig();
  if (!config.releaseVersion) {
    throw new ApiError(500, "ICD11_RELEASE_MISSING", "ICD_API_RELEASE_VERSION must be configured.");
  }
  const token = await requestAccessToken(config.timeoutMs);
  const codeInfoUrl = new URL(
    `${ICD_API_BASE}/icd/release/11/${encodeURIComponent(config.releaseVersion)}/mms/codeinfo/${encodeURIComponent(code)}`,
  );
  const { response, payload: rawPayload } = await fetchJson(codeInfoUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": config.defaultLanguage,
      "API-Version": "v2",
    },
    cache: "no-store",
  }, config.timeoutMs, "Timed out while validating the WHO ICD-11 code.");

  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok) {
    if (response.status === 401) tokenCache = null;
    throw new ApiError(502, "ICD11_CODE_LOOKUP_FAILED", "Failed to validate the WHO ICD-11 code.");
  }
  const codeInfo = rawPayload as IcdCodeInfoResponse | null;
  const verifiedCode = typeof codeInfo?.code === "string" ? codeInfo.code : null;
  if (!verifiedCode || verifiedCode.toUpperCase() !== code.toUpperCase()) {
    return null;
  }

  const results = await searchIcd11(code, 20);
  return results.find((result) => result.code.toUpperCase() === verifiedCode.toUpperCase()) ?? null;
};
