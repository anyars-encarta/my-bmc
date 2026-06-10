import { z } from "zod";

export const editUserSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Enter a valid email address"),
    role: z.enum(["admin", "accounts"]),
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