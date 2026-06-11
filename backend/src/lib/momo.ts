type MomoProduct = "collection" | "disbursement";

type MomoBalance = {
  availableBalance: string;
  currency: string;
};

type MomoEnvConfig = {
  baseUrl: string;
  product: MomoProduct;
  apiUser: string;
  apiKey: string;
  subscriptionKey: string;
  targetEnvironment: string;
};

export class MomoConfigError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = "MomoConfigError";
    this.statusCode = 503;
  }
}

export class MomoApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 502, details?: unknown) {
    super(message);
    this.name = "MomoApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const parseJsonSafely = (value: string): unknown => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const normalizeValue = (value: string | undefined, fallback = "") =>
  (value ?? fallback).trim().replace(/^['"]|['"]$/g, "");

const getConfig = (): MomoEnvConfig => {
  const baseUrl = normalizeValue(
    process.env.MTN_MOMO_BASE_URL,
    "https://sandbox.momodeveloper.mtn.com",
  ).replace(/\/+$/, "");

  const productRaw = normalizeValue(process.env.MTN_MOMO_PRODUCT, "collection").toLowerCase();
  const product: MomoProduct = productRaw === "disbursement" ? "disbursement" : "collection";

  const apiUser = normalizeValue(process.env.MTN_MOMO_API_USER);
  const apiKey = normalizeValue(process.env.MTN_MOMO_API_KEY);
  const subscriptionKey = normalizeValue(process.env.MTN_MOMO_SUBSCRIPTION_KEY);
  const targetEnvironment = normalizeValue(process.env.MTN_MOMO_TARGET_ENVIRONMENT, "sandbox");

  if (!apiUser || !apiKey || !subscriptionKey) {
    throw new MomoConfigError(
      "MTN MoMo API credentials are not configured. Set MTN_MOMO_API_USER, MTN_MOMO_API_KEY, and MTN_MOMO_SUBSCRIPTION_KEY.",
    );
  }

  return {
    baseUrl,
    product,
    apiUser,
    apiKey,
    subscriptionKey,
    targetEnvironment,
  };
};

const requestMomo = async (
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
): Promise<{ status: number; data: unknown }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const text = await response.text();
    const data = parseJsonSafely(text);

    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data && typeof data.message === "string"
          ? data.message
          : `MTN MoMo request failed with status ${response.status}`;

      throw new MomoApiError(message, response.status, data);
    }

    return { status: response.status, data };
  } catch (error) {
    if (error instanceof MomoApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new MomoApiError("MTN MoMo request timed out.", 504);
    }

    throw new MomoApiError(
      error instanceof Error ? error.message : "Unable to reach MTN MoMo API.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
};

const getAccessToken = async (config: MomoEnvConfig): Promise<string> => {
  const tokenUrl = `${config.baseUrl}/${config.product}/token/`;
  const basicAuth = Buffer.from(`${config.apiUser}:${config.apiKey}`).toString("base64");

  const { data } = await requestMomo(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
    },
  });

  if (
    !data ||
    typeof data !== "object" ||
    !("access_token" in data) ||
    typeof data.access_token !== "string"
  ) {
    throw new MomoApiError("MTN MoMo token response did not include access_token.", 502, data);
  }

  return data.access_token;
};

export const getMomoBalance = async (): Promise<MomoBalance> => {
  const config = getConfig();
  const accessToken = await getAccessToken(config);
  const balanceUrl = `${config.baseUrl}/${config.product}/v1_0/account/balance`;

  const { data } = await requestMomo(balanceUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Target-Environment": config.targetEnvironment,
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      Accept: "application/json",
    },
  });

  if (
    !data ||
    typeof data !== "object" ||
    !("availableBalance" in data) ||
    !("currency" in data) ||
    typeof data.availableBalance !== "string" ||
    typeof data.currency !== "string"
  ) {
    throw new MomoApiError("Unexpected MTN MoMo balance response payload.", 502, data);
  }

  return {
    availableBalance: data.availableBalance,
    currency: data.currency,
  };
};
