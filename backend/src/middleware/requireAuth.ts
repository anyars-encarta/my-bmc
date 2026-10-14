import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";

import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { user } from "../db/schema/index.js";
import { loadUserRoles } from "../lib/platform.js";
import { forbidden, unauthorized } from "../lib/errors.js";

const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      throw unauthorized("You must be logged in to access this resource.");
    }

    const [currentUser] = await db
      .select({ status: user.status, role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    if (!currentUser || currentUser.status === "inactive") {
      throw forbidden("Your account is inactive. Contact an administrator.", "ACCOUNT_INACTIVE");
    }

    const roles = await loadUserRoles(session.user.id, currentUser.role);

    req.user = {
      id: session.user.id,
      email: session.user.email,
      role: roles[0] ?? null,
      roles,
      legacyRole: currentUser.role,
      name: session.user.name,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export default requireAuth;