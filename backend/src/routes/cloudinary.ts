import express from "express";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn("Cloudinary environment variables are not fully set. Cloudinary routes will not work.");
};

// Configure Cloudinary (should be in your environment variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
  api_key: process.env.CLOUDINARY_API_KEY || "",
  api_secret: process.env.CLOUDINARY_API_SECRET || "",
});

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Cloudinary API is working",
  });
});

router.post("/delete", async (req, res) => {
  try {
    const { publicId } = req.body as { publicId?: string };

    if (!publicId) {
      return res.status(400).json({
        success: false,
        error: "publicId is required",
      });
    }

    // Delete image from Cloudinary
    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === "ok") {
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