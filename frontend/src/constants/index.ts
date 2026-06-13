
export const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB in bytes
export const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
];

const getEnvVar = (key: string): string => {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
};

const normalizeApiBaseUrl = (value: string) => {
  const trimmed = value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};

const getApiBaseUrl = () => {
  // In dev, use the configured backend URL (e.g. http://localhost:8000/api).
  if (import.meta.env.DEV) {
    return normalizeApiBaseUrl(getEnvVar("VITE_BACKEND_BASE_URL"));
  }

  // In production, always route through the same-origin Vercel proxy (/api/*).
  // This keeps the session cookie on the frontend domain, matching the auth flow correctly.
  if (typeof window !== "undefined") {
    return `${window.location.origin.replace(/\/+$/, "")}/api`;
  }

  // SSR/build-time fallback.
  return normalizeApiBaseUrl(getEnvVar("VITE_BACKEND_BASE_URL"));
};

export const CLOUDINARY_UPLOAD_URL = getEnvVar("VITE_CLOUDINARY_UPLOAD_URL");
export const CLOUDINARY_CLOUD_NAME = getEnvVar("VITE_CLOUDINARY_CLOUD_NAME");
export const BACKEND_BASE_URL = getApiBaseUrl();

export const BASE_URL = getEnvVar("VITE_API_URL");
export const ACCESS_TOKEN_KEY = getEnvVar("VITE_ACCESS_TOKEN_KEY");
export const REFRESH_TOKEN_KEY = getEnvVar("VITE_REFRESH_TOKEN_KEY");

export const REFRESH_TOKEN_URL = `${BASE_URL}/refresh-token`;

export const CLOUDINARY_UPLOAD_PRESET = getEnvVar(
  "VITE_CLOUDINARY_UPLOAD_PRESET",
);

// Currency options (can be extended based on business needs)
export const CURRENCY_OPTIONS = [
  { value: "GHS", label: "Ghanaian Cedis (GHS)" },
  { value: "USD", label: "United States Dollar (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "GBP", label: "British Pound (GBP)" },
  { value: "NGN", label: "Nigerian Naira (NGN)" },
] as const;

// Date format options
export const DATE_FORMAT_OPTIONS = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
] as const;

// Locale options
export const LOCALE_OPTIONS = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-GH", label: "English (Ghana)" },
  { value: "en-NG", label: "English (Nigeria)" },
  { value: "en-EU", label: "English (Europe)" },
] as const;
