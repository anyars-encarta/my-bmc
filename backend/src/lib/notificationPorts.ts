import { sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { notification } from "../db/schema/index.js";

export type NotificationMessage = {
  to: string;
  template: string;
  payload: Record<string, unknown>;
};

export interface NotificationPort {
  send(message: NotificationMessage): Promise<void>;
}

export class FakeSmsPort implements NotificationPort {
  async send(message: NotificationMessage) {
    console.info("Fake SMS sent.", { template: message.template });
  }
}

export class FakeEmailPort implements NotificationPort {
  async send(message: NotificationMessage) {
    console.info("Fake email sent.", { template: message.template });
  }
}

const smsPort: NotificationPort = new FakeSmsPort();
const emailPort: NotificationPort = new FakeEmailPort();
const NOTIFICATION_CLAIM_LEASE_MINUTES = 15;

/** Claims queued outbox records and delivers them through the configured notification ports. */
export const dispatchNotificationOutbox = async (limit = 100) => {
  const claimed = await db.execute(sql`
    WITH candidates AS (
      SELECT id
        FROM notification
       WHERE channel IN ('SMS', 'EMAIL')
         AND (
           (status = 'QUEUED' AND scheduled_for <= now())
           OR (status = 'SENDING' AND claim_started_at <= now() - (${NOTIFICATION_CLAIM_LEASE_MINUTES} * interval '1 minute'))
         )
       ORDER BY scheduled_for, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT ${Math.min(500, Math.max(1, limit))}
    )
    UPDATE notification n
       SET status = 'SENDING', attempts = n.attempts + 1, claim_started_at = now()
      FROM candidates c
     WHERE n.id = c.id
    RETURNING n.id, n.channel, n.to_address, n.template, n.payload,
              n.claim_started_at::text AS claim_token
  `);

  let sent = 0;
  let failed = 0;
  for (const row of claimed.rows as Array<{
    id: string;
    channel: string;
    to_address: string | null;
    template: string;
    payload: Record<string, unknown>;
    claim_token: string;
  }>) {
    let claimToken = row.claim_token;
    try {
      const renewed = await db.execute(sql`
        UPDATE notification
           SET claim_started_at = now()
         WHERE id = ${row.id}::uuid AND status = 'SENDING'
           AND claim_started_at = ${row.claim_token}::timestamptz
        RETURNING claim_started_at::text AS claim_token
      `);
      const lease = renewed.rows[0] as { claim_token: string } | undefined;
      if (!lease) continue;
      claimToken = lease.claim_token;

      if (!row.to_address) {
        await db.execute(sql`
          UPDATE notification
             SET status = 'FAILED', claim_started_at = NULL, last_error = 'No destination address was recorded.'
           WHERE id = ${row.id}::uuid AND status = 'SENDING'
             AND claim_started_at = ${claimToken}::timestamptz
        `);
        failed += 1;
        continue;
      }
      const port = row.channel === "SMS" ? smsPort : row.channel === "EMAIL" ? emailPort : null;
      if (!port) {
        await db.execute(sql`
          UPDATE notification
             SET status = 'FAILED', claim_started_at = NULL, last_error = ${`Unsupported notification channel: ${row.channel}`}
           WHERE id = ${row.id}::uuid AND status = 'SENDING'
               AND claim_started_at = ${claimToken}::timestamptz
        `);
        failed += 1;
        continue;
      }
      await port.send({ to: row.to_address, template: row.template, payload: row.payload });
      await db.execute(sql`
        UPDATE notification
           SET status = 'SENT', claim_started_at = NULL, sent_at = now(), last_error = NULL
         WHERE id = ${row.id}::uuid AND status = 'SENDING'
             AND claim_started_at = ${claimToken}::timestamptz
      `);
      sent += 1;
    } catch (error) {
      console.error("Notification delivery failed.", { notificationId: row.id, error });
      await db.execute(sql`
        UPDATE notification
           SET status = 'FAILED', claim_started_at = NULL,
               last_error = ${error instanceof Error ? error.message : "Delivery failed."}
         WHERE id = ${row.id}::uuid AND status = 'SENDING'
           AND claim_started_at = ${claimToken}::timestamptz
      `);
      failed += 1;
    }
  }
  return { sent, failed };
};
