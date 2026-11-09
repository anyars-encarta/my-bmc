import app from "./app.js";
import { ensureAuditPartitions } from "./lib/platform.js";
import { runLicenceExpiryJob } from "./jobs/licenceExpiryJob.js";
import { materializeFixedScheduleWindow } from "./jobs/fixedScheduleMaterializer.js";
import { seedGhanaPublicHolidays } from "./jobs/ghanaHolidaySeed.js";
import { startAttendanceJobs } from "./jobs/attendanceJobs.js";

const PORT = 8000;

const start = async () => {
  await ensureAuditPartitions();
  try {
    await seedGhanaPublicHolidays();
  } catch (error) {
    console.error("Failed to seed Ghana public holidays at startup", error);
  }

  try {
    await materializeFixedScheduleWindow();
  } catch (error) {
    console.error("Failed to materialize fixed weekday schedules", error);
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  startAttendanceJobs();

  setInterval(async () => {
    try {
      await seedGhanaPublicHolidays();
    } catch (error) {
      console.error("Failed to refresh Ghana public holidays", error);
    }

    try {
      await materializeFixedScheduleWindow();
    } catch (error) {
      console.error("Failed to refresh fixed weekday schedules", error);
    }
  }, 24 * 60 * 60 * 1000);

  setInterval(() => {
    ensureAuditPartitions().catch((error) => {
      console.error("Failed to refresh audit partitions", error);
    });
  }, 12 * 60 * 60 * 1000);

  runLicenceExpiryJob().catch((error) => {
    console.error("Failed to run licence expiry job", error);
  });

  setInterval(() => {
    runLicenceExpiryJob().catch((error) => {
      console.error("Failed to run licence expiry job", error);
    });
  }, 24 * 60 * 60 * 1000);
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
