import { createHash, timingSafeEqual } from "node:crypto";

/** Extracts the Cloudinary public ID from a canonical image upload URL. */
export const publicIdFromCloudinaryUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "res.cloudinary.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }

  const segments = url.pathname.split("/");
  const uploadIndex = segments.findIndex((segment, index) => segment === "upload" && segments[index - 1] === "image");
  if (uploadIndex < 0) return null;
  const uploadSegments = segments.slice(uploadIndex + 1);
  const versionIndex = uploadSegments.findIndex((segment) => /^v\d+$/.test(segment));
  if (versionIndex >= 0) uploadSegments.splice(0, versionIndex + 1);
  else if (uploadSegments[0]?.startsWith("s--")) uploadSegments.shift();
  const last = uploadSegments.pop();
  if (!last) return null;
  const file = last.replace(/\.[^.]+$/, "");
  return [...uploadSegments, file].join("/");
};

/** Verifies patient folder ownership and Cloudinary's signed upload response. */
export const isTrustedPatientPhotoUpload = ({
  photoUrl,
  photoPublicId,
  patientId,
  cloudName,
  apiSecret,
  signature,
  version,
}: {
  photoUrl: string;
  photoPublicId: string | null;
  patientId: string;
  cloudName: string | undefined;
  apiSecret: string | undefined;
  signature: string | null;
  version: number | null;
}) => {
  if (
    !cloudName ||
    !apiSecret ||
    !photoPublicId?.startsWith(`patients/${patientId}/`) ||
    publicIdFromCloudinaryUrl(photoUrl) !== photoPublicId ||
    !signature ||
    !/^[a-f\d]{40}$/i.test(signature) ||
    !version ||
    !Number.isSafeInteger(version)
  ) {
    return false;
  }

  const url = new URL(photoUrl);
  const segments = url.pathname.split("/");
  if (segments[1] !== cloudName || segments[2] !== "image" || segments[3] !== "upload") return false;
  const pathVersion = segments.slice(4).find((segment) => /^v\d+$/.test(segment))?.slice(1);
  if (pathVersion !== String(version)) return false;

  const expected = Buffer.from(
    createHash("sha1").update(`public_id=${photoPublicId}&version=${version}${apiSecret}`).digest("hex"),
    "hex",
  );
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
};
