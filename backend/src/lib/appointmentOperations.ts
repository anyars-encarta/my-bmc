import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  appointment,
  appointmentSlot,
  clinicSessionTemplate,
  jobRole,
  leaveRequest,
  orgUnit,
  publicHoliday,
  rosterEntry,
  staff,
  workforceEvent,
} from "../db/schema/index.js";

const DAY_MS = 24 * 60 * 60_000;

const utcDate = (date: Date) => date.toISOString().slice(0, 10);

const timeParts = (value: string) => {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return { hours: hours ?? 0, minutes: minutes ?? 0, seconds: seconds ?? 0 };
};

const atUtcTime = (date: Date, value: string) => {
  const { hours, minutes, seconds } = timeParts(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, seconds);
};

const isoWeekday = (date: Date) => date.getUTCDay() || 7;

const appointmentHorizonDays = () => {
  const configured = Number.parseInt(process.env.HAMS_APPOINTMENT_HORIZON_DAYS ?? "30", 10);
  return Number.isFinite(configured) ? Math.min(90, Math.max(1, configured)) : 30;
};

/** Makes bookable slots only for active clinical roster windows. */
export const generateAppointmentSlots = async (now = new Date(), days = appointmentHorizonDays()) => {
  const templates = await db.select({
    template: clinicSessionTemplate,
    unitIsClinical: orgUnit.isClinical,
    unitActive: orgUnit.active,
  }).from(clinicSessionTemplate)
    .innerJoin(orgUnit, eq(orgUnit.id, clinicSessionTemplate.orgUnitId))
    .where(and(eq(clinicSessionTemplate.active, true), eq(orgUnit.isClinical, true), eq(orgUnit.active, true)));

  let createdOrUpdated = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    const dateValue = utcDate(date);
    const [holiday] = await db.select({ date: publicHoliday.holidayDate })
      .from(publicHoliday).where(eq(publicHoliday.holidayDate, dateValue)).limit(1);
    if (holiday) continue;

    for (const { template } of templates) {
      if (template.weekday !== isoWeekday(date) || template.validFrom > dateValue ||
        (template.validTo && template.validTo < dateValue)) continue;

      const rosterRows = await db.select({
        entry: rosterEntry,
        staffId: staff.id,
      }).from(rosterEntry)
        .innerJoin(staff, eq(staff.id, rosterEntry.staffId))
        .innerJoin(jobRole, eq(jobRole.id, staff.jobRoleId))
        .where(and(
          eq(rosterEntry.orgUnitId, template.orgUnitId),
          eq(rosterEntry.rosterDate, dateValue),
          eq(rosterEntry.status, "ACTIVE"),
          eq(staff.status, "active"),
          eq(jobRole.staffCategory, "CLINICAL"),
          sql`NOT EXISTS (
            SELECT 1 FROM leave_request lr
            WHERE lr.staff_id = ${rosterEntry.staffId}
              AND lr.status = 'APPROVED'
              AND lr.start_date <= ${dateValue}::date
              AND lr.end_date >= ${dateValue}::date
          )`,
        ));

      const windows = template.providerStaffId
        ? rosterRows.filter((row) => row.staffId === template.providerStaffId)
        : rosterRows;
      if (windows.length === 0) continue;

      const sessionStart = atUtcTime(date, template.startTime);
      const sessionEnd = atUtcTime(date, template.endTime);
      const slotDuration = template.slotMinutes * 60_000;
      for (let startsAt = sessionStart; startsAt + slotDuration <= sessionEnd; startsAt += slotDuration) {
        const endsAt = startsAt + slotDuration;
        const availableWindows = Array.from(new Map(windows
          .filter(({ entry }) => entry.plannedStart.getTime() <= startsAt && entry.plannedEnd.getTime() >= endsAt)
          .map((row) => [row.staffId, row])).values());
        if (availableWindows.length === 0) continue;

        const selected = availableWindows[0];
        const providerStaffId = template.providerStaffId ?? null;
        const capacity = template.capacityPerSlot * (template.providerStaffId ? 1 : availableWindows.length);
        const [slot] = await db.insert(appointmentSlot).values({
          templateId: template.id,
          orgUnitId: template.orgUnitId,
          providerStaffId,
          rosterEntryId: selected?.entry.id ?? null,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          capacity,
          status: "OPEN",
        }).onConflictDoUpdate({
          target: [appointmentSlot.orgUnitId, appointmentSlot.providerStaffId, appointmentSlot.startsAt],
          set: {
            templateId: template.id,
            rosterEntryId: selected?.entry.id ?? null,
            endsAt: new Date(endsAt),
            capacity,
            status: sql`CASE WHEN ${appointmentSlot.status} = 'BLOCKED' THEN 'BLOCKED' ELSE 'OPEN' END`,
          },
        }).returning({ id: appointmentSlot.id });
        if (slot) createdOrUpdated += 1;
      }
    }
  }
  return createdOrUpdated;
};

/** Closes slots no longer covered by an active roster and queues their booked patients for rebooking. */
export const closeInvalidAppointmentSlots = async (now = new Date()) => {
  const result = await db.execute(sql`
    WITH closed_slots AS (
      UPDATE appointment_slot s
         SET status = 'CLOSED'
       WHERE s.status = 'OPEN'
         AND s.starts_at > ${now}
         AND (
           s.template_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM clinic_session_template t
              WHERE t.id = s.template_id
                AND t.active = true
                AND t.org_unit_id = s.org_unit_id
                AND (t.provider_staff_id IS NULL OR t.provider_staff_id = s.provider_staff_id)
                AND t.valid_from <= s.starts_at::date
                AND (t.valid_to IS NULL OR t.valid_to >= s.starts_at::date)
                AND extract(isodow FROM s.starts_at) = t.weekday
                AND s.starts_at::time >= t.start_time
                AND s.ends_at::time <= t.end_time
                AND extract(epoch FROM (s.ends_at - s.starts_at)) / 60 = t.slot_minutes
           )
           OR NOT EXISTS (
             SELECT 1
               FROM roster_entry r
              WHERE r.id = s.roster_entry_id
                AND r.status = 'ACTIVE'
                AND r.org_unit_id = s.org_unit_id
                AND (s.provider_staff_id IS NULL OR r.staff_id = s.provider_staff_id)
                AND r.planned_start <= s.starts_at
                AND r.planned_end >= s.ends_at
                AND NOT EXISTS (
                  SELECT 1 FROM leave_request lr
                   WHERE lr.staff_id = r.staff_id
                     AND lr.status = 'APPROVED'
                     AND lr.start_date <= r.roster_date
                     AND lr.end_date >= r.roster_date
                )
           )
         )
       RETURNING s.id
    ), rebooks AS (
      INSERT INTO appointment_rebook_task (appointment_id, closed_slot_id)
      SELECT a.id, s.id
        FROM closed_slots s
        JOIN appointment_slot slot ON slot.id = s.id
        JOIN appointment a ON a.slot_id = slot.id
       WHERE a.status IN ('BOOKED', 'CONFIRMED')
       ON CONFLICT (appointment_id, closed_slot_id) DO NOTHING
       RETURNING appointment_id
    ), notices AS (
      INSERT INTO notification (
        channel, recipient_type, recipient_id, to_address, template, payload, status,
        related_entity_type, related_entity_id
      )
      SELECT 'SMS', 'EXTERNAL', p.id::text, p.phone_e164, 'APPOINTMENT_REBOOK_REQUIRED',
             jsonb_build_object('appointmentId', a.id, 'scheduledStart', a.scheduled_start),
             'QUEUED', 'appointment', a.id
        FROM rebooks task
        JOIN appointment a ON a.id = task.appointment_id
        JOIN patient p ON p.id = a.patient_id
       WHERE p.phone_e164 IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM consent c
            WHERE c.subject_type = 'PATIENT'
              AND c.subject_id = p.id
              AND c.consent_type = 'SMS_CONTACT'
              AND c.status = 'GRANTED'
              AND c.withdrawn_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM consent latest
                 WHERE latest.subject_type = c.subject_type
                   AND latest.subject_id = c.subject_id
                   AND latest.consent_type = c.consent_type
                   AND (latest.created_at > c.created_at
                     OR (latest.created_at = c.created_at AND latest.id > c.id))
              )
         )
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed_slots)::int AS closed,
           (SELECT count(*) FROM rebooks)::int AS rebook_tasks,
           (SELECT count(*) FROM notices)::int AS notices
  `);
  return result.rows[0] as { closed: number; rebook_tasks: number; notices: number } | undefined;
};

/** Processes roster events and refreshes the rolling slot window. */
export const processRosterEventsAndRefreshSlots = async (now = new Date()) => {
  const events = await db.select({ id: workforceEvent.id })
    .from(workforceEvent)
    .where(and(eq(workforceEvent.eventType, "RosterEntryChanged"), isNull(workforceEvent.processedAt)))
    .orderBy(asc(workforceEvent.occurredAt))
    .limit(25);

  const generated = await generateAppointmentSlots(now);
  const closed = await closeInvalidAppointmentSlots(now);

  for (const event of events) {
    await db.update(workforceEvent)
      .set({ processedAt: now })
      .where(and(eq(workforceEvent.id, event.id), isNull(workforceEvent.processedAt)));
  }
  return { generated, closed: closed?.closed ?? 0, events: events.length };
};

/** Marks eligible appointments as no-shows and returns their reserved capacity. */
export const runNoShowSweep = async (now = new Date()) => {
  const result = await db.execute(sql`
    WITH missed AS (
      UPDATE appointment
         SET status = 'NO_SHOW'
       WHERE status IN ('BOOKED', 'CONFIRMED')
         AND checked_in_at IS NULL
         AND scheduled_end <= ${new Date(now.getTime() - 30 * 60_000)}
       RETURNING id, slot_id
    ), released AS (
      UPDATE appointment_slot s
         SET booked_count = GREATEST(0, s.booked_count - 1)
        FROM missed m
       WHERE s.id = m.slot_id
       RETURNING s.id
    )
    SELECT count(*)::int AS marked FROM missed
  `);
  return Number((result.rows[0] as { marked?: number } | undefined)?.marked ?? 0);
};

/** Queues 24-hour reminders and records skipped reminders when SMS consent is absent. */
export const queueAppointmentReminders = async (now = new Date()) => {
  const from = new Date(now.getTime() + 23 * 60 * 60_000);
  const to = new Date(now.getTime() + 25 * 60 * 60_000);
  const result = await db.execute(sql`
    WITH due AS (
      SELECT a.id, a.patient_id, a.scheduled_start, p.phone_e164,
             EXISTS (
               SELECT 1 FROM consent c
                WHERE c.subject_type = 'PATIENT'
                  AND c.subject_id = p.id
                  AND c.consent_type = 'SMS_CONTACT'
                  AND c.status = 'GRANTED'
                  AND c.withdrawn_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM consent latest
                     WHERE latest.subject_type = c.subject_type
                       AND latest.subject_id = c.subject_id
                       AND latest.consent_type = c.consent_type
                       AND (latest.created_at > c.created_at
                         OR (latest.created_at = c.created_at AND latest.id > c.id))
                  )
             ) AS can_sms
        FROM appointment a
        JOIN patient p ON p.id = a.patient_id
       WHERE a.status IN ('BOOKED', 'CONFIRMED')
         AND a.reminder_sent_at IS NULL
         AND a.scheduled_start >= ${from}
         AND a.scheduled_start < ${to}
       LIMIT 500
    ), claimed AS (
      UPDATE appointment a
         SET reminder_sent_at = ${now}
        FROM due d
       WHERE a.id = d.id AND a.reminder_sent_at IS NULL
         AND a.status IN ('BOOKED', 'CONFIRMED')
       RETURNING a.id, a.patient_id, a.scheduled_start
    ), enqueued AS (
      INSERT INTO notification (
        channel, recipient_type, recipient_id, to_address, template, payload, status,
        related_entity_type, related_entity_id
      )
      SELECT 'SMS', 'EXTERNAL', d.patient_id::text, d.phone_e164, 'APPOINTMENT_REMINDER',
             jsonb_build_object('appointmentId', d.id, 'scheduledStart', d.scheduled_start),
             CASE WHEN d.can_sms AND d.phone_e164 IS NOT NULL THEN 'QUEUED' ELSE 'SKIPPED_NO_CONSENT' END,
             'appointment', d.id
        FROM due d JOIN claimed c ON c.id = d.id
      RETURNING status
    )
    SELECT count(*)::int AS queued,
           count(*) FILTER (WHERE status = 'SKIPPED_NO_CONSENT')::int AS skipped
      FROM enqueued
  `);
  return result.rows[0] as { queued: number; skipped: number } | undefined;
};
