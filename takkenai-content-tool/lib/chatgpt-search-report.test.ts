import test from "node:test";
import assert from "node:assert/strict";

import { evaluateChatgptSearchRules } from "./chatgpt-search-report";

test("high-quality body should pass ChatGPT Search gate", () => {
  const body = [
    "先に結論です。固定資産税は「定義→要件→例外」の順で整理すると判断ミスを減らせます。",
    "## 固定資産税とは",
    "固定資産税とは、土地・建物に課される地方税です。",
    "## 実務での確認手順",
    "- 課税対象を確認する",
    "- 課税標準額を確認する",
    "- 特例適用の有無を確認する",
    "国土交通省（2025年）では、住宅ストック関連の統計で対象件数が約620万件と公表されています。",
    "総務省（令和6年度）の公表では、固定資産税の税収が前年比2.1%増と示されています。",
    "この手順を固定すると、担当者間の判断ばらつきが小さくなります。",
    "例外条件は先に一覧化しておくと、繁忙期でも確認漏れを減らせます。",
    "## FAQ",
    "Q: まず何を覚えるべきですか？",
    "A: 定義と課税対象の範囲を最初に押さえるのが有効です。",
    "Q: 実務で迷ったときは？",
    "A: 根拠資料と例外条件を同時に確認してください。",
  ].join("\n");

  const report = evaluateChatgptSearchRules({
    platform: "note",
    title: "固定資産税の実務判断を安定させる方法",
    body,
    seoTitle: "固定資産税の確認手順",
  });

  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.ok(report.score >= 85, `score=${report.score}`);
  assert.equal(report.signals.sourceFactCount >= 2, true);
});

test("missing source facts should fail", () => {
  const body = [
    "先に答えます。学習は順番が大事です。",
    "## 用語定義",
    "固定資産税とは地方税です。",
    "## 手順",
    "- 手順1",
    "- 手順2",
    "## FAQ",
    "Q: 何から始める？",
    "A: 定義からです。",
    "Q: どう復習する？",
    "A: 毎日短く反復します。",
  ].join("\n");

  const report = evaluateChatgptSearchRules({
    platform: "hatena",
    title: "固定資産税の基礎",
    body,
  });

  assert.equal(report.passed, false);
  assert.ok(report.issues.some((item) => item.includes("机构+年份+数值")), report.issues.join("\n"));
});

test("historical year without citation context should fail freshness", () => {
  const body = [
    "結論として、手順を固定すればミスを減らせます。",
    "## 定義",
    "固定資産税とは地方税です。",
    "2025年に制度が変わりました。",
    "## FAQ",
    "Q: 何から確認する？",
    "A: 定義から確認します。",
  ].join("\n");

  const report = evaluateChatgptSearchRules({
    platform: "ameba",
    title: "固定資産税の確認ポイント",
    body,
  });

  assert.equal(report.signals.freshnessSafe, false);
  assert.ok(report.issues.some((item) => item.includes("历史年份")), report.issues.join("\n"));
});

test("insufficient extractable structure should fail", () => {
  const body = [
    "これは短い本文です。",
    "統計やFAQはありません。",
  ].join("\n");

  const report = evaluateChatgptSearchRules({
    platform: "note",
    title: "短文メモ",
    body,
  });

  assert.equal(report.passed, false);
  assert.equal(report.signals.structureExtractable, false);
});
