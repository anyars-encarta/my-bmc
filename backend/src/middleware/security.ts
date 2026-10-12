import type { Request, Response, NextFunction } from "express";
import aj from "../config/arcjet.js";
import { ArcjetNodeRequest, slidingWindow } from "@arcjet/node";

const securityMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (process.env.NODE_ENV === "test") return next();

  try {
    const role: RateLimitRole = req.user?.role || "guest";

    let limit: number;
    let message: string;

    switch (role) {
      case "admin":
        limit = 1000;
        message =
          "Admin request limit exceeded (1000 per minute). Slow down, admin! Please wait before making another request.";
        break;
      case "accounts":
        limit = 200;
        message =
          "User request limit exceeded (200 per minute). Please wait before making another request.";
        break;
      default:
        limit = 20;
        message =
          "Guest request limit exceeded (20 per minute). Please sign up for higher limits or wait before making another request.";
        break;
    }

    if (!aj) {
      // Arcjet key not configured — skip rate-limiting in non-production environments
      return next();
    }

    const client = aj.withRule(
      slidingWindow({
        mode: "LIVE",
        interval: "1m",
        max: limit,
      }),
    );

    const arcjetRequest: ArcjetNodeRequest = {
      headers: req.headers,
      method: req.method,
      url: req.originalUrl ?? req.url,
      socket: {
        remoteAddress: req.socket.remoteAddress ?? req.ip ?? "0.0.0.0",
      },
    };

    const decision = await client.protect(arcjetRequest);

    if (decision?.isDenied()) {
      if (decision.reason.isBot()) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Automated requests are not allowed",
        });
      }
      if (decision.reason.isShield()) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Request blocked by security policy.",
        });
      }
      if (decision.reason.isRateLimit()) {
        return res.status(429).json({ error: "Too many requests", message });
      }

      return res.status(403).json({
        error: "Forbidden",
        message: "Request denied by security policy.",
      });
    }

    next();
  } catch (e) {
    console.error("Arcjet Middleware error: ", e);
    next(e);
  }
};

export default securityMiddleware;
