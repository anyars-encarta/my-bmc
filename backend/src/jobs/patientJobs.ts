import { retryOpenMergeTasks, sweepDuplicateCandidates } from "../lib/patientRegistry.js";

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

/** Re-runs merge re-pointing tasks that an earlier request left pending or failed. */
export const runPatientMergeTaskRetryJob = async () => {
  const retried = await retryOpenMergeTasks();
  if (retried > 0) console.info(`Patient merge retry processed ${retried} merge(s).`);
};

/** Nightly duplicate sweep over patients registered or changed since the previous run. */
export const runPatientDuplicateSweepJob = async () => {
  const { scanned, queued } = await sweepDuplicateCandidates();
  if (queued > 0) {
    console.info(`Patient duplicate sweep queued ${queued} candidate pair(s) from ${scanned} record(s).`);
  }
};

export const startPatientJobs = () => {
  const schedule = (name: string, cadenceMs: number, operation: () => Promise<unknown>) => {
    if (jobIntervals.has(name)) return;
    const run = runSafely(name, operation);
    void run();
    jobIntervals.set(name, setInterval(() => void run(), cadenceMs));
  };

  schedule("PatientMergeTaskRetryJob", 5 * 60_000, runPatientMergeTaskRetryJob);
  schedule("PatientDuplicateSweepJob", 24 * 60 * 60_000, runPatientDuplicateSweepJob);
};
