import { expirePrescriptions } from "../routes/v1/clinical.js";

const jobIntervals = new Map<string, ReturnType<typeof setInterval>>();
const runningJobs = new Set<string>();

const runSafely = (name: string, operation: () => Promise<unknown>) => async () => {
  if (runningJobs.has(name)) return;
  runningJobs.add(name);
  try {
    await operation();
  } catch (error) {
    console.error(`${name} failed.`, error);
  } finally {
    runningJobs.delete(name);
  }
};

export const runPrescriptionExpiryJob = async () => {
  const expired = await expirePrescriptions();
  if (expired > 0) console.info(`Expired ${expired} prescription(s).`);
};

export const startClinicalJobs = () => {
  if (jobIntervals.has("PrescriptionExpiryJob")) return;
  const run = runSafely("PrescriptionExpiryJob", runPrescriptionExpiryJob);
  void run();
  jobIntervals.set("PrescriptionExpiryJob", setInterval(() => void run(), 60 * 60_000));
};
