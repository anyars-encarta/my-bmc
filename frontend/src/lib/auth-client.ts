import { createAuthClient } from "better-auth/react";
import { BACKEND_BASE_URL } from "../constants";
import { inferAdditionalFields } from "better-auth/client/plugins";

const authBaseURL = import.meta.env.DEV
  ? `${BACKEND_BASE_URL}/auth`
  : typeof window !== "undefined"
    ? `${window.location.origin.replace(/\/+$/, "")}/api/auth`
    : `${BACKEND_BASE_URL}/auth`;

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: "string" },
        status: { type: "string" },
        imageCldPubId: { type: "string" },
      },
    }),
  ],
});
