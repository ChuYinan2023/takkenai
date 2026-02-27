import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_TYPE_OPTIONS,
  getArticleTypeOption,
  getEnabledArticleTypes,
  getRecommendedArticleType,
  isArticleType,
  resolveArticleType,
} from "./article-type";

test("enabled article types defaults to 6 core types", () => {
  const enabled = getEnabledArticleTypes();
  assert.equal(enabled.length, 6);
  assert.ok(enabled.every((item) => getArticleTypeOption(item).core));
});

test("article type guards and resolver", () => {
  assert.equal(isArticleType("tool-ranking"), true);
  assert.equal(isArticleType("unknown"), false);
  assert.equal(resolveArticleType("how-to", "practical-guide"), "how-to");
  assert.equal(resolveArticleType("template-pack", "practical-guide"), "practical-guide");
});

test("recommended type depends on platform and asset", () => {
  assert.equal(getRecommendedArticleType("ameba", "tool"), "how-to");
  assert.equal(getRecommendedArticleType("note", "tool"), "competitor-compare");
  assert.equal(getRecommendedArticleType("hatena", "tool"), "tool-ranking");
  assert.equal(getRecommendedArticleType("note", "past-question"), "trend-analysis");
});

test("article type option definitions remain complete", () => {
  assert.ok(ARTICLE_TYPE_OPTIONS.length >= 8);
  const trend = getArticleTypeOption("trend-analysis");
  assert.ok(trend.mustHave.some((item) => item.includes("年份") || item.includes("年")));
});
