/** Finds a SQLSTATE and constraint in a database error, including wrapped driver errors. */
export const databaseErrorInfo = (error: unknown) => {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        sqlState: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : "",
        message: typeof candidate.message === "string" ? candidate.message : "",
      };
    }
    current = candidate.cause;
  }
  return null;
};
