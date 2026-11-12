import type { ReactNode } from "react";

import type { AppRole } from "./auth";

export type MetricCardProps = {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
};

export type UploadWidgetValue = {
  url: string;
  publicId?: string | null;
  signature?: string;
  version?: number;
};

export type UserRole = AppRole;
export type UserStatus = "active" | "inactive";

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  imageCldPubId?: string | null;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
};