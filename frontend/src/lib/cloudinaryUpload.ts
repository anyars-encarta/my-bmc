import { API_URL } from "@/constants/app";

export type CloudinaryUploadResult = {
  secure_url: string;
  public_id: string;
};

/**
 * Uploads an image file to Cloudinary via the backend upload endpoint.
 * Returns the secure_url and public_id on success.
 */
export async function uploadToCloudinary(
  file: File,
  folder = "bmc",
): Promise<CloudinaryUploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/upload?folder=${encodeURIComponent(folder)}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(
      (error as { error?: string }).error ?? `Upload failed: ${response.status}`,
    );
  }

  const body = (await response.json()) as { data: CloudinaryUploadResult };
  return body.data;
}
