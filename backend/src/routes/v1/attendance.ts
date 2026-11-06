import { randomBytes } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  attendanceDevice,
  consent,
  staff,
  staffCredential,
} from "../../db/schema/index.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { hashDeviceKey } from "../../lib/deviceAuthentication.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();
const HR_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"] as const;

const deviceCreateSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(100),
  deviceType: z.enum(["FINGERPRINT_TERMINAL", "QR_SCANNER", "BARCODE_SCANNER", "KIOSK"]),
  vendor: z.string().trim().max(50).nullable().optional(),
  model: z.string().trim().max(50).nullable().optional(),
  serialNumber: z.string().trim().max(80).nullable().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
});

const credentialIssueSchema = z.object({
  credentialType: z.enum(["CARD_QR", "CARD_BARCODE"]),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).refine(
  (value) => !value.expiresAt || new Date(value.expiresAt).getTime() > Date.now(),
  { path: ["expiresAt"], message: "Expiry must be in the future." },
);

const requireUuid = (value: string | string[] | undefined, field: string) => {
  const parsed = z.string().uuid().safeParse(Array.isArray(value) ? value[0] : value);
  if (!parsed.success) {
    throw validationError(`${field} must be a valid identifier.`, "VALIDATION_FAILED", {
      fieldErrors: { [field]: ["A valid identifier is required."] },
    });
  }
  return parsed.data;
};

const generateDeviceKey = () => randomBytes(32).toString("base64url");
const generateCardToken = () => randomBytes(32).toString("base64url");

router.get("/devices", requireAnyRole(HR_ROLES), async (_req, res, next) => {
  try {
    const devices = await db.select({
      id: attendanceDevice.id,
      code: attendanceDevice.code,
      name: attendanceDevice.name,
      deviceType: attendanceDevice.deviceType,
      vendor: attendanceDevice.vendor,
      model: attendanceDevice.model,
      serialNumber: attendanceDevice.serialNumber,
      orgUnitId: attendanceDevice.orgUnitId,
      status: attendanceDevice.status,
      lastSeenAt: attendanceDevice.lastSeenAt,
      lastClockSkewSeconds: attendanceDevice.lastClockSkewSeconds,
    }).from(attendanceDevice).orderBy(attendanceDevice.name);
    res.json({ data: devices });
  } catch (error) {
    next(error);
  }
});

router.post("/devices", requireAnyRole(HR_ROLES), async (req, res, next) => {
  try {
    const parsed = deviceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const apiKey = generateDeviceKey();
    const [created] = await db.insert(attendanceDevice).values({
      ...parsed.data,
      apiKeyHash: await hashDeviceKey(apiKey),
      status: "ACTIVE",
    }).returning({
      id: attendanceDevice.id,
      code: attendanceDevice.code,
      name: attendanceDevice.name,
      deviceType: attendanceDevice.deviceType,
      status: attendanceDevice.status,
    });
    if (!created) throw new Error("The attendance device could not be registered.");
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      data: {
        ...created,
        apiKey,
        keyNotice: "Copy this device key now. It cannot be retrieved again.",
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/devices/:id", requireAnyRole(HR_ROLES), async (req, res, next) => {
  try {
    const id = requireUuid(req.params.id, "id");
    const parsed = deviceCreateSchema
      .pick({
        name: true,
        vendor: true,
        model: true,
        serialNumber: true,
        orgUnitId: true,
      })
      .partial()
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(req.body);
    if (!parsed.success) {
      throw validationError("At least one valid device field is required.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [updated] = await db.update(attendanceDevice)
      .set(parsed.data)
      .where(eq(attendanceDevice.id, id))
      .returning({
        id: attendanceDevice.id,
        code: attendanceDevice.code,
        name: attendanceDevice.name,
        deviceType: attendanceDevice.deviceType,
        vendor: attendanceDevice.vendor,
        model: attendanceDevice.model,
        serialNumber: attendanceDevice.serialNumber,
        orgUnitId: attendanceDevice.orgUnitId,
        status: attendanceDevice.status,
      });
    if (!updated) throw notFound("Attendance device not found.", "DEVICE_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/devices/:id/rotate-key",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, "id");
      const [device] = await db.select({ id: attendanceDevice.id, status: attendanceDevice.status })
        .from(attendanceDevice)
        .where(eq(attendanceDevice.id, id))
        .limit(1);
      if (!device) throw notFound("Attendance device not found.", "DEVICE_NOT_FOUND");
      if (device.status !== "ACTIVE") {
        throw conflict("Disabled devices cannot rotate keys.", "DEVICE_DISABLED");
      }

      const apiKey = generateDeviceKey();
      await db.update(attendanceDevice)
        .set({ apiKeyHash: await hashDeviceKey(apiKey) })
        .where(eq(attendanceDevice.id, id));
      res.setHeader("Cache-Control", "no-store");
      res.json({
        data: {
          apiKey,
          keyNotice: "Copy this device key now. It cannot be retrieved again.",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/devices/:id/disable",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, "id");
      const [disabled] = await db.update(attendanceDevice)
        .set({ status: "DISABLED" })
        .where(eq(attendanceDevice.id, id))
        .returning({
          id: attendanceDevice.id,
          code: attendanceDevice.code,
          status: attendanceDevice.status,
        });
      if (!disabled) throw notFound("Attendance device not found.", "DEVICE_NOT_FOUND");
      res.json({ data: disabled });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/devices/:id/enable",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const id = requireUuid(req.params.id, "id");
      const [enabled] = await db.update(attendanceDevice)
        .set({
          status: "ACTIVE",
          lastSeenAt: null,
        })
        .where(eq(attendanceDevice.id, id))
        .returning({
          id: attendanceDevice.id,
          code: attendanceDevice.code,
          status: attendanceDevice.status,
          lastSeenAt: attendanceDevice.lastSeenAt,
        });
      if (!enabled) throw notFound("Attendance device not found.", "DEVICE_NOT_FOUND");
      res.json({ data: enabled });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/staff/:id/credentials",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const staffId = requireUuid(req.params.id, "id");
      const credentials = await db.select({
        id: staffCredential.id,
        credentialType: staffCredential.credentialType,
        cardVersion: staffCredential.cardVersion,
        status: staffCredential.status,
        issuedAt: staffCredential.issuedAt,
        expiresAt: staffCredential.expiresAt,
        revokedAt: staffCredential.revokedAt,
        revokedReason: staffCredential.revokedReason,
      }).from(staffCredential)
        .where(eq(staffCredential.staffId, staffId))
        .orderBy(desc(staffCredential.issuedAt));
      res.json({ data: credentials });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/staff/:id/credentials",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const staffId = requireUuid(req.params.id, "id");
      const parsed = credentialIssueSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed.", "VALIDATION_FAILED", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      const [person] = await db.select({ id: staff.id, status: staff.status })
        .from(staff)
        .where(eq(staff.id, staffId))
        .limit(1);
      if (!person) throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
      if (person.status !== "active") {
        throw conflict("Credentials cannot be issued to inactive staff.", "STAFF_INACTIVE");
      }

      const existing = await db.select({ cardVersion: staffCredential.cardVersion })
        .from(staffCredential)
        .where(and(
          eq(staffCredential.staffId, staffId),
          eq(staffCredential.credentialType, parsed.data.credentialType),
        ));
      const cardVersion = Math.max(0, ...existing.map((item) => item.cardVersion)) + 1;
      const credentialRef = generateCardToken();
      const [created] = await db.insert(staffCredential).values({
        staffId,
        credentialType: parsed.data.credentialType,
        credentialRef,
        cardVersion,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      }).returning({
        id: staffCredential.id,
        credentialType: staffCredential.credentialType,
        cardVersion: staffCredential.cardVersion,
        status: staffCredential.status,
        issuedAt: staffCredential.issuedAt,
        expiresAt: staffCredential.expiresAt,
      });
      if (!created) throw new Error("The staff card could not be issued.");
      try {
        await db.update(staffCredential)
          .set({
            status: "REVOKED",
            revokedAt: new Date(),
            revokedReason: "Superseded by a reissued card.",
          })
          .where(and(
            eq(staffCredential.staffId, staffId),
            eq(staffCredential.credentialType, parsed.data.credentialType),
            eq(staffCredential.status, "ACTIVE"),
            ne(staffCredential.id, created.id),
          ));
      } catch (error) {
        try {
          const [revoked] = await db.update(staffCredential)
            .set({
              status: "REVOKED",
              revokedAt: new Date(),
              revokedReason: "Card reissue could not revoke the previous credential.",
            })
            .where(and(
              eq(staffCredential.id, created.id),
              eq(staffCredential.status, "ACTIVE"),
            ))
            .returning({ id: staffCredential.id });
          if (!revoked) throw new Error("The new card could not be revoked after a failed reissue.");
        } catch (compensationError) {
          throw new AggregateError(
            [error, compensationError],
            "Card reissue failed and its new credential could not be safely revoked.",
          );
        }
        throw error;
      }

      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({
        data: {
          ...created,
          token: credentialRef,
          printFormat: parsed.data.credentialType === "CARD_QR" ? "QR" : "BARCODE",
          tokenNotice: "Copy or print this credential now. It cannot be retrieved again.",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/staff/:id/credentials/:credentialId/revoke",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const staffId = requireUuid(req.params.id, "id");
      const credentialId = requireUuid(req.params.credentialId, "credentialId");
      const body = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
      if (!body.success) {
        throw validationError("A revocation reason is required.", "VALIDATION_FAILED", {
          fieldErrors: body.error.flatten().fieldErrors,
        });
      }
      const [revoked] = await db.update(staffCredential)
        .set({
          status: "REVOKED",
          revokedAt: new Date(),
          revokedReason: body.data.reason,
        })
        .where(and(
          eq(staffCredential.id, credentialId),
          eq(staffCredential.staffId, staffId),
          eq(staffCredential.status, "ACTIVE"),
        ))
        .returning({
          id: staffCredential.id,
          status: staffCredential.status,
          revokedAt: staffCredential.revokedAt,
        });
      if (!revoked) throw notFound("Active staff credential not found.", "CREDENTIAL_NOT_FOUND");
      res.json({ data: revoked });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/staff/:id/fingerprint-enrolment",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const staffId = requireUuid(req.params.id, "id");
      const parsed = z.object({
        note: z.string().trim().max(500).nullable().optional(),
      }).safeParse(req.body ?? {});
      if (!parsed.success) {
        throw validationError("Validation failed.", "VALIDATION_FAILED", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      const [person] = await db.select({
        id: staff.id,
        badgeNumber: staff.badgeNumber,
        status: staff.status,
      }).from(staff).where(eq(staff.id, staffId)).limit(1);
      if (!person) throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
      if (person.status !== "active") {
        throw conflict("Inactive staff cannot be enrolled for fingerprint attendance.", "STAFF_INACTIVE");
      }
      if (!person.badgeNumber) {
        throw conflict("A fingerprint-terminal badge PIN must be assigned first.", "BADGE_PIN_REQUIRED");
      }
      const [latestConsent] = await db.select({
        status: consent.status,
        withdrawnAt: consent.withdrawnAt,
      }).from(consent)
        .where(and(
          eq(consent.subjectType, "STAFF"),
          eq(consent.subjectId, staffId),
          eq(consent.consentType, "BIOMETRIC_ATTENDANCE"),
        ))
        .orderBy(desc(consent.createdAt))
        .limit(1);
      if (latestConsent?.status !== "GRANTED" || latestConsent.withdrawnAt) {
        throw conflict(
          "Current BIOMETRIC_ATTENDANCE consent is required before fingerprint enrolment.",
          "CONSENT_REQUIRED",
        );
      }

      const [existing] = await db.select({ id: staffCredential.id })
        .from(staffCredential)
        .where(and(
          eq(staffCredential.staffId, staffId),
          eq(staffCredential.credentialType, "FINGERPRINT"),
          eq(staffCredential.status, "ACTIVE"),
        ))
        .limit(1);
      const enrollment = existing
        ? await db.update(staffCredential)
          .set({
            issuedAt: new Date(),
            credentialRef: person.badgeNumber,
            enrollmentNote: parsed.data.note ?? null,
          })
          .where(eq(staffCredential.id, existing.id))
          .returning({
            id: staffCredential.id,
            credentialType: staffCredential.credentialType,
            status: staffCredential.status,
            issuedAt: staffCredential.issuedAt,
          })
        : await db.insert(staffCredential).values({
          staffId,
          credentialType: "FINGERPRINT",
          credentialRef: person.badgeNumber,
          enrollmentNote: parsed.data.note ?? null,
        }).returning({
          id: staffCredential.id,
          credentialType: staffCredential.credentialType,
          status: staffCredential.status,
          issuedAt: staffCredential.issuedAt,
        });
      res.status(existing ? 200 : 201).json({
        data: enrollment[0],
        note: parsed.data.note ?? null,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
