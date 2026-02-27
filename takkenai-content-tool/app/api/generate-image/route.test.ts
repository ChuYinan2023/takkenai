import assert from "node:assert/strict";
import test from "node:test";
import { buildCoverApiResponse } from "../../../lib/generate-image-response";
import type { CoverImageResult } from "../../../lib/cover-image";

function makeCoverResult(status: CoverImageResult["qualityCheck"]): CoverImageResult {
  return {
    imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
    mimeType: "image/jpeg",
    ext: "jpg",
    qualityCheck: status,
    qualityIssues: status === "pass" ? [] : ["text-clipped"],
    textAdjusted: status === "retry_pass",
  };
}

test("build cover api response should include pass quality metadata", () => {
  const payload = buildCoverApiResponse({
    filename: "2026-02-20-note-cover-note_minimal_bold-aaa.jpg",
    coverResult: makeCoverResult("pass"),
    styleId: "note_minimal_bold",
    stylePack: "jp-classic-v2",
    textDensity: "medium",
    region: "jp",
    siteId: "takkenai-jp",
    mode: "promote",
  });

  assert.equal(payload.qualityCheck, "pass");
  assert.equal(payload.textAdjusted, false);
  assert.equal(payload.mimeType, "image/jpeg");
});

test("build cover api response should include retry_pass metadata", () => {
  const payload = buildCoverApiResponse({
    filename: "2026-02-20-ameba-cover-real_photo_clean-bbb.jpg",
    coverResult: makeCoverResult("retry_pass"),
    styleId: "real_photo_clean",
    stylePack: "jp-classic-v2",
    textDensity: "medium",
    region: "jp",
    siteId: "takkenai-jp",
    mode: "promote",
  });

  assert.equal(payload.qualityCheck, "retry_pass");
  assert.equal(payload.textAdjusted, true);
  assert.ok(Array.isArray(payload.qualityIssues));
});

test("build cover api response should propagate failed quality state", () => {
  const payload = buildCoverApiResponse({
    filename: "2026-02-20-hatena-cover-editorial_white-ccc.jpg",
    coverResult: makeCoverResult("failed"),
    styleId: "editorial_white",
    stylePack: "jp-classic-v2",
    textDensity: "medium",
    region: "jp",
    siteId: "takkenai-jp",
    mode: "promote",
  });

  assert.equal(payload.qualityCheck, "failed");
  assert.equal(payload.qualityIssues?.[0], "text-clipped");
});
