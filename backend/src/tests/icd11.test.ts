import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findIcd11Code, mapIcd11Entities, parseBoundedTimeoutMs, sanitizeIcdTitle, searchIcd11 } from "../lib/icd11.js";

describe("ICD-11 search mapping", () => {
  test("decodes and strips markup from WHO titles", () => {
    assert.equal(sanitizeIcdTitle("  <em>Heart</em>&amp; vessel  "), "Heart& vessel");
  });

  test("caps excessive timeout settings at the configured maximum", () => {
    assert.equal(parseBoundedTimeoutMs("100000"), 30_000);
    assert.equal(parseBoundedTimeoutMs(undefined), 8_000);
  });

  test("maps only results with a code and sanitized title", () => {
    assert.deepEqual(mapIcd11Entities([
      { id: "https://id.who.int/icd/entity/1", theCode: "1A00", title: { "@value": "Condition <b>name</b>" } },
      { theCode: "1A01", title: "" },
      { theCode: "", title: "Missing code" },
    ]), [{
      id: "https://id.who.int/icd/entity/1",
      code: "1A00",
      description: "Condition name",
      codeSystem: "ICD-11",
    }]);
  });

  test("authenticates and searches the configured WHO release", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = {
      clientId: process.env.ICD_API_CLIENT_ID,
      clientSecret: process.env.ICD_API_CLIENT_SECRET,
      releaseVersion: process.env.ICD_API_RELEASE_VERSION,
      timeout: process.env.ICD_API_TIMEOUT_MS,
    };
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    process.env.ICD_API_CLIENT_ID = "test-client";
    process.env.ICD_API_CLIENT_SECRET = "test-secret";
    process.env.ICD_API_RELEASE_VERSION = "2025";
    process.env.ICD_API_TIMEOUT_MS = "8000";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://icdaccessmanagement.who.int/connect/token") {
        return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({
        destinationEntities: [{ theCode: "1A00", title: "Test diagnosis" }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const results = await searchIcd11("test", 4, "en");
      assert.equal(results[0]?.code, "1A00");
      assert.equal(requests.length, 2);
      assert.match(requests[1]?.url ?? "", /\/icd\/release\/11\/2025\/mms\/search/);
      assert.equal(new Headers(requests[1]?.init?.headers).get("Authorization"), "Bearer test-token");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEnv.clientId === undefined) delete process.env.ICD_API_CLIENT_ID;
      else process.env.ICD_API_CLIENT_ID = originalEnv.clientId;
      if (originalEnv.clientSecret === undefined) delete process.env.ICD_API_CLIENT_SECRET;
      else process.env.ICD_API_CLIENT_SECRET = originalEnv.clientSecret;
      if (originalEnv.releaseVersion === undefined) delete process.env.ICD_API_RELEASE_VERSION;
      else process.env.ICD_API_RELEASE_VERSION = originalEnv.releaseVersion;
      if (originalEnv.timeout === undefined) delete process.env.ICD_API_TIMEOUT_MS;
      else process.env.ICD_API_TIMEOUT_MS = originalEnv.timeout;
    }
  });

  test("checks exact codes with WHO codeinfo before resolving their display title", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = {
      clientId: process.env.ICD_API_CLIENT_ID,
      clientSecret: process.env.ICD_API_CLIENT_SECRET,
      releaseVersion: process.env.ICD_API_RELEASE_VERSION,
      timeout: process.env.ICD_API_TIMEOUT_MS,
    };
    const urls: string[] = [];
    process.env.ICD_API_CLIENT_ID = "test-client";
    process.env.ICD_API_CLIENT_SECRET = "test-secret";
    process.env.ICD_API_RELEASE_VERSION = "2021-05";
    process.env.ICD_API_TIMEOUT_MS = "8000";
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://icdaccessmanagement.who.int/connect/token") {
        return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("/mms/codeinfo/")) {
        return new Response(JSON.stringify({ code: "1A00" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        destinationEntities: [{ theCode: "1A00", title: "Test diagnosis" }],
      }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await findIcd11Code("1A00");
      assert.equal(result?.description, "Test diagnosis");
      assert.ok(urls.some((url) => url.includes("/mms/codeinfo/1A00")));
      assert.ok(urls.some((url) => url.includes("/mms/search")));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEnv.clientId === undefined) delete process.env.ICD_API_CLIENT_ID;
      else process.env.ICD_API_CLIENT_ID = originalEnv.clientId;
      if (originalEnv.clientSecret === undefined) delete process.env.ICD_API_CLIENT_SECRET;
      else process.env.ICD_API_CLIENT_SECRET = originalEnv.clientSecret;
      if (originalEnv.releaseVersion === undefined) delete process.env.ICD_API_RELEASE_VERSION;
      else process.env.ICD_API_RELEASE_VERSION = originalEnv.releaseVersion;
      if (originalEnv.timeout === undefined) delete process.env.ICD_API_TIMEOUT_MS;
      else process.env.ICD_API_TIMEOUT_MS = originalEnv.timeout;
    }
  });
});
