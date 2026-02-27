import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";
import path from "path";
import {
  COVER_STYLE_IDS,
  COVER_STYLE_OPTIONS,
  getCoverStylesByPlatform,
} from "./cover-style";

test("cover style registry should contain 13 unique style ids", () => {
  assert.equal(COVER_STYLE_IDS.length, 13);
  assert.equal(new Set(COVER_STYLE_IDS).size, 13);
  assert.equal(COVER_STYLE_OPTIONS.length, 13);
});

test("cover style preview assets should exist", () => {
  for (const style of COVER_STYLE_OPTIONS) {
    const relative = style.previewImage.replace(/^\//, "");
    const absPath = path.join(process.cwd(), "public", relative);
    assert.ok(fs.existsSync(absPath), `missing preview image: ${style.previewImage}`);
  }
});

test("platform sorted styles should prioritize recommended style on top", () => {
  const ameba = getCoverStylesByPlatform("ameba");
  const note = getCoverStylesByPlatform("note");
  const hatena = getCoverStylesByPlatform("hatena");

  assert.equal(ameba.length, 13);
  assert.equal(note.length, 13);
  assert.equal(hatena.length, 13);

  assert.equal(ameba[0].id, "real_photo_clean");
  assert.equal(note[0].id, "note_minimal_bold");
  assert.equal(hatena[0].id, "editorial_white");
  assert.ok(ameba.some((item) => item.id === "interview_jp_clean"));
  assert.ok(note.some((item) => item.id === "interview_jp_clean"));
  assert.ok(hatena.some((item) => item.id === "interview_jp_clean"));

  assert.equal(new Set(ameba.map((s) => s.id)).size, 13);
  assert.equal(new Set(note.map((s) => s.id)).size, 13);
  assert.equal(new Set(hatena.map((s) => s.id)).size, 13);
});
