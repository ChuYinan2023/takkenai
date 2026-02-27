import assert from "node:assert/strict";
import test from "node:test";
import { resolveTopicLabelOverrideByPriority } from "./topic-label-priority";

test("topicLabelOverride priority: user > note-viral > mother-topic", () => {
  const label = resolveTopicLabelOverrideByPriority({
    userOverrideLabel: "ユーザー指定ラベル",
    noteViralLabel: "爆款ラベル",
    motherTopicLabel: "母題ラベル",
  });
  assert.equal(label, "ユーザー指定ラベル");
});

test("topicLabelOverride priority: note-viral > mother-topic", () => {
  const label = resolveTopicLabelOverrideByPriority({
    noteViralLabel: "爆款ラベル",
    motherTopicLabel: "母題ラベル",
  });
  assert.equal(label, "爆款ラベル");
});

test("topicLabelOverride fallback to mother-topic", () => {
  const label = resolveTopicLabelOverrideByPriority({
    motherTopicLabel: "母題ラベル",
  });
  assert.equal(label, "母題ラベル");
});
