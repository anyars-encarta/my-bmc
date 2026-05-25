import { db } from "../src/db";
import { account, user } from "../src/db/schema/auth";
import { eq } from "drizzle-orm";

const rows = await db
  .select({
    providerId: account.providerId,
    accountId: account.accountId,
  })
  .from(account)
  .limit(3);

for (const r of rows) {
  console.log(
    "providerId:", r.providerId,
    "| accountId:", r.accountId,
  );
}

const users = await db.select({ id: user.id }).from(user).limit(3);
console.log("\nUsers in DB:");
users.forEach((u) => console.log("  id:", u.id));
