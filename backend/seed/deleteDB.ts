import { db } from "../src/db/index.js";
import { account, session, user, verification } from "../src/db/schema/auth.js";
import { categories, paymentRecipients, payments, staff } from "../src/db/schema/app.js";

async function main() {
  await db.delete(paymentRecipients);
  await db.delete(payments);
  await db.delete(categories);
  await db.delete(staff);

  await db.delete(session);
  await db.delete(account);
  await db.delete(verification);
  await db.delete(user);

  console.log("Database deletion completed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Database deletion failed:", error);
    process.exit(1);
  });
