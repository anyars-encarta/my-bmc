import app from "./app.js";
import { ensureAuditPartitions } from "./lib/platform.js";

const PORT = 8000;

const start = async () => {
  await ensureAuditPartitions();

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  setInterval(() => {
    ensureAuditPartitions().catch((error) => {
      console.error("Failed to refresh audit partitions", error);
    });
  }, 12 * 60 * 60 * 1000);
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
