import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";

import { db } from "../db/index.js";
import { orgUnit, queueTicket } from "../db/schema/index.js";
import { validationError } from "../lib/errors.js";

const router = Router();
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_CONCURRENT_STREAMS = 100;
const MAX_RATE_LIMIT_KEYS = 10_000;
const requestCounts = new Map<string, { startedAt: number; count: number }>();
let activeStreams = 0;
let lastRateLimitCleanup = 0;

const publicQueueAdmissionControl = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  if (now - lastRateLimitCleanup >= REQUEST_WINDOW_MS || requestCounts.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [key, bucket] of requestCounts) {
      if (now - bucket.startedAt >= REQUEST_WINDOW_MS) requestCounts.delete(key);
    }
    lastRateLimitCleanup = now;
  }
  const clientKey = req.ip || req.socket.remoteAddress || "unknown";
  const bucket = requestCounts.get(clientKey);
  if (!bucket && requestCounts.size >= MAX_RATE_LIMIT_KEYS) {
    res.status(429).json({ code: "PUBLIC_QUEUE_RATE_LIMITED", message: "Too many queue requests. Try again shortly." });
    return;
  }
  if (bucket && now - bucket.startedAt < REQUEST_WINDOW_MS && bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({ code: "PUBLIC_QUEUE_RATE_LIMITED", message: "Too many queue requests. Try again shortly." });
    return;
  }
  if (!bucket || now - bucket.startedAt >= REQUEST_WINDOW_MS) {
    requestCounts.set(clientKey, { startedAt: now, count: 1 });
  } else {
    bucket.count += 1;
  }
  if (req.method !== "GET" || !/^\/queue\/stream\/?$/i.test(req.path)) {
    next();
    return;
  }
  if (activeStreams >= MAX_CONCURRENT_STREAMS) {
    res.status(503).json({ code: "PUBLIC_QUEUE_STREAM_LIMIT", message: "The public queue is at capacity. Try again shortly." });
    return;
  }

  activeStreams += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeStreams -= 1;
  };
  res.once("close", release);
  res.once("finish", release);
  next();
};

router.use(publicQueueAdmissionControl);

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
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let sending = false;
    res.on("close", () => {
      active = false;
      if (timer) clearInterval(timer);
    });
    const initialQueue = await queueForUnitCode(unitCode);
    if (!active) return;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    const send = async (initial?: typeof initialQueue) => {
      if (!active || sending) return;
      sending = true;
      try {
        const queue = initial ?? await queueForUnitCode(unitCode);
        if (active) res.write(`data: ${JSON.stringify(queue)}\n\n`);
      } catch (error) {
        console.error("Public queue stream update failed.", error);
        if (active) res.write("event: error\ndata: {}\n\n");
      } finally {
        sending = false;
      }
    };
    if (!active) return;
    await send(initialQueue);
    if (active) timer = setInterval(() => void send(), 3000);
  } catch (error) {
    next(error);
  }
});

export default router;
