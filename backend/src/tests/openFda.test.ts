import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildOpenFdaSearchQuery,
  mapOpenFdaNdcResults,
  parseOpenFdaTimeoutMs,
  searchOpenFdaMedications,
} from "../lib/open-fda.js";
import { ApiError } from "../lib/errors.js";

describe("OpenFDA medication search helpers", () => {
  test("builds a field-scoped prefix search without accepting raw query syntax", () => {
    const query = buildOpenFdaSearchQuery('amoxicillin" OR *:*');
    assert.ok(query);
    assert.match(query, /generic_name:amoxicillin\*/);
    assert.doesNotMatch(query, /:\*/);
  });

  test("bounds API timeouts and defaults to eight seconds", () => {
    assert.equal(parseOpenFdaTimeoutMs(undefined), 8_000);
    assert.equal(parseOpenFdaTimeoutMs("100000"), 15_000);
  });

  test("maps and deduplicates FDA NDC products with label, route, and ingredient strength", () => {
    const results = mapOpenFdaNdcResults([
      {
        product_ndc: "12345-678-90",
        brand_name: "Example",
        generic_name: "example drug",
        dosage_form: "TABLET",
        labeler_name: "Example Labs",
        route: ["ORAL"],
        active_ingredients: [{ name: "example drug", strength: "10 mg/1" }],
      },
      {
        product_ndc: "12345-678-90",
        brand_name: "Duplicate",
        generic_name: "example drug",
      },
      { product_ndc: "12345-000-00", brand_name: "", generic_name: "" },
    ]);

    assert.deepEqual(results, [{
      id: "12345-678-90",
      name: "Example",
      genericName: "example drug",
      productNdc: "12345-678-90",
      dosageForm: "TABLET",
      labelerName: "Example Labs",
      route: "ORAL",
      dose: "10 mg/1",
    }]);
  });

  test("keeps the timeout active while consuming the upstream response body", async () => {
    const originalFetch = globalThis.fetch;
    const originalTimeout = process.env.OPEN_FDA_API_TIMEOUT_MS;
    process.env.OPEN_FDA_API_TIMEOUT_MS = "3000";
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, "json", {
        value: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      });
      return response;
    }) as typeof fetch;

    try {
      await assert.rejects(searchOpenFdaMedications("example", 1), (error: unknown) =>
        error instanceof ApiError && error.code === "OPEN_FDA_TIMEOUT");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTimeout === undefined) delete process.env.OPEN_FDA_API_TIMEOUT_MS;
      else process.env.OPEN_FDA_API_TIMEOUT_MS = originalTimeout;
    }
  });
});
