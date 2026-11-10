import type { AttendanceDevice } from "./db/schema/sprintReady.js";
import type { AppRole, StoredUserRole } from "./lib/appRoles.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      device?: AttendanceDevice;
      user?: {
        id?: string;
        email?: string;
        name?: string;
        role?: AppRole | null;
        roles?: AppRole[];
        legacyRole?: StoredUserRole;
      };
    }
  }
}

export {};