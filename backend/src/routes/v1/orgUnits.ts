import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { Router } from "express";

import { db } from "../../db/index.js";
import { orgUnit } from "../../db/schema/index.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["name", "code", "unitType", "createdAt"],
      filterable: ["unitType", "active", "isClinical", "parentId"],
      defaultSort: "name",
    });

    const filters = [];
    if (query.q) {
      filters.push(ilike(orgUnit.name, `%${query.q}%`));
    }

    for (const filter of query.filters) {
      if (filter.field === "unitType" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.unitType, filter.value));
      }
      if (filter.field === "parentId" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.parentId, filter.value));
      }
      if (filter.field === "active" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.active, filter.value === "true"));
      }
      if (filter.field === "isClinical" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.isClinical, filter.value === "true"));
      }
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const firstSort = query.sort[0] ?? { field: "name", descending: false };

    const orderBy =
      firstSort.field === "code"
        ? firstSort.descending
          ? desc(orgUnit.code)
          : asc(orgUnit.code)
        : firstSort.field === "unitType"
          ? firstSort.descending
            ? desc(orgUnit.unitType)
            : asc(orgUnit.unitType)
          : firstSort.descending
            ? desc(orgUnit.name)
            : asc(orgUnit.name);

    const [records, totalRows] = await Promise.all([
      db.select().from(orgUnit).where(where).orderBy(orderBy).limit(query.limit).offset(query.offset),
      db.select({ total: count() }).from(orgUnit).where(where),
    ]);

    res.json(toPageResponse(records, query, Number(totalRows[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

export default router;
