import {
  BACKEND_BASE_URL,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
} from "@/constants/index";
import { UploadWidgetValue } from "@/types/index";
import { UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const UploadWidget = ({
  value = null,
  onChange,
  disabled = false,
  folder = "uploads",
}: {
  value: UploadWidgetValue | null;
  onChange: (value: UploadWidgetValue | null) => void;
  disabled?: boolean;
  folder?: string;
}) => {
  const widgetRef = useRef<CloudinaryWidget | null>(null);
  const onChangeRef = useRef(onChange);

  const [preview, setPreview] = useState<UploadWidgetValue | null>(value);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [deleteToken, setDeleteToken] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    setPreview(value);
    const normalizedPublicId = value?.publicId?.trim() ?? "";
    setPublicId(normalizedPublicId || null);
    // Delete tokens are only returned immediately after upload.
    // Reset when parent value is rehydrated from API.
    setDeleteToken(null);
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    widgetRef.current = null;

    const initializeWidget = () => {
      if (!window.cloudinary || widgetRef.current) return false;

      widgetRef.current = window.cloudinary.createUploadWidget(
        {
          cloud_name: CLOUDINARY_CLOUD_NAME,
          upload_preset: CLOUDINARY_UPLOAD_PRESET,
          multiple: false,
          folder,
          maxFileSize: 5 * 1024 * 1024, // 5MB
          clientAllowedFormats: ["png", "jpg", "jpeg", "webp"],
          sources: ["local", "url", "camera", "google_drive", "dropbox"],
          return_delete_token: true,
        },
        (error, result) => {
          if (!error && result.event === "success") {
            const maybeDeleteToken =
              result.info && typeof result.info.delete_token === "string"
                ? result.info.delete_token.trim()
                : "";

            const payload: UploadWidgetValue = {
              url: result.info.secure_url,
              publicId: result.info.public_id,
            };

            setPreview(payload);
            setPublicId(result.info.public_id);
            setDeleteToken(maybeDeleteToken || null);
            onChangeRef.current?.(payload);
          }
        },
      );

      return true;
    };

    if (initializeWidget()) return;

    const intervalId = window.setInterval(() => {
      if (initializeWidget()) {
        window.clearInterval(intervalId);
      }
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [folder]);

  const openWidget = () => {
    if (!disabled) widgetRef.current?.open();
  };

  const removeFromCloudinary = async () => {
    if (disabled || isRemoving || !preview) {
      return;
    }

    // Some existing records may not have a stored Cloudinary public id.
    // In that case, still clear the form value so users can remove the image.
    if (!publicId) {
      setPreview(null);
      onChangeRef.current?.(null);
      return;
    }

    try {
      setIsRemoving(true);

      if (deleteToken) {
        const tokenResponse = await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(
            CLOUDINARY_CLOUD_NAME,
          )}/delete_by_token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ token: deleteToken }).toString(),
          },
        );

        if (tokenResponse.ok) {
          setDeleteToken(null);
          setPublicId(null);
          setPreview(null);
          onChangeRef.current?.(null);
          return;
        }
      }

      const response = await fetch(`${BACKEND_BASE_URL.replace(/\/$/, "")}/cloudinary/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ publicId }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        if (response.status === 401 || response.status === 403) {
          // Public admissions users may not have API auth cookies.
          // Clear local form value so they can continue even if remote delete is blocked.
          setDeleteToken(null);
          setPublicId(null);
          setPreview(null);
          onChangeRef.current?.(null);
          return;
        }

        throw new Error(payload?.error || "Failed to delete image from Cloudinary");
      }

      setDeleteToken(null);
      setPublicId(null);
      setPreview(null);
      onChangeRef.current?.(null);
    } catch (error) {
      console.error("Error deleting image:", error);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="space-y-2">
      {preview ? (
        <div className="upload-preview">
          <img
            src={preview.url}
            alt="Uploaded file"
          />
          {!isRemoving && (
            <button
              type="button"
              onClick={removeFromCloudinary}
              aria-label="Remove uploaded image"
              disabled={isRemoving || disabled}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Remove image</span>
            </button>
          )}
        
          {isRemoving && <span>Removing image...</span>}
        </div>
      ) : (
        <div
          className="upload-dropzone"
          role="button"
          tabIndex={0}
          onClick={openWidget}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              openWidget();
            }
          }}
        >
          <div className="upload-prompt">
            <UploadCloud className="icon" />
            <div>
              <p>Click to upload photo</p>
              <p>PNG, JPG, JPEG up to 5MB</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadWidget;
