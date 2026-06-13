type MomoProduct = "collection" | "disbursement";

type MomoBalance = {
  availableBalance: string;
  currency: string;
};

type MomoTransferInput = {
  amount: string;
  currency?: string;
  phoneNumber: string;
  externalId: string;
  payerMessage?: string;
  payeeNote?: string;
};

type MomoTransferResult = {
  referenceId: string;
  status: "pending";
};

type MomoTransferStatus = {
  status: "SUCCESSFUL" | "FAILED" | "PENDING" | "UNKNOWN";
  reason?: string;
  raw: unknown;
};

type PollTransferStatusInput = {
  referenceId: string;
  maxAttempts?: number;
  intervalMs?: number;
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

export const initiateMomoTransfer = async (
  input: MomoTransferInput,
): Promise<MomoTransferResult> => {
  const config = getConfig();
  const accessToken = await getAccessToken(config);
  const transferUrl = `${config.baseUrl}/${config.product}/v1_0/transfer`;
  const referenceId = crypto.randomUUID();
  const currency = normalizeValue(input.currency, "GHS").toUpperCase();

  await requestMomo(transferUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Reference-Id": referenceId,
      "X-Target-Environment": config.targetEnvironment,
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      amount: input.amount,
      currency,
      externalId: input.externalId,
      payee: {
        partyIdType: "MSISDN",
        partyId: input.phoneNumber,
      },
      payerMessage: input.payerMessage ?? "Facility disbursement",
      payeeNote: input.payeeNote ?? "Payment disbursement",
    }),
  });

  return {
    referenceId,
    status: "pending",
  };
};

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeTransferState = (value: unknown): MomoTransferStatus["status"] => {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "SUCCESSFUL") {
    return "SUCCESSFUL";
  }

  if (normalized === "FAILED") {
    return "FAILED";
  }

  if (normalized === "PENDING") {
    return "PENDING";
  }

  return "UNKNOWN";
};

export const getMomoTransferStatus = async (
  referenceId: string,
): Promise<MomoTransferStatus> => {
  const config = getConfig();
  const accessToken = await getAccessToken(config);
  const statusUrl = `${config.baseUrl}/${config.product}/v1_0/transfer/${referenceId}`;

  const { data } = await requestMomo(statusUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Target-Environment": config.targetEnvironment,
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      Accept: "application/json",
    },
  });

  if (!data || typeof data !== "object") {
    return { status: "UNKNOWN", raw: data };
  }

  const reason =
    "reason" in data && typeof data.reason === "string"
      ? data.reason
      : "financialTransactionId" in data && typeof data.financialTransactionId === "string"
        ? data.financialTransactionId
        : undefined;

  return {
    status: normalizeTransferState("status" in data ? data.status : undefined),
    ...(reason ? { reason } : {}),
    raw: data,
  };
};

export const pollMomoTransferStatus = async ({
  referenceId,
  maxAttempts,
  intervalMs,
}: PollTransferStatusInput): Promise<MomoTransferStatus> => {
  const attempts = Math.max(1, maxAttempts ?? Number(process.env.MTN_MOMO_POLL_MAX_ATTEMPTS ?? 10));
  const waitMs = Math.max(500, intervalMs ?? Number(process.env.MTN_MOMO_POLL_INTERVAL_MS ?? 3000));

  let lastStatus: MomoTransferStatus = {
    status: "UNKNOWN",
    raw: null,
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastStatus = await getMomoTransferStatus(referenceId);

    if (lastStatus.status === "SUCCESSFUL" || lastStatus.status === "FAILED") {
      return lastStatus;
    }

    if (attempt < attempts) {
      await sleep(waitMs);
    }
  }

  return lastStatus;
};
