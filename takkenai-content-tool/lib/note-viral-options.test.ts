import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackNoteViralOptions,
  dedupeNoteViralOptions,
  NOTE_VIRAL_OPTION_LIMIT,
  normalizeNoteViralOption,
} from "./note-viral-options";

test("fallback note viral options should always return fixed count", () => {
  const options = buildFallbackNoteViralOptions("2026-02-20");
  assert.equal(options.length, NOTE_VIRAL_OPTION_LIMIT);
  assert.equal(new Set(options.map((item) => item.id)).size, options.length);
});

test("normalize note viral option rejects non-note urls", () => {
  const option = normalizeNoteViralOption(
    {
      sourceType: "competitor",
      sourceAccount: "abc",
      sourceUrl: "https://example.com/post",
      title: "タイトル",
      hotReason: "理由",
      viralPattern: "型",
      fitReason: "適合理由",
    },
    0,
    "2026-02-20T00:00:00.000Z"
  );

  assert.ok(option);
  assert.equal(option?.sourceUrl.includes("note.com"), true);
});

test("dedupe should remove same title+url duplicates", () => {
  const base = buildFallbackNoteViralOptions("2026-02-20");
  const duplicated = [base[0], base[0], base[1]];
  const deduped = dedupeNoteViralOptions(duplicated);
  assert.equal(deduped.length, 2);
});
