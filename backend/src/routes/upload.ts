import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { cloudinary } from "../lib/cloudinary.js";

const router = Router();

// Store file in memory so we can stream it to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are accepted"));
      return;
    }
    cb(null, true);
  },
});

router.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const folder = (req.query.folder as string | undefined) ?? "bmc";

      const result = await new Promise<{ secure_url: string; public_id: string }>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder,
              resource_type: "image",
              overwrite: true,
              transformation: [{ quality: "auto", fetch_format: "auto" }],
            },
            (error, result) => {
              if (error || !result) {
                reject(error ?? new Error("Upload failed"));
                return;
              }
              resolve({ secure_url: result.secure_url, public_id: result.public_id });
            },
          );
          stream.end(req.file!.buffer);
        },
      );

      res.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
