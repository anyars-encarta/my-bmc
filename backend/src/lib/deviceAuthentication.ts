import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { eq, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { attendanceDevice } from "../db/schema/index.js";
import { unauthorized } from "./errors.js";

const scrypt = promisify(scryptCallback);
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;

export const hashDeviceKey = async (key: string) => {
  const salt = randomBytes(16);
  const derived = await scrypt(key, salt, 32) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
};

export const verifyDeviceKey = async (key: string, storedHash: string) => {
  const [algorithm, saltText, hashText] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  if (salt.length !== 16 || expected.length !== 32) return false;

  const actual = await scrypt(key, salt, expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
};

export const requireDeviceAuthentication = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const code = req.header("X-Device-Code")?.trim();
    const key = req.header("X-Device-Key");
    if (!code || !key) {
      throw unauthorized("Device credentials are required.", "DEVICE_AUTH_REQUIRED");
    }

    const [device] = await db
      .select()
      .from(attendanceDevice)
      .where(eq(attendanceDevice.code, code))
      .limit(1);
    if (!device || device.status !== "ACTIVE") {
      throw unauthorized("Device credentials are invalid or disabled.", "DEVICE_AUTH_INVALID");
    }

    const now = Date.now();
    const windowStart = new Date(Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS);
    const [rateState] = await db.update(attendanceDevice)
      .set({
        rateLimitCount: sql`CASE
          WHEN ${attendanceDevice.rateLimitWindowStart} IS NULL
            OR ${attendanceDevice.rateLimitWindowStart} < ${windowStart}
          THEN 1 ELSE ${attendanceDevice.rateLimitCount} + 1
        END`,
        rateLimitWindowStart: sql`CASE
          WHEN ${attendanceDevice.rateLimitWindowStart} IS NULL
            OR ${attendanceDevice.rateLimitWindowStart} < ${windowStart}
          THEN ${windowStart} ELSE ${attendanceDevice.rateLimitWindowStart}
        END`,
      })
      .where(eq(attendanceDevice.id, device.id))
      .returning({
        requestCount: attendanceDevice.rateLimitCount,
        windowStart: attendanceDevice.rateLimitWindowStart,
      });
    if (!rateState) {
      throw unauthorized("Device credentials are invalid or disabled.", "DEVICE_AUTH_INVALID");
    }
    if (rateState.requestCount > RATE_LIMIT) {
      const currentWindowStart = rateState.windowStart?.getTime() ?? now;
      const retryAfter = Math.max(1, Math.ceil(
        (currentWindowStart + RATE_WINDOW_MS - now) / 1000,
      ));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Too Many Requests",
        message: "Device request limit exceeded.",
        code: "DEVICE_RATE_LIMITED",
        requestId: req.requestId ?? null,
      });
      return;
    }

    if (!(await verifyDeviceKey(key, device.apiKeyHash))) {
      throw unauthorized("Device credentials are invalid or disabled.", "DEVICE_AUTH_INVALID");
    }

    await db.update(attendanceDevice)
      .set({ lastSeenAt: new Date() })
      .where(eq(attendanceDevice.id, device.id));
    req.device = device;
    next();
  } catch (error) {
    next(error);
  }
};
