import { ApiError } from "./errors.js";

type OpenFdaActiveIngredient = {
  name?: unknown;
  strength?: unknown;
};

type OpenFdaNdcItem = {
  product_ndc?: unknown;
  brand_name?: unknown;
  generic_name?: unknown;
  dosage_form?: unknown;
  labeler_name?: unknown;
  route?: unknown;
  active_ingredients?: unknown;
};

type OpenFdaNdcResponse = {
  error?: { message?: unknown };
  results?: unknown;
};

export type OpenFdaMedication = {
  id: string;
  name: string;
  genericName: string | null;
  productNdc: string | null;
  dosageForm: string | null;
  labelerName: string | null;
  route: string | null;
  dose: string | null;
};

const FDA_NDC_ENDPOINT = "https://api.fda.gov/drug/ndc.json";

export const parseOpenFdaTimeoutMs = (setting?: string) => {
  const parsedTimeout = setting?.trim() ? Number(setting) : 8_000;
  if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1) {
    throw new ApiError(500, "OPEN_FDA_TIMEOUT_CONFIG_INVALID", "OPEN_FDA_API_TIMEOUT_MS must be a positive integer.");
  }
  return Math.max(3_000, Math.min(15_000, parsedTimeout));
};

export const buildOpenFdaSearchQuery = (query: string) => {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!terms.length) return null;
  const fields = [
    "brand_name",
    "generic_name",
    "product_ndc",
    "active_ingredients.name",
    "active_ingredients.strength",
    "dosage_form",
  ];
  return terms
    .map((term) => `(${fields.map((field) => `${field}:${term}*`).join(" OR ")})`)
    .join(" AND ");
};

const fieldText = (value: unknown) => typeof value === "string" ? value.trim() : "";

const formatDose = (value: unknown) => {
  if (!Array.isArray(value)) return null;
  const strengths = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const strength = fieldText((entry as OpenFdaActiveIngredient).strength);
    return strength ? [strength] : [];
  });
  return strengths.length ? strengths.join(" + ").slice(0, 60) : null;
};

export const mapOpenFdaNdcResults = (value: unknown): OpenFdaMedication[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object") return [];
    const item = rawItem as OpenFdaNdcItem;
    const productNdc = fieldText(item.product_ndc);
    const brandName = fieldText(item.brand_name);
    const genericName = fieldText(item.generic_name);
    const name = brandName || genericName;
    if (!name) return [];

    const uniqueKey = productNdc || `${name.toLowerCase()}-${index}`;
    if (seen.has(uniqueKey)) return [];
    seen.add(uniqueKey);

    const route = Array.isArray(item.route) ? fieldText(item.route[0]) : "";
    return [{
      id: uniqueKey,
      name,
      genericName: genericName || null,
      productNdc: productNdc || null,
      dosageForm: fieldText(item.dosage_form) || null,
      labelerName: fieldText(item.labeler_name) || null,
      route: route || null,
      dose: formatDose(item.active_ingredients),
    }];
  });
};

const fetchWithTimeout = async (url: URL, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(504, "OPEN_FDA_TIMEOUT", "Timed out while searching medications.");
    }
    throw new ApiError(502, "OPEN_FDA_UNAVAILABLE", "Unable to connect to the OpenFDA API.");
  } finally {
    clearTimeout(timeout);
  }
};

export const searchOpenFdaMedications = async (query: string, limit = 8) => {
  const search = buildOpenFdaSearchQuery(query);
  if (!search) return [];

  const upstream = new URL(FDA_NDC_ENDPOINT);
  upstream.searchParams.set("search", search);
  upstream.searchParams.set("limit", String(limit));

  const apiKey = (process.env.OPEN_FDA_API_KEY ?? "").trim();
  if (apiKey) upstream.searchParams.set("api_key", apiKey);

  const response = await fetchWithTimeout(upstream, parseOpenFdaTimeoutMs(process.env.OPEN_FDA_API_TIMEOUT_MS));
  const payload = await response.json().catch(() => null) as OpenFdaNdcResponse | null;

  if (response.status === 404) return [];
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string"
      ? payload.error.message
      : "Unable to search medications right now.";
    throw new ApiError(502, "OPEN_FDA_SEARCH_FAILED", message);
  }
  if (!payload || typeof payload !== "object") {
    throw new ApiError(502, "OPEN_FDA_RESPONSE_INVALID", "OpenFDA returned an invalid medication search response.");
  }

  return mapOpenFdaNdcResults(payload.results).slice(0, limit);
};
