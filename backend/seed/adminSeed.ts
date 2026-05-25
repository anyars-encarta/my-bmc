import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../src/db";
import { account, user } from "../src/db/schema";

const adminSeed = {
  id: process.env.SEED_ADMIN_ID ?? "admin_1",
  name: process.env.SEED_ADMIN_NAME ?? "System Admin",
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@bmc.local",
  password: process.env.SEED_ADMIN_PASSWORD ?? "Admin#1234",
  image: process.env.SEED_ADMIN_IMAGE ?? null,
  imageCldPubId: process.env.SEED_ADMIN_IMAGE_CLD_PUB_ID ?? null,
} as const;

const seedAdminUser = async () => {
  const existingByEmail = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, adminSeed.email))
    .limit(1);

  const existingUserId = existingByEmail[0]?.id;
  const userId = existingUserId ?? adminSeed.id;

  if (existingUserId) {
    await db
      .update(user)
      .set({
        name: adminSeed.name,
        role: "admin",
        status: "active",
        emailVerified: true,
        image: adminSeed.image,
        imageCldPubId: adminSeed.imageCldPubId,
      })
      .where(eq(user.id, userId));
  } else {
    await db.insert(user).values({
      id: userId,
      name: adminSeed.name,
      email: adminSeed.email,
      emailVerified: true,
      image: adminSeed.image,
      imageCldPubId: adminSeed.imageCldPubId,
      role: "admin",
      status: "active",
    });
  }

  const credentialAccounts = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    )
    .limit(1);

  const hashedPassword = await hashPassword(adminSeed.password);

  if (credentialAccounts[0]?.id) {
    await db
      .update(account)
      .set({
        password: hashedPassword,
      })
      .where(eq(account.id, credentialAccounts[0].id));
  } else {
    await db.insert(account).values({
      id: `acc_${userId}`,
      userId,
      accountId: userId,
      providerId: "credential",
      password: hashedPassword,
    });
  }

  console.log("Admin seed completed.");
  console.log(`Email: ${adminSeed.email}`);
  console.log("Password: <value from SEED_ADMIN_PASSWORD or default>");
};

seedAdminUser()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Admin seed failed:", error);
    process.exit(1);
  });
