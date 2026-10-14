import { Router } from "express";

import { notFound } from "../../lib/errors.js";
import { loadMePayload } from "../../lib/platform.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    if (!req.user?.id || !req.user.legacyRole) {
      throw notFound("Current user was not found.", "USER_NOT_FOUND");
    }

    const payload = await loadMePayload(req.user.id, req.user.legacyRole);
    if (!payload) {
      throw notFound("Current user was not found.", "USER_NOT_FOUND");
    }

    res.json({ data: payload });
  } catch (error) {
    next(error);
  }
});

export default router;
