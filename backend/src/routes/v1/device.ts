import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { attendanceDevice, facilitySetup, punchLog } from "../../db/schema/index.js";
import { MAX_DEVICE_BATCH_SIZE } from "../../lib/attendance.js";
import { requireDeviceAuthentication } from "../../lib/deviceAuthentication.js";
import { preflightPunch, withPreflightLimit } from "../../lib/punchProcessor.js";
import { schedulePunchProcessing } from "../../lib/punchProcessing.js";
import { resolveFacilityTimezone } from "../../lib/facilityClock.js";
import { badRequest } from "../../lib/errors.js";

const router = Router();

const punchSchema = z.object({
  deviceEventId: z.string().trim().min(1).max(80),
  credentialType: z.enum(["FINGERPRINT", "CARD_QR", "CARD_BARCODE"]),
  credentialRef: z.string().min(1).max(120),
  punchedAt: z.string().datetime({ offset: true }),
  directionHint: z.enum(["IN", "OUT", "AUTO"]).optional().default("AUTO"),
  verifyMode: z.string().max(20).optional(),
});

router.use(requireDeviceAuthentication);

router.get("/ping", async (req, res, next) => {
  try {
    const device = req.device;
    if (!device) throw badRequest("Device authentication is required.", "DEVICE_AUTH_REQUIRED");

    const deviceTimeParam = req.query.deviceTime;
    let clockSkewSeconds: number | null = null;
    if (typeof deviceTimeParam === "string") {
      const parsedDeviceTime = z.string().datetime({ offset: true }).safeParse(deviceTimeParam);
      if (!parsedDeviceTime.success) {
        throw badRequest("deviceTime must be a valid timestamp.", "DEVICE_TIME_INVALID");
      }
      const deviceTime = new Date(parsedDeviceTime.data);
      clockSkewSeconds = Math.trunc((deviceTime.getTime() - Date.now()) / 1000);
      await db.update(attendanceDevice)
        .set({ lastClockSkewSeconds: clockSkewSeconds })
        .where(eq(attendanceDevice.id, device.id));
    }

    const [facility] = await db.select({ timezone: facilitySetup.timezone })
      .from(facilitySetup)
      .limit(1);
    res.json({
      data: {
        serverTime: new Date().toISOString(),
        timezone: facility?.timezone ?? await resolveFacilityTimezone(),
        timezoneResolved: Boolean(facility?.timezone),
        clockSkewSeconds,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/punches", async (req, res, next) => {
  try {
    const device = req.device;
    if (!device) throw badRequest("Device authentication is required.", "DEVICE_AUTH_REQUIRED");
    const body = z.object({ punches: z.array(z.unknown()).min(1).max(MAX_DEVICE_BATCH_SIZE) })
      .safeParse(req.body);
    if (!body.success) {
      throw badRequest("punches must contain between 1 and 500 items.", "DEVICE_BATCH_INVALID", {
        fieldErrors: body.error.flatten().fieldErrors,
      });
    }

    const prepared = await Promise.all(body.data.punches.map(async (candidate) => {
      const parsed = punchSchema.safeParse(candidate);
      if (!parsed.success) {
        return {
          candidate,
          item: null,
          preflight: null,
          receivedAt: null,
          punchedAt: null,
          deviceEventId:
            candidate && typeof candidate === "object" && "deviceEventId" in candidate &&
              typeof candidate.deviceEventId === "string"
              ? candidate.deviceEventId
              : null,
          result: "INVALID_PUNCH" as const,
        };
      }

      const item = parsed.data;
      const receivedAt = new Date();
      const punchedAt = new Date(item.punchedAt);
      const preflight = await withPreflightLimit(() => preflightPunch({
        credentialType: item.credentialType,
        credentialRef: item.credentialRef,
        punchedAt,
        receivedAt,
      }));
      return {
        candidate,
        item,
        preflight,
        receivedAt,
        punchedAt,
        deviceEventId: item.deviceEventId,
        result: preflight.outcome ?? "ACCEPTED",
      };
    }));

    const seenEventIds = new Set<string>();
    const inserts = prepared.flatMap((entry) => {
      if (
        !entry.item ||
        !entry.preflight ||
        !entry.receivedAt ||
        !entry.punchedAt ||
        seenEventIds.has(entry.item.deviceEventId)
      ) return [];
      seenEventIds.add(entry.item.deviceEventId);
      return [{
        deviceId: device.id,
        deviceEventId: entry.item.deviceEventId,
        credentialType: entry.item.credentialType,
        credentialRef: entry.item.credentialRef,
        staffId: entry.preflight.staffId,
        punchedAt: entry.punchedAt,
        receivedAt: entry.receivedAt,
        directionHint: entry.item.directionHint,
        verifyMode: entry.item.verifyMode ?? null,
        rawPayload: entry.candidate,
        result: entry.preflight.outcome ?? "RECEIVED",
      }];
    });

    const inserted = inserts.length === 0
      ? []
      : await db.insert(punchLog)
        .values(inserts)
        .onConflictDoNothing({
          target: [punchLog.deviceId, punchLog.deviceEventId],
        })
        .returning({
          id: punchLog.id,
          deviceEventId: punchLog.deviceEventId,
          staffId: punchLog.staffId,
        });
    const newEvents = new Map(inserted.map((entry) => [entry.deviceEventId, entry]));

    const respondedEventIds = new Set<string>();
    const jobs: Array<{ id: string; staffId: string | null }> = [];
    const results = prepared.map((entry) => {
      if (!entry.item || !entry.preflight) {
        return { deviceEventId: entry.deviceEventId, result: entry.result };
      }
      if (respondedEventIds.has(entry.item.deviceEventId)) {
        return { deviceEventId: entry.deviceEventId, result: "DUPLICATE" };
      }
      respondedEventIds.add(entry.item.deviceEventId);
      const saved = newEvents.get(entry.item.deviceEventId);
      if (!saved) return { deviceEventId: entry.deviceEventId, result: "DUPLICATE" };
      jobs.push({ id: saved.id, staffId: saved.staffId });
      return { deviceEventId: entry.deviceEventId, result: entry.result };
    });

    res.status(200).json({ data: { results } });
    for (const job of jobs) {
      schedulePunchProcessing(job.id, job.staffId, req.requestId);
    }
  } catch (error) {
    next(error);
  }
});

export default router;
