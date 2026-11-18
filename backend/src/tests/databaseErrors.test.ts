import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { databaseErrorInfo } from "../lib/databaseErrors.js";

describe("database error inspection", () => {
  test("finds SQLSTATE information through nested Drizzle and driver causes", () => {
    const error = {
      cause: {
        cause: {
          code: "23514",
          constraint: "audit_log_action_check",
          message: "constraint failed",
        },
      },
    };

    assert.deepEqual(databaseErrorInfo(error), {
      sqlState: "23514",
      constraint: "audit_log_action_check",
      message: "constraint failed",
    });
  });

  test("stops when an error cause graph contains a cycle", () => {
    const error: { code?: string; cause?: unknown } = {};
    error.cause = error;
    assert.equal(databaseErrorInfo(error), null);
  });
});
