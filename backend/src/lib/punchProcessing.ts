import { asc, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { punchLog } from "../db/schema/index.js";
import { processPunch } from "./punchProcessor.js";

const processingQueues = new Map<string, Promise<void>>();
const scheduledPunchIds = new Set<string>();

export const schedulePunchProcessing = (
  punchId: string,
  staffId: string | null,
  requestId?: string,
) => {
  if (scheduledPunchIds.has(punchId)) return;
  scheduledPunchIds.add(punchId);
  const queueKey = staffId ?? punchId;
  const previous = processingQueues.get(queueKey) ?? Promise.resolve();
  const current = previous.then(async () => {
    try {
      await processPunch(punchId);
    } catch (error) {
      console.error("Punch processing failed; the event remains available for retry.", {
        punchId,
        requestId,
        error,
      });
    }
  });
  processingQueues.set(queueKey, current);
  void current.finally(() => {
    scheduledPunchIds.delete(punchId);
    if (processingQueues.get(queueKey) === current) processingQueues.delete(queueKey);
  });
};

export const recoverPendingPunches = async () => {
  const pending = await db.select({
    id: punchLog.id,
    staffId: punchLog.staffId,
  }).from(punchLog)
    .where(eq(punchLog.processed, false))
    .orderBy(asc(punchLog.receivedAt))
    .limit(100);
  for (const punch of pending) {
    schedulePunchProcessing(punch.id, punch.staffId);
  }
  return pending.length;
};
