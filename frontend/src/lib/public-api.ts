import { BACKEND_BASE_URL } from "@/constants";

export const getPublicApiBase = () => {
  const base = BACKEND_BASE_URL.replace(/\/+$/, "");
  return import.meta.env.DEV ? base.replace(/\/api$/, "") : base;
};
