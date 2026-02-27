import assert from "node:assert/strict";
import test from "node:test";
import { getStylePackStyles, resolveCoverProfile } from "./cover-profile";

test("jp-classic-v2 should expose 13 styles", () => {
  const styles = getStylePackStyles("jp-classic-v2");
  assert.equal(styles.length, 13);
  assert.ok(styles.includes("interview_jp_clean"));
});

test("na-lowtext-v2 should keep low-text subset", () => {
  const styles = getStylePackStyles("na-lowtext-v2");
  assert.ok(styles.length >= 5);
  assert.ok(styles.includes("note_minimal_bold"));
  assert.ok(styles.includes("editorial_white"));
});

test("legacy jp-classic-v1 should remain usable", () => {
  const styles = getStylePackStyles("jp-classic-v1");
  assert.ok(styles.length >= 1);
  assert.ok(styles.includes("lecture_blue"));
});

test("resolveCoverProfile should accept legacy pack and return selectable style", () => {
  const resolved = resolveCoverProfile({
    platform: "note",
    profile: {
      region: "jp",
      stylePack: "jp-classic-v1",
      textDensity: "medium",
      styleId: "lecture_blue",
    },
  });

  assert.equal(resolved.stylePack, "jp-classic-v1");
  assert.ok(resolved.availableStyles.includes(resolved.styleId));
});
