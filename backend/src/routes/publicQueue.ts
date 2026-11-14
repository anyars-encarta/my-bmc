import { and, asc, eq, inArray } from "drizzle-orm";
import { Router } from "express";

import { db } from "../db/index.js";
import { orgUnit, queueTicket } from "../db/schema/index.js";
import { validationError } from "../lib/errors.js";

const router = Router();

const queueForUnitCode = async (unitCode: string) => {
  const [unit] = await db.select({ id: orgUnit.id, name: orgUnit.name })
    .from(orgUnit)
    .where(and(eq(orgUnit.code, unitCode), eq(orgUnit.isClinical, true), eq(orgUnit.active, true)))
    .limit(1);
  if (!unit) throw validationError("Choose a valid clinic.", "QUEUE_UNIT_NOT_FOUND");
  const tickets = await db.select({
    ticketNo: queueTicket.ticketNo,
    stage: queueTicket.stage,
    status: queueTicket.status,
    issuedAt: queueTicket.issuedAt,
  }).from(queueTicket)
    .where(and(
      eq(queueTicket.orgUnitId, unit.id),
      inArray(queueTicket.status, ["CALLED", "SERVING"]),
    ))
    .orderBy(asc(queueTicket.calledAt), asc(queueTicket.issuedAt))
    .limit(50);
  return { unitName: unit.name, tickets };
};

router.get("/queue-units", async (_req, res, next) => {
  try {
    const units = await db.select({ code: orgUnit.code, name: orgUnit.name })
      .from(orgUnit)
      .where(and(eq(orgUnit.isClinical, true), eq(orgUnit.active, true)))
      .orderBy(asc(orgUnit.name));
    res.json({ data: units });
  } catch (error) {
    next(error);
  }
});

router.get("/queue", async (req, res, next) => {
  try {
    const unitCode = typeof req.query.unitCode === "string" ? req.query.unitCode.trim() : "";
    if (!unitCode) throw validationError("Choose a clinic.", "QUEUE_UNIT_REQUIRED");
    res.json({ data: await queueForUnitCode(unitCode) });
  } catch (error) {
    next(error);
  }
});

router.get("/queue/stream", async (req, res, next) => {
  try {
    const unitCode = typeof req.query.unitCode === "string" ? req.query.unitCode.trim() : "";
    if (!unitCode) throw validationError("Choose a clinic.", "QUEUE_UNIT_REQUIRED");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    req.on("close", () => {
      active = false;
      if (timer) clearInterval(timer);
    });
    const send = async () => {
      if (!active) return;
      try {
        res.write(`data: ${JSON.stringify(await queueForUnitCode(unitCode))}\n\n`);
      } catch (error) {
        console.error("Public queue stream update failed.", error);
        res.write("event: error\ndata: {}\n\n");
      }
    };
    await send();
    if (active) timer = setInterval(() => void send(), 3000);
  } catch (error) {
    next(error);
  }
});

export default router;
