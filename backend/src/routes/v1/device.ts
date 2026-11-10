import { and, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { attendanceDevice, facilitySetup, punchLog, staff } from "../../db/schema/index.js";
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

const punchIdentity = (punch: {
  credentialType: string;
  credentialRef: string;
  punchedAt: Date | string;
  directionHint: string;
  verifyMode?: string | null;
}) => JSON.stringify([
  punch.credentialType,
  punch.credentialRef,
  new Date(punch.punchedAt).toISOString(),
  punch.directionHint,
  punch.verifyMode ?? null,
]);

const employeeVisibleForResult = (result: string) =>
  ["RECEIVED", "ACCEPTED", "CLOCK_IN", "CLOCK_OUT", "RECONCILIATION_REQUIRED"].includes(result);

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

    const batchIdentityById = new Map<string, string>();
    const conflictingIds = new Set<string>();
    for (const entry of prepared) {
      if (!entry.item || !entry.punchedAt) continue;
      const identity = punchIdentity({
        ...entry.item,
        punchedAt: entry.punchedAt,
        verifyMode: entry.item.verifyMode ?? null,
      });
      const priorIdentity = batchIdentityById.get(entry.item.deviceEventId);
      if (priorIdentity && priorIdentity !== identity) {
        conflictingIds.add(entry.item.deviceEventId);
      } else {
        batchIdentityById.set(entry.item.deviceEventId, identity);
      }
    }

    const eventIds = [...batchIdentityById.keys()];
    const existing = eventIds.length === 0
      ? []
      : await db.select({
        id: punchLog.id,
        deviceEventId: punchLog.deviceEventId,
        credentialType: punchLog.credentialType,
        credentialRef: punchLog.credentialRef,
        punchedAt: punchLog.punchedAt,
        directionHint: punchLog.directionHint,
        verifyMode: punchLog.verifyMode,
        staffId: punchLog.staffId,
        result: punchLog.result,
        processed: punchLog.processed,
      }).from(punchLog).where(and(
        eq(punchLog.deviceId, device.id),
        inArray(punchLog.deviceEventId, eventIds),
      ));
    const existingByEventId = new Map(existing.map((event) => [event.deviceEventId, event]));
    for (const event of existing) {
      if (batchIdentityById.get(event.deviceEventId) !== punchIdentity(event)) {
        conflictingIds.add(event.deviceEventId);
      }
    }

    const seenEventIds = new Set<string>();
    const inserts = prepared.flatMap((entry) => {
      if (
        !entry.item ||
        !entry.preflight ||
        !entry.receivedAt ||
        !entry.punchedAt ||
        conflictingIds.has(entry.item.deviceEventId) ||
        seenEventIds.has(entry.item.deviceEventId) ||
        existingByEventId.has(entry.item.deviceEventId)
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
          result: punchLog.result,
          processed: punchLog.processed,
          credentialType: punchLog.credentialType,
          credentialRef: punchLog.credentialRef,
          punchedAt: punchLog.punchedAt,
          directionHint: punchLog.directionHint,
          verifyMode: punchLog.verifyMode,
        });
    const insertedByEventId = new Map(inserted.map((entry) => [entry.deviceEventId, entry]));
    const racedIds = eventIds.filter((eventId) =>
      !insertedByEventId.has(eventId) &&
      !existingByEventId.has(eventId) &&
      !conflictingIds.has(eventId),
    );
    if (racedIds.length > 0) {
      const raced = await db.select({
        id: punchLog.id,
        deviceEventId: punchLog.deviceEventId,
        credentialType: punchLog.credentialType,
        credentialRef: punchLog.credentialRef,
        punchedAt: punchLog.punchedAt,
        directionHint: punchLog.directionHint,
        verifyMode: punchLog.verifyMode,
        staffId: punchLog.staffId,
        result: punchLog.result,
        processed: punchLog.processed,
      }).from(punchLog).where(and(
        eq(punchLog.deviceId, device.id),
        inArray(punchLog.deviceEventId, racedIds),
      ));
      for (const event of raced) {
        if (batchIdentityById.get(event.deviceEventId) !== punchIdentity(event)) {
          conflictingIds.add(event.deviceEventId);
        } else {
          existingByEventId.set(event.deviceEventId, event);
        }
      }
    }

    const jobsById = new Map<string, { id: string; staffId: string | null }>();
    for (const event of inserted) {
      jobsById.set(event.id, { id: event.id, staffId: event.staffId });
    }
    for (const event of existingByEventId.values()) {
      if (!event.processed) jobsById.set(event.id, { id: event.id, staffId: event.staffId });
    }
    for (const job of jobsById.values()) {
      schedulePunchProcessing(job.id, job.staffId, req.requestId);
    }

    const eventForResponse = new Map(existingByEventId);
    for (const event of inserted) eventForResponse.set(event.deviceEventId, event);
    const acceptedStaffIds = [...new Set([...eventForResponse.values()]
      .filter((event) => employeeVisibleForResult(event.result) && event.staffId)
      .map((event) => event.staffId as string))];
    let employees: Array<{
      id: string;
      employeeId: string;
      firstName: string;
      lastName: string;
      imageUrl: string | null;
    }> = [];
    if (acceptedStaffIds.length > 0) {
      try {
        employees = await db.select({
        id: staff.id,
        employeeId: staff.employeeId,
        firstName: staff.firstName,
        lastName: staff.lastName,
        imageUrl: staff.imageUrl,
        }).from(staff).where(inArray(staff.id, acceptedStaffIds));
      } catch (error) {
        console.error("Could not load employee details for accepted attendance punches.", error);
      }
    }
    const employeeById = new Map(employees.map((employee) => [employee.id, {
      employeeId: employee.employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      imageUrl: employee.imageUrl,
    }]));

    const respondedEventIds = new Set<string>();
    const results = prepared.map((entry) => {
      if (!entry.item || !entry.preflight) {
        return { deviceEventId: entry.deviceEventId, result: entry.result };
      }
      const eventId = entry.item.deviceEventId;
      if (conflictingIds.has(eventId)) {
        return { deviceEventId: eventId, result: "EVENT_ID_CONFLICT" };
      }
      const saved = insertedByEventId.get(eventId) ?? existingByEventId.get(eventId);
      if (!saved) return { deviceEventId: eventId, result: "DUPLICATE" };
      const originalResult = saved.result;
      const employee = employeeVisibleForResult(originalResult) && saved.staffId
        ? employeeById.get(saved.staffId)
        : undefined;
      const isReplay = respondedEventIds.has(eventId) || existingByEventId.has(eventId);
      respondedEventIds.add(eventId);
      return isReplay
        ? { deviceEventId: eventId, result: "DUPLICATE", originalResult, employee }
        : {
          deviceEventId: eventId,
          result: entry.result,
          ...(entry.result === "ACCEPTED" ? { employee } : {}),
        };
    });

    res.status(200).json({ data: { results } });
  } catch (error) {
    next(error);
  }
});

export default router;
