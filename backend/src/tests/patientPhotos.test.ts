import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { isTrustedPatientPhotoUpload, publicIdFromCloudinaryUrl } from "../lib/patientPhotos.js";

const cloudName = "facility-cloud";
const apiSecret = "test-api-secret";
const patientId = "patient-123";
const version = 1794413500;
const publicId = `patients/${patientId}/photo`;
const photoUrl = `https://res.cloudinary.com/${cloudName}/image/upload/v${version}/${publicId}.jpg`;
const signature = createHash("sha1").update(`public_id=${publicId}&version=${version}${apiSecret}`).digest("hex");

const trustedUpload = (overrides: Partial<Parameters<typeof isTrustedPatientPhotoUpload>[0]> = {}) =>
  isTrustedPatientPhotoUpload({
    photoUrl,
    photoPublicId: publicId,
    patientId,
    cloudName,
    apiSecret,
    signature,
    version,
    ...overrides,
  });

test("Cloudinary photo URL parsing requires a canonical secure upload URL", () => {
  assert.equal(publicIdFromCloudinaryUrl(photoUrl), publicId);
  assert.equal(publicIdFromCloudinaryUrl(photoUrl.replace("res.cloudinary.com", "elsewhere.example")), null);
  assert.equal(publicIdFromCloudinaryUrl(photoUrl.replace("https:", "http:")), null);
});

test("patient photo uploads require the configured account and a valid signed version", () => {
  assert.equal(trustedUpload(), true);
  assert.equal(trustedUpload({ cloudName: "another-cloud" }), false);
  assert.equal(trustedUpload({ photoPublicId: "patients/another-patient/photo" }), false);
  assert.equal(trustedUpload({ signature: "0".repeat(40) }), false);
  assert.equal(trustedUpload({ version: version + 1 }), false);
  assert.equal(trustedUpload({ photoUrl: photoUrl.replace(`v${version}`, `v${version + 1}`) }), false);
  assert.equal(trustedUpload({ apiSecret: undefined }), false);
});
