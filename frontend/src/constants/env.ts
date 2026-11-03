const getEnvVar = (key: string): string => {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
};

const normalizeApiBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};

const getApiBaseUrl = () => {
  if (import.meta.env.DEV) {
    return normalizeApiBaseUrl(getEnvVar("VITE_BACKEND_BASE_URL"));
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin.replace(/\/+$/, "")}/api`;
  }

  return normalizeApiBaseUrl(getEnvVar("VITE_BACKEND_BASE_URL"));
};

export const CLOUDINARY_UPLOAD_URL = getEnvVar("VITE_CLOUDINARY_UPLOAD_URL");
export const CLOUDINARY_CLOUD_NAME = getEnvVar("VITE_CLOUDINARY_CLOUD_NAME");
export const BACKEND_BASE_URL = getApiBaseUrl();

export const BASE_URL = getEnvVar("VITE_API_URL");
export const ACCESS_TOKEN_KEY = getEnvVar("VITE_ACCESS_TOKEN_KEY");
export const REFRESH_TOKEN_KEY = getEnvVar("VITE_REFRESH_TOKEN_KEY");

export const REFRESH_TOKEN_URL = `${BASE_URL}/refresh-token`;

export const CLOUDINARY_UPLOAD_PRESET = getEnvVar("VITE_CLOUDINARY_UPLOAD_PRESET");
