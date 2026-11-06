import type { AttendanceDevice } from "./db/schema/sprintReady.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      device?: AttendanceDevice;
      user?: {
        id?: string;
        email?: string;
        name?: string;
        role?: string | null;
        roles?: string[];
        legacyRole?: "admin" | "accounts";
      };
    }
  }
}

export {};