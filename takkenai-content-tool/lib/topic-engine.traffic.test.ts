import assert from "node:assert/strict";
import test from "node:test";
import { generateDayTopics } from "./topic-engine";
import {
  canonicalizeTakkenaiPath,
  clearTrafficUrlProfileCache,
} from "./traffic-url-profile";

function shiftDate(start: string, offset: number): string {
  const date = new Date(`${start}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

test("traffic allocator should keep unique urls per day across 3 platforms", () => {
  clearTrafficUrlProfileCache();
  for (let i = 0; i < 60; i++) {
    const date = shiftDate("2026-02-01", i);
    const topics = generateDayTopics(date);
    const paths = [
      canonicalizeTakkenaiPath(topics.motherTopics.ameba.takkenaiUrl),
      canonicalizeTakkenaiPath(topics.motherTopics.note.takkenaiUrl),
      canonicalizeTakkenaiPath(topics.motherTopics.hatena.takkenaiUrl),
    ];
    assert.equal(new Set(paths).size, 3, `${date} has duplicate URL paths: ${paths.join(", ")}`);
  }
});

test("traffic allocator should roughly follow 70/30 high-explore split", () => {
  clearTrafficUrlProfileCache();
  let high = 0;
  let explore = 0;
  let total = 0;

  for (let i = 0; i < 60; i++) {
    const date = shiftDate("2026-02-01", i);
    const topics = generateDayTopics(date);
    for (const platform of ["ameba", "note", "hatena"] as const) {
      const tier = topics.motherTopics[platform].urlTier;
      if (!tier) continue;
      total += 1;
      if (tier === "high") high += 1;
      if (tier === "explore") explore += 1;
    }
  }

  assert.ok(total > 0, "url tier should be present");
  const highRatio = high / total;
  assert.ok(
    highRatio >= 0.55 && highRatio <= 0.85,
    `high ratio out of expected range: ${highRatio.toFixed(3)}`
  );
  assert.ok(explore > 0, "explore tier should still appear");
});

test("url-direct mode should provide a topicLabelOverride", () => {
  clearTrafficUrlProfileCache();
  let directCount = 0;
  for (let i = 0; i < 180; i++) {
    const date = shiftDate("2026-01-01", i);
    const topics = generateDayTopics(date);
    for (const platform of ["ameba", "note", "hatena"] as const) {
      const topic = topics.motherTopics[platform];
      if (topic.urlSelectionMode !== "url-direct") continue;
      directCount += 1;
      assert.ok(
        String(topic.topicLabelOverride || "").trim().length > 0,
        `url-direct topic missing label on ${date}/${platform}`
      );
    }
  }
  assert.ok(directCount > 0, "expected at least one url-direct selection");
});

test("missing traffic profile should fallback without throwing", () => {
  const prev = process.env.TRAFFIC_URL_PROFILE_FILE;
  process.env.TRAFFIC_URL_PROFILE_FILE = "/tmp/traffic-url-profile-not-exists.json";
  clearTrafficUrlProfileCache();

  try {
    const topics = generateDayTopics("2026-02-26");
    assert.ok(topics.motherTopics.ameba.takkenaiUrl);
    assert.ok(topics.motherTopics.note.takkenaiUrl);
    assert.ok(topics.motherTopics.hatena.takkenaiUrl);
  } finally {
    if (prev === undefined) {
      delete process.env.TRAFFIC_URL_PROFILE_FILE;
    } else {
      process.env.TRAFFIC_URL_PROFILE_FILE = prev;
    }
    clearTrafficUrlProfileCache();
  }
});
