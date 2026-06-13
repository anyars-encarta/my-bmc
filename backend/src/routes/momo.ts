import { Router } from "express";

import { MomoApiError, MomoConfigError, getMomoBalance } from "../lib/momo.js";

const router = Router();

router.get("/balance", async (_req, res, next) => {
  try {
    const balance = await getMomoBalance();
    res.json({ data: balance });
  } catch (error) {
    if (error instanceof MomoConfigError || error instanceof MomoApiError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    next(error);
  }
});

export default router;
