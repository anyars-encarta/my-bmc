import type { Request, Response, NextFunction } from "express";
import aj, { deviceAj } from "../config/arcjet.js";
import { ArcjetNodeRequest, slidingWindow } from "@arcjet/node";

const protectWithRateLimit = async (
  req: Request,
  res: Response,
  next: NextFunction,
  limit: number,
  message: string,
  rateLimitCode?: string,
  arcjetClient: typeof aj = aj,
) => {
  if (process.env.NODE_ENV === "test") return next();
  try {
    if (!arcjetClient) {
      // Arcjet key not configured — skip rate-limiting in non-production environments
      return next();
    }

    const client = arcjetClient.withRule(
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
        return res.status(429).json({
          error: "Too Many Requests",
          message,
          ...(rateLimitCode ? { code: rateLimitCode } : {}),
        });
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

export const devicePreAuthenticationRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
) => protectWithRateLimit(
  req,
  res,
  next,
  3000,
  "Device pre-authentication request limit exceeded (3000 per minute).",
  "DEVICE_PRE_AUTH_RATE_LIMITED",
  deviceAj,
);

const securityMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const roles = new Set<string>(req.user?.roles ?? []);
  if (req.user?.role) roles.add(req.user.role);
  if (roles.has("super_admin")) {
    return protectWithRateLimit(
      req,
      res,
      next,
      1000,
      "Admin request limit exceeded (1000 per minute). Slow down, admin! Please wait before making another request.",
    );
  }
  if (["accounts", "payroll_officer", "hr_manager", "unit_manager"].some((role) => roles.has(role))) {
    return protectWithRateLimit(
      req,
      res,
      next,
      200,
      "User request limit exceeded (200 per minute). Please wait before making another request.",
    );
  }
  const isGuest = roles.size === 0;
  return protectWithRateLimit(
    req,
    res,
    next,
    isGuest ? 20 : 120,
    isGuest
      ? "Guest request limit exceeded (20 per minute). Please sign up for higher limits or wait before making another request."
      : "User request limit exceeded (120 per minute). Please wait before making another request.",
  );
};

export default securityMiddleware;
