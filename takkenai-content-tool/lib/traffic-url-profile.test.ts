import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTakkenaiUrlFromPath,
  canonicalizeTakkenaiPath,
  choosePreferredTierForSlot,
  clearTrafficUrlProfileCache,
  loadTrafficUrlProfile,
  pickTrafficUrlForSlot,
} from "./traffic-url-profile";

test("canonicalize path should normalize slash/query/hash", () => {
  assert.equal(
    canonicalizeTakkenaiPath("https://takkenai.jp/tools/loan/?utm=x#top"),
    "/tools/loan"
  );
  assert.equal(canonicalizeTakkenaiPath("/tools/loan/"), "/tools/loan");
  assert.equal(canonicalizeTakkenaiPath("tools/loan"), "/tools/loan");
  assert.equal(canonicalizeTakkenaiPath("https://example.com/tools/loan"), "");
  assert.equal(buildTakkenaiUrlFromPath("/tools/loan/"), "https://takkenai.jp/tools/loan");
});

test("traffic profile should load and include cooldown entries for high-bounce pages", () => {
  clearTrafficUrlProfileCache();
  const profile = loadTrafficUrlProfile();
  assert.ok(profile, "traffic profile should be loaded");
  const shohiyo = profile?.items.find((item) => item.path === "/tools/shohiyo");
  assert.ok(shohiyo, "shohiyo item should exist");
  assert.equal(shohiyo?.tier, "cooldown");
});

test("pickTrafficUrlForSlot should be deterministic and respect exclusions", () => {
  clearTrafficUrlProfileCache();
  const profile = loadTrafficUrlProfile();
  assert.ok(profile, "traffic profile should be loaded");
  if (!profile) return;

  const first = pickTrafficUrlForSlot({
    profile,
    date: "2026-02-26",
    platform: "ameba",
    group: "tool",
    preferredTier: "high",
    seedSalt: 3,
  });
  const second = pickTrafficUrlForSlot({
    profile,
    date: "2026-02-26",
    platform: "ameba",
    group: "tool",
    preferredTier: "high",
    seedSalt: 3,
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(first?.path, second?.path);

  const excluded = new Set([first?.path || ""]);
  const third = pickTrafficUrlForSlot({
    profile,
    date: "2026-02-26",
    platform: "ameba",
    group: "tool",
    preferredTier: "high",
    seedSalt: 3,
    excludeCanonicalPaths: excluded,
  });
  assert.ok(third);
  assert.notEqual(third?.path, first?.path);
});

test("choosePreferredTierForSlot should keep deterministic output by seed", () => {
  const a = choosePreferredTierForSlot({
    date: "2026-02-26",
    platform: "note",
    seedSalt: 11,
  });
  const b = choosePreferredTierForSlot({
    date: "2026-02-26",
    platform: "note",
    seedSalt: 11,
  });
  assert.equal(a, b);
});
