import app from "./app.js";
import { ensureAuditPartitions } from "./lib/platform.js";
import { runLicenceExpiryJob } from "./jobs/licenceExpiryJob.js";
import { materializeFixedScheduleWindow } from "./jobs/fixedScheduleMaterializer.js";
import { seedGhanaPublicHolidays } from "./jobs/ghanaHolidaySeed.js";

const PORT = 8000;

const start = async () => {
  await ensureAuditPartitions();
  await seedGhanaPublicHolidays();

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  materializeFixedScheduleWindow().catch((error) => {
    console.error("Failed to materialize fixed weekday schedules", error);
  });

  setInterval(() => {
    materializeFixedScheduleWindow().catch((error) => {
      console.error("Failed to refresh fixed weekday schedules", error);
    });
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
