import type { ReactNode } from "react";

export type MetricCardProps = {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
};

export type UploadWidgetValue = {
  url: string;
  publicId?: string | null;
};

export type UserRole = "admin" | "accounts";
export type UserStatus = "active" | "inactive";

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  imageCldPubId?: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
};