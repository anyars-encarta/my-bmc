import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  pgEnum,
  boolean,
  uniqueIndex,
  date,
  smallint,
  char,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const staffStatusEnum = pgEnum("staff_status", ["active", "inactive"]);
export const staffCategoryEnum = pgEnum("staff_category", ["CLINICAL", "NON_CLINICAL"]);
export const scheduleModeEnum = pgEnum("schedule_mode", ["FIXED_WEEKDAY", "ROSTERED"]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "draft",           // created, recipients still being added
  "pending_approval", // submitted to approving officer
  "approved",        // all recipients verified, ready to process
  "processing",      // payment being sent to MTN MoMo
  "completed",       // all disbursements sent
  "cancelled",       // cancelled before processing
]);

export const recipientStatusEnum = pgEnum("recipient_status", [
  "pending",      // not yet reviewed by approving officer
  "approved",     // approving officer approved this recipient
  "disapproved",  // approving officer disapproved this recipient
]);

// ─── Staff ────────────────────────────────────────────────────────────────────

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  employeeId: varchar("employee_id", { length: 50 }).notNull(),
  department: varchar("department", { length: 100 }),
  position: varchar("position", { length: 100 }),
  momoNumber: varchar("momo_number", { length: 20 }).notNull(), // MTN MoMo number
  momoName: varchar("momo_name", { length: 200 }),             // registered name on MoMo
  status: staffStatusEnum("status").notNull().default("active"),
  imageUrl: varchar("image_url", { length: 255 }),
  staffCategory: staffCategoryEnum("staff_category").notNull().default("NON_CLINICAL"),
  scheduleMode: scheduleModeEnum("schedule_mode").notNull().default("FIXED_WEEKDAY"),
  defaultShiftTypeId: uuid("default_shift_type_id"),
  jobRoleId: uuid("job_role_id"),
  badgeNumber: varchar("badge_number", { length: 20 }),
  hireDate: date("hire_date"),
  terminationDate: date("termination_date"),
  userId: text("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex("staff_email_idx").on(table.email),
  employeeIdIdx: uniqueIndex("staff_employee_id_idx").on(table.employeeId),
  badgeIdx: uniqueIndex("staff_badge_idx").on(table.badgeNumber),
  userIdIdx: uniqueIndex("staff_user_id_idx").on(table.userId),
}));

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: uniqueIndex("categories_name_idx").on(table.name),
}));

// ─── Payments ─────────────────────────────────────────────────────────────────

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  period: varchar("period", { length: 100 }), // e.g. "Q1 2024", "March 2024"
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  status: paymentStatusEnum("status").notNull().default("draft"),
  // Calculated from approved recipients; updated on recipient changes
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  // Better-auth user IDs — stored as text since auth is external
  createdBy: text("created_by").notNull(),  // payment officer
  submittedAt: timestamp("submitted_at"),
  approvingOfficer: text("approving_officer"), // assigned approver
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  processedBy: text("processed_by"),
  processedAt: timestamp("processed_at"),
  // MTN MoMo bulk payment reference returned after processing
  momoReferenceId: varchar("momo_reference_id", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Payment Recipients ───────────────────────────────────────────────────────

export const paymentRecipients = pgTable("payment_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id")
    .notNull()
    .references(() => staff.id),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  status: recipientStatusEnum("status").notNull().default("pending"),
  note: text("note"),               // reason for approval/disapproval
  momoTransferReferenceId: varchar("momo_transfer_reference_id", { length: 100 }),
  momoTransferStatus: varchar("momo_transfer_status", { length: 20 }),
  momoTransferStatusReason: text("momo_transfer_status_reason"),
  momoTransferCheckedAt: timestamp("momo_transfer_checked_at"),
  verifiedBy: text("verified_by"),  // approving officer user ID
  verifiedAt: timestamp("verified_at"),
  addedBy: text("added_by").notNull(), // user who added this recipient
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const facilitySetup = pgTable("facility_setup", {
  id: uuid("id").primaryKey().defaultRandom(),
  facilityName: varchar("facility_name", { length: 255 }).notNull(),
  facilityCode: varchar("facility_code", { length: 50 }).notNull(),
  telephone: varchar("telephone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  logoUrl: varchar("logo_url", { length: 255 }),
  timezone: varchar("timezone", { length: 60 }).notNull().default("UTC"),
  currency: char("currency", { length: 3 }).notNull().default("GHS"),
  locale: varchar("locale", { length: 10 }).notNull().default("en-GH"),
  privacyPolicyVersion: varchar("privacy_policy_version", { length: 20 }),
  financialYearStartMonth: smallint("financial_year_start_month").notNull().default(1),
  nhiaFacilityCode: varchar("nhia_facility_code", { length: 30 }),
  gpsDigitalAddress: varchar("gps_digital_address", { length: 20 }),
  registrationNumber: varchar("registration_number", { length: 40 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const staffRelations = relations(staff, ({ many }) => ({
  paymentRecipients: many(paymentRecipients),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  category: one(categories, {
    fields: [payments.categoryId],
    references: [categories.id],
  }),
  recipients: many(paymentRecipients),
}));

export const paymentRecipientsRelations = relations(paymentRecipients, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentRecipients.paymentId],
    references: [payments.id],
  }),
  staff: one(staff, {
    fields: [paymentRecipients.staffId],
    references: [staff.id],
  }),
}));

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export const insertStaffSchema = createInsertSchema(staff, {
  email: z.string().email(),
  momoNumber: z.string().min(10).max(20),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  employeeId: z.string().min(1).max(50),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const updateStaffSchema = insertStaffSchema.partial();

export const selectStaffSchema = createSelectSchema(staff);

export const insertCategorySchema = createInsertSchema(categories, {
  name: z.string().min(1).max(150),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const updateCategorySchema = insertCategorySchema.partial();

export const selectCategorySchema = createSelectSchema(categories);

export const insertPaymentSchema = createInsertSchema(payments, {
  title: z.string().min(1).max(255),
  categoryId: z.string().uuid(),
}).omit({
  id: true,
  status: true,
  totalAmount: true,
  submittedAt: true,
  approvedBy: true,
  approvedAt: true,
  processedBy: true,
  processedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const updatePaymentSchema = createInsertSchema(payments, {
  title: z.string().min(1).max(255),
  categoryId: z.string().uuid(),
}).omit({
  id: true,
  totalAmount: true,
  submittedAt: true,
  approvedBy: true,
  approvedAt: true,
  processedBy: true,
  processedAt: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export const selectPaymentSchema = createSelectSchema(payments);

export const insertRecipientSchema = createInsertSchema(paymentRecipients, {
  staffId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid monetary amount"),
}).omit({
  id: true,
  paymentId: true,
  addedBy: true,
  status: true,
  verifiedBy: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const updateRecipientAmountSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid monetary amount"),
});

export const reviewRecipientSchema = z.object({
  status: z.enum(["approved", "disapproved"]),
  note: z.string().optional(),
});

export const insertFacilitySetupSchema = createInsertSchema(facilitySetup, {
  facilityName: z.string().min(1).max(255),
  facilityCode: z.string().min(1).max(50),
  telephone: z.string().max(20).optional(),
  email: z.string().email().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const updateFacilitySetupSchema = insertFacilitySetupSchema.partial();

export const selectFacilitySetupSchema = createSelectSchema(facilitySetup);

// ─── Types ────────────────────────────────────────────────────────────────────

export type Staff = typeof staff.$inferSelect;
export type NewStaff = typeof staff.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentRecipient = typeof paymentRecipients.$inferSelect;
export type NewPaymentRecipient = typeof paymentRecipients.$inferInsert;
export type FacilitySetup = typeof facilitySetup.$inferSelect;
export type NewFacilitySetup = typeof facilitySetup.$inferInsert;
