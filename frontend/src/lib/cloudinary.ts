import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_URL } from "@/constants/index";
import { Cloudinary } from "@cloudinary/url-gen";
import { dpr, format, quality } from "@cloudinary/url-gen/actions/delivery";
import { source } from "@cloudinary/url-gen/actions/overlay";
import { fill } from "@cloudinary/url-gen/actions/resize";
import { Position } from "@cloudinary/url-gen/qualifiers";
import { compass } from "@cloudinary/url-gen/qualifiers/gravity";
import { text } from "@cloudinary/url-gen/qualifiers/source";
import { TextStyle } from "@cloudinary/url-gen/qualifiers/textStyle";

const cld = new Cloudinary({
  cloud: {
    cloudName: CLOUDINARY_CLOUD_NAME,
  },
});

export async function uploadToCloudinary(file: File, folder: string) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", folder);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    const response = await fetch(CLOUDINARY_UPLOAD_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("Failed to upload image to Cloudinary");
    }

    return response.json() as Promise<{ secure_url: string; public_id: string }>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Cloudinary upload timed out. Please try again.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const bannerPhoto = (bannerCldPubId: string, name: string) => {
  return cld
    .image(bannerCldPubId)
    .resize(fill())
    .delivery(format("auto"))
    .delivery(quality("auto"))
    .delivery(dpr("auto"))
    .overlay(
      source(
        text(name, new TextStyle("roboto", 100).fontWeight("bold")).textColor(
          "white",
        ),
      ).position(
        new Position()
          .gravity(compass("west"))
        //   .offsetY(0.2)
          .offsetX(0.02),
      ),
    );
};
