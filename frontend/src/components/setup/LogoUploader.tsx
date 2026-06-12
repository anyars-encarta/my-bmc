import { uploadToCloudinary } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";
import { Building2, ImageUp, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";

type LogoUploaderProps = {
  value?: string;
  onChange: (url: string) => void;
  className?: string;
};

export function LogoUploader({ value, onChange, className }: LogoUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);

    try {
      const result = await uploadToCloudinary(file, "bmc/logos");
      onChange(result.secure_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleClear = () => {
    onChange("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={isUploading}
      />

      {/* Preview / Drop-zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload facility logo"
        onClick={() => !isUploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2",
          "h-36 w-full rounded-lg border-2 border-dashed",
          "cursor-pointer select-none transition-colors",
          "hover:border-primary hover:bg-muted/50",
          isUploading && "pointer-events-none opacity-60",
          !value && "bg-muted/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {isUploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Uploading…</p>
          </>
        ) : value ? (
          <>
            <img
              src={value}
              alt="Facility logo"
              className="h-24 w-auto max-w-full rounded object-contain"
            />
            <p className="text-xs text-muted-foreground">Click to replace</p>
          </>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <ImageUp className="h-4 w-4" />
              <span>Click to upload logo</span>
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG, WEBP · max 5 MB</p>
          </>
        )}
      </div>

      {/* Clear button */}
      {value && !isUploading && (
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Remove logo
        </button>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs font-medium text-destructive">{error}</p>
      )}
    </div>
  );
}
