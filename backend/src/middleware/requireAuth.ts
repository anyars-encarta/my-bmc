import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";

import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { user } from "../db/schema/index.js";

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
      return res.status(401).json({
        error: "Unauthorized",
        message: "You must be logged in to access this resource.",
      });
    }

    const [currentUser] = await db
      .select({ status: user.status, role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    if (!currentUser || currentUser.status === "inactive") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Your account is inactive. Contact an administrator.",
      });
    }

    if (currentUser.role !== "admin" && currentUser.role !== "accounts") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Your account role is not recognized.",
      });
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      role: currentUser.role,
      name: session.user.name,
    };

    next();
  } catch (error) {
    console.error("Authentication middleware error:", error);
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired session. Please log in again.",
    });
  }
};

export default requireAuth;