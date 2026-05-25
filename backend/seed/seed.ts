import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import {
  categories,
  paymentRecipients,
  payments,
  staff,
} from "../src/db/schema/app.js";

type SeedData = {
  staff: Array<{
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    employeeId: string;
    department?: string;
    position?: string;
    momoNumber: string;
    momoName?: string;
    status?: "active" | "inactive";
  }>;
  categories: Array<{
    name: string;
    description?: string;
    isActive?: boolean;
  }>;
  payments: Array<{
    title: string;
    description?: string;
    categoryName: string;
    status?: "draft" | "pending_approval" | "approved" | "processing" | "completed" | "cancelled";
    createdBy: string;
    submittedAt?: string | null;
    approvingOfficer?: string | null;
    approvedBy?: string | null;
    approvedAt?: string | null;
    processedBy?: string | null;
    processedAt?: string | null;
    momoReferenceId?: string | null;
  }>;
  recipients: Array<{
    paymentTitle: string;
    staffEmail: string;
    amount: string;
    status?: "pending" | "approved" | "disapproved";
    note?: string | null;
    verifiedBy?: string | null;
    verifiedAt?: string | null;
    addedBy: string;
  }>;
};

async function loadSeedData(): Promise<SeedData> {
  const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
  return JSON.parse(raw) as SeedData;
}

async function clearPaymentTables() {
  await db.delete(paymentRecipients);
  await db.delete(payments);
  await db.delete(categories);
  await db.delete(staff);
}

async function main() {
  const data = await loadSeedData();

  await clearPaymentTables();

  const insertedStaff = data.staff.length
    ? await db
        .insert(staff)
        .values(
          data.staff.map((person) => ({
            ...person,
            phone: person.phone ?? null,
            department: person.department ?? null,
            position: person.position ?? null,
            momoName: person.momoName ?? null,
            status: person.status ?? "active",
          })),
        )
        .returning()
    : [];

  const staffIdByEmail = new Map(insertedStaff.map((person) => [person.email, person.id]));

  const insertedCategories = data.categories.length
    ? await db
        .insert(categories)
        .values(
          data.categories.map((category) => ({
            ...category,
            description: category.description ?? null,
            isActive: category.isActive ?? true,
          })),
        )
        .returning()
    : [];

  const categoryIdByName = new Map(insertedCategories.map((category) => [category.name, category.id]));

  const insertedPayments = data.payments.length
    ? await db
        .insert(payments)
        .values(
          data.payments.map((payment) => ({
            title: payment.title,
            description: payment.description ?? null,
            categoryId: categoryIdByName.get(payment.categoryName)!,
            status: payment.status ?? "draft",
            totalAmount: "0.00",
            createdBy: payment.createdBy,
            submittedAt: payment.submittedAt ? new Date(payment.submittedAt) : null,
            approvingOfficer: payment.approvingOfficer ?? null,
            approvedBy: payment.approvedBy ?? null,
            approvedAt: payment.approvedAt ? new Date(payment.approvedAt) : null,
            processedBy: payment.processedBy ?? null,
            processedAt: payment.processedAt ? new Date(payment.processedAt) : null,
            momoReferenceId: payment.momoReferenceId ?? null,
          })),
        )
        .returning()
    : [];

  const paymentIdByTitle = new Map(insertedPayments.map((payment) => [payment.title, payment.id]));

  if (data.recipients.length) {
    await db.insert(paymentRecipients).values(
      data.recipients.map((recipient) => ({
        paymentId: paymentIdByTitle.get(recipient.paymentTitle)!,
        staffId: staffIdByEmail.get(recipient.staffEmail)!,
        amount: recipient.amount,
        status: recipient.status ?? "pending",
        note: recipient.note ?? null,
        verifiedBy: recipient.verifiedBy ?? null,
        verifiedAt: recipient.verifiedAt ? new Date(recipient.verifiedAt) : null,
        addedBy: recipient.addedBy,
      })),
    );
  }

  const seededPayments = await db.select().from(payments);

  for (const payment of seededPayments) {
    const recipients = await db
      .select({ amount: paymentRecipients.amount, status: paymentRecipients.status })
      .from(paymentRecipients)
      .where(eq(paymentRecipients.paymentId, payment.id));

    const totalAmount = recipients.reduce((total, recipient) => {
      if (recipient.status === "disapproved") {
        return total;
      }

      return total + Number(recipient.amount);
    }, 0);

    await db
      .update(payments)
      .set({ totalAmount: totalAmount.toFixed(2) })
      .where(eq(payments.id, payment.id));
  }

  console.log("Payment seed completed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Payment seed failed:", error);
    process.exit(1);
  });
