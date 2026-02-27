import test from "node:test";
import assert from "node:assert/strict";
import {
  getGeneratedContentFilename,
  getGeneratedImagePrefix,
  resolveContentKey,
  type ContentKey,
} from "./content-variant";

test("resolveContentKey keeps note-viral only for note platform", () => {
  assert.equal(resolveContentKey("note", "note-viral"), "note-viral");
  assert.equal(resolveContentKey("note", "standard"), "standard");
  assert.equal(resolveContentKey("note", "unknown"), "standard");
  assert.equal(resolveContentKey("ameba", "note-viral"), "standard");
  assert.equal(resolveContentKey("hatena", "note-viral"), "standard");
});

test("generated content file name keeps note-viral variant isolated", () => {
  assert.equal(
    getGeneratedContentFilename("2026-02-20", "note", "standard"),
    "2026-02-20-note.json"
  );
  assert.equal(
    getGeneratedContentFilename("2026-02-20", "note", "note-viral"),
    "2026-02-20-note-viral.json"
  );
});

test("generated image prefix is isolated by content key", () => {
  const standard: ContentKey = "standard";
  const viral: ContentKey = "note-viral";
  assert.equal(
    getGeneratedImagePrefix("2026-02-20", "note", "cover", standard),
    "2026-02-20-note-cover"
  );
  assert.equal(
    getGeneratedImagePrefix("2026-02-20", "note", "cover", viral),
    "2026-02-20-note-viral-cover"
  );
  assert.equal(
    getGeneratedImagePrefix("2026-02-20", "note", "inline", viral),
    "2026-02-20-note-viral-inline"
  );
});
