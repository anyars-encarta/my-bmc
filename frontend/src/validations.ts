import { z } from "zod";

export const editUserSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Enter a valid email address"),
    role: z.enum(["super_admin",
      "hospital_admin",
      "hr_manager",
      "payroll_officer",
      "unit_manager",
      "roster_officer",
      "registrar",
      "records_officer",
      "cashier",
      "accounts",
      "billing_officer",
      "doctor",
      "nurse",
      "midwife",
      "pharmacist",
      "pharmacy_tech",
      "lab_scientist",
      "radiographer",
      "radiologist",
      "store_keeper",
      "procurement_officer",
      "report_viewer",
      "auditor",
      "dpo",
      "staff",]),
    status: z.enum(["active", "inactive"]),
    image: z.string().url().nullable().optional(),
    imageCldPubId: z.string().nullable().optional(),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    const password = values.password?.trim() ?? "";
    const confirmPassword = values.confirmPassword?.trim() ?? "";

    if (!password && !confirmPassword) {
      return;
    }

    if (password.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must be at least 8 characters",
        path: ["password"],
      });
    }

    if (password !== confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }
  });

export type EditUserValues = z.infer<typeof editUserSchema>;