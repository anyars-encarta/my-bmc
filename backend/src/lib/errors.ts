export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  type?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { details?: unknown; type?: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (options && "details" in options) {
      this.details = options.details;
    }
    if (options?.type !== undefined) {
      this.type = options.type;
    }
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: unknown) =>
  new ApiError(400, code, message, { details, type: "https://hams.example/problems/bad-request" });

export const unauthorized = (message: string, code = "UNAUTHORIZED", details?: unknown) =>
  new ApiError(401, code, message, { details, type: "https://hams.example/problems/unauthorized" });

export const forbidden = (message: string, code = "FORBIDDEN", details?: unknown) =>
  new ApiError(403, code, message, { details, type: "https://hams.example/problems/forbidden" });

export const notFound = (message: string, code = "NOT_FOUND", details?: unknown) =>
  new ApiError(404, code, message, { details, type: "https://hams.example/problems/not-found" });

export const conflict = (message: string, code = "CONFLICT", details?: unknown) =>
  new ApiError(409, code, message, { details, type: "https://hams.example/problems/conflict" });

export const validationError = (message: string, code: string, details?: unknown) =>
  new ApiError(422, code, message, { details, type: "https://hams.example/problems/validation-error" });
