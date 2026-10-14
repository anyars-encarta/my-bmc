import { and, count, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { Router } from "express";

import { db } from "../../db/index.js";
import { auditLog } from "../../db/schema/index.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();

router.get(
  "/",
  requireAnyRole(["SUPER_ADMIN", "AUDITOR", "DPO"]),
  async (req, res, next) => {
    try {
      const query = parseListQuery(req, {
        sortable: ["occurredAt", "action", "entityType"],
        filterable: ["entityType", "actorUserId", "action", "patientId", "occurredAt"],
        defaultSort: "-occurredAt",
      });

      const whereParts = [];
      if (query.q) {
        whereParts.push(ilike(auditLog.entityType, `%${query.q}%`));
      }

      for (const filter of query.filters) {
        if (filter.field === "entityType" && filter.operator === "eq" && typeof filter.value === "string") {
          whereParts.push(eq(auditLog.entityType, filter.value));
        }

        if (filter.field === "actorUserId" && filter.operator === "eq" && typeof filter.value === "string") {
          whereParts.push(eq(auditLog.actorUserId, filter.value));
        }

        if (filter.field === "action" && filter.operator === "eq" && typeof filter.value === "string") {
          whereParts.push(eq(auditLog.action, filter.value));
        }

        if (filter.field === "patientId" && filter.operator === "eq" && typeof filter.value === "string") {
          whereParts.push(eq(auditLog.patientId, filter.value));
        }

        if (filter.field === "occurredAt" && filter.operator === "gte" && typeof filter.value === "string") {
          whereParts.push(gte(auditLog.occurredAt, new Date(filter.value)));
        }

        if (filter.field === "occurredAt" && filter.operator === "lte" && typeof filter.value === "string") {
          whereParts.push(lte(auditLog.occurredAt, new Date(filter.value)));
        }
      }

      const where = whereParts.length > 0 ? and(...whereParts) : undefined;
      const [records, totalRows] = await Promise.all([
        db
          .select()
          .from(auditLog)
          .where(where)
          .orderBy(desc(auditLog.occurredAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ total: count() }).from(auditLog).where(where),
      ]);

      res.json(toPageResponse(records, query, Number(totalRows[0]?.total ?? 0)));
    } catch (error) {
      next(error);
    }
  },
);

export default router;
