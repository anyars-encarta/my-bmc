import { and, eq, gte, lte, or } from "drizzle-orm";

import { db } from "../db/index.js";
import { notification, staff, staffLicense } from "../db/schema/index.js";

const DAYS_TO_NOTIFY = [90, 30, 7];

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const runLicenceExpiryJob = async () => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const maxDate = addDays(today, Math.max(...DAYS_TO_NOTIFY));
  const todayIso = isoDate(today);
  const maxIso = isoDate(maxDate);

  const dueLicenses = await db
    .select({
      id: staffLicense.id,
      staffId: staffLicense.staffId,
      licensingBody: staffLicense.licensingBody,
      licenceNo: staffLicense.licenceNo,
      expiresOn: staffLicense.expiresOn,
      staffEmail: staff.email,
      firstName: staff.firstName,
      lastName: staff.lastName,
    })
    .from(staffLicense)
    .innerJoin(staff, eq(staff.id, staffLicense.staffId))
    .where(
      and(
        eq(staffLicense.status, "ACTIVE"),
        gte(staffLicense.expiresOn, todayIso),
        lte(staffLicense.expiresOn, maxIso),
      ),
    );

  for (const license of dueLicenses) {
    const expiryDate = new Date(`${license.expiresOn}T00:00:00.000Z`);
    const daysLeft = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (!DAYS_TO_NOTIFY.includes(daysLeft)) {
      continue;
    }

    const template = `LICENCE_EXPIRY_${daysLeft}D`;
    const existing = await db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.template, template),
          eq(notification.recipientType, "STAFF"),
          eq(notification.relatedEntityType, "staff_license"),
          eq(notification.relatedEntityId, license.id),
          or(eq(notification.status, "QUEUED"), eq(notification.status, "SENT")),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      continue;
    }

    await db.insert(notification).values({
      channel: "IN_APP",
      recipientType: "STAFF",
      recipientId: license.staffId,
      toAddress: license.staffEmail,
      template,
      payload: {
        staffName: `${license.firstName} ${license.lastName}`,
        licensingBody: license.licensingBody,
        licenceNo: license.licenceNo,
        expiresOn: license.expiresOn,
        daysLeft,
      },
      status: "QUEUED",
      relatedEntityType: "staff_license",
      relatedEntityId: license.id,
    });
  }
};
