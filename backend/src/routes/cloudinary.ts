import express from "express";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { user } from "../db/schema/index.js";
import { cloudinary } from "../lib/cloudinary.js";

const router = express.Router();

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_./-]{1,255}$/;

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Cloudinary API is working",
  });
});

router.post("/delete", async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const { publicId } = req.body as { publicId?: string };
    const normalizedPublicId = typeof publicId === "string" ? publicId.trim() : "";

    if (!normalizedPublicId) {
      return res.status(400).json({
        success: false,
        error: "publicId is required",
      });
    }

    if (!PUBLIC_ID_PATTERN.test(normalizedPublicId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid publicId format",
      });
    }

    const [actor] = await db
      .select({ id: user.id, role: user.role, imageCldPubId: user.imageCldPubId })
      .from(user)
      .where(eq(user.id, req.user.id))
      .limit(1);

    if (!actor) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const canDeleteAny = actor.role === "admin";
    const ownsImage = actor.imageCldPubId === normalizedPublicId;

    if (!canDeleteAny && !ownsImage) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
      });
    }

    // Delete image from Cloudinary
    const result = await cloudinary.uploader.destroy(normalizedPublicId);

    if (result.result === "ok") {
      if (actor.imageCldPubId === normalizedPublicId) {
        await db
          .update(user)
          .set({ imageCldPubId: null, updatedAt: new Date() })
          .where(eq(user.id, actor.id));
      }

      return res.status(200).json({
        success: true,
        message: "Image deleted successfully",
        result,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "Failed to delete image",
        result,
      });
    }
  } catch (error) {
    console.error("Error deleting image:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;