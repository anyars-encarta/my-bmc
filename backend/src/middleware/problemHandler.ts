import type { NextFunction, Request, Response } from "express";

import { ApiError } from "../lib/errors.js";

const SQLSTATE_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  "23505": { status: 409, code: "CONFLICT", message: "A duplicate value violates a unique constraint." },
  "23503": { status: 409, code: "FOREIGN_KEY_CONSTRAINT", message: "Related record does not exist." },
  "23514": { status: 422, code: "CHECK_CONSTRAINT", message: "Value violates a database check constraint." },
  "22P02": { status: 400, code: "INVALID_PARAMETER", message: "Invalid parameter format." },
  "42P01": { status: 500, code: "DB_SCHEMA_ERROR", message: "Required database object is missing." },
};

const toApiError = (error: unknown) => {
  if (error instanceof ApiError) {
    return error;
  }

  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: string }).code ?? "");
    const mapped = SQLSTATE_ERROR_MAP[code];
    if (mapped) {
      return new ApiError(mapped.status, mapped.code, mapped.message, {
        details: { sqlState: code },
      });
    }
  }

  return new ApiError(500, "INTERNAL_SERVER_ERROR", "An unexpected server error occurred.");
};

const statusTitle = (status: number) => {
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not Found";
  if (status === 409) return "Conflict";
  if (status === 422) return "Unprocessable Entity";
  if (status === 429) return "Too Many Requests";
  if (status === 503) return "Service Unavailable";
  return "Internal Server Error";
};

export const problemHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const apiError = toApiError(error);
  const status = apiError.status;
  const title = statusTitle(status);

  if (status >= 500) {
    console.error("Unhandled API error:", error);
  }

  res.status(status).type("application/problem+json").json({
    type: apiError.type ?? "about:blank",
    title,
    status,
    error: title,
    message: apiError.message,
    code: apiError.code,
    requestId: req.requestId ?? null,
    details: apiError.details,
  });
};
