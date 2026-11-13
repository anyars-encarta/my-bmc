import { eq, sql } from "drizzle-orm";

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

/** Claims queued outbox records and delivers them through the configured notification ports. */
export const dispatchNotificationOutbox = async (limit = 100) => {
  const claimed = await db.execute(sql`
    WITH candidates AS (
      SELECT id
        FROM notification
       WHERE status = 'QUEUED'
         AND scheduled_for <= now()
         AND channel IN ('SMS', 'EMAIL')
       ORDER BY scheduled_for, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT ${Math.min(500, Math.max(1, limit))}
    )
    UPDATE notification n
       SET status = 'SENDING', attempts = n.attempts + 1
      FROM candidates c
     WHERE n.id = c.id
    RETURNING n.id, n.channel, n.to_address, n.template, n.payload
  `);

  let sent = 0;
  let failed = 0;
  for (const row of claimed.rows as Array<{
    id: string;
    channel: string;
    to_address: string | null;
    template: string;
    payload: Record<string, unknown>;
  }>) {
    try {
      if (!row.to_address) {
        await db.update(notification)
          .set({ status: "FAILED", lastError: "No destination address was recorded." })
          .where(eq(notification.id, row.id));
        failed += 1;
        continue;
      }
      const port = row.channel === "SMS" ? smsPort : row.channel === "EMAIL" ? emailPort : null;
      if (!port) {
        await db.update(notification)
          .set({ status: "FAILED", lastError: `Unsupported notification channel: ${row.channel}` })
          .where(eq(notification.id, row.id));
        failed += 1;
        continue;
      }
      await port.send({ to: row.to_address, template: row.template, payload: row.payload });
      await db.update(notification)
        .set({ status: "SENT", sentAt: new Date(), lastError: null })
        .where(eq(notification.id, row.id));
      sent += 1;
    } catch (error) {
      console.error("Notification delivery failed.", { notificationId: row.id, error });
      await db.update(notification)
        .set({ status: "FAILED", lastError: error instanceof Error ? error.message : "Delivery failed." })
        .where(eq(notification.id, row.id));
      failed += 1;
    }
  }
  return { sent, failed };
};
