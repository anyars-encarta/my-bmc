import {
  closeInvalidAppointmentSlots,
  processRosterEventsAndRefreshSlots,
  queueAppointmentReminders,
  runNoShowSweep,
} from "../lib/appointmentOperations.js";
import { dispatchNotificationOutbox } from "../lib/notificationPorts.js";

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

export const runAppointmentSlotJob = async () => {
  const result = await processRosterEventsAndRefreshSlots();
  if (result.generated || result.closed || result.events) {
    console.info("Appointment slot generation completed.", result);
  }
};

export const runAppointmentNoShowJob = async () => {
  const marked = await runNoShowSweep();
  if (marked > 0) console.info(`Marked ${marked} appointment(s) as no-show.`);
};

export const runAppointmentReminderJob = async () => {
  const result = await queueAppointmentReminders();
  if (result && (result.queued || result.skipped)) {
    console.info("Appointment reminders queued.", result);
  }
};

export const startAppointmentJobs = () => {
  const schedule = (name: string, cadenceMs: number, operation: () => Promise<unknown>) => {
    if (jobIntervals.has(name)) return;
    const run = runSafely(name, operation);
    void run();
    jobIntervals.set(name, setInterval(() => void run(), cadenceMs));
  };

  schedule("AppointmentSlotGenerationJob", 5 * 60_000, runAppointmentSlotJob);
  schedule("AppointmentNoShowJob", 5 * 60_000, runAppointmentNoShowJob);
  schedule("AppointmentReminderJob", 15 * 60_000, runAppointmentReminderJob);
  schedule("NotificationOutboxJob", 60_000, dispatchNotificationOutbox);
};

export const runAppointmentRosterChangeClose = closeInvalidAppointmentSlots;
