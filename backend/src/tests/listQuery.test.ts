import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

import { parseListQuery } from "../lib/listQuery.js";

test("list query ignores route context parameters without treating them as filters", () => {
  const req: Pick<Request, "query"> = {
    query: {
      page: "2",
      limit: "10",
      staffId: "staff-record-id",
    },
  };
  const query = parseListQuery(
    req,
    {
      sortable: ["name"],
      filterable: [],
      defaultSort: "name",
      ignoredQueryParams: ["staffId"],
    },
  );

  assert.equal(query.page, 2);
  assert.equal(query.limit, 10);
  assert.deepEqual(query.filters, []);
});
