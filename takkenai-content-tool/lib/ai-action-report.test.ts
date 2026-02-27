import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAiActionCompletion } from "./ai-action-report";

test("high-quality body with case + source + number should reach >=85", () => {
  const body = [
    "結論として、問46は実務判断の順番を固めると得点につながります。",
    "## 実務シナリオ",
    "ケース: 売買契約の条項確認で迷った場合。",
    "手順: まず定義確認、次に要件整理、最後に例外検証。",
    "## 参考データ（出典付き）",
    "国土交通省（2025年）によると、不動産相談件数は12,300件。",
    "## 用語整理",
    "本文では課税標準額という用語に統一して扱います。",
  ].join("\n\n");

  const report = evaluateAiActionCompletion(body, [
    "补充具体实务案例和步骤",
    "增加统计数据的具体数值和来源",
    "统一专业术语表述，避免'課税標準額'等关键概念前后不一致",
  ]);

  assert.ok(report.completionScore >= 85, JSON.stringify(report, null, 2));
  assert.equal(report.unresolvedActions.length, 0, JSON.stringify(report, null, 2));
});

test("body without evidence should fail evidence action", () => {
  const body = [
    "結論として、基礎論点を整理すると理解しやすくなります。",
    "## 実務ポイント",
    "ケース: 重要事項説明の確認。",
    "手順: 要件を順番に確認する。",
  ].join("\n\n");

  const report = evaluateAiActionCompletion(body, [
    "增加统计数据的具体数值和来源，提升内容可信度",
  ]);

  assert.ok(report.completionScore < 85, JSON.stringify(report, null, 2));
  assert.ok(report.unresolvedActions.length >= 1, JSON.stringify(report, null, 2));
});

test("duplicate paragraphs should be detected for dedupe action", () => {
  const para =
    "同じ説明を繰り返す段落です。実務での判断手順を順に説明し、結論に導く内容です。";
  const body = [para, para, "補足: 別の説明文です。"].join("\n\n");

  const report = evaluateAiActionCompletion(body, [
    "删除重复段落，将实务视点学习方法整合为更清晰的步骤说明",
  ]);

  assert.ok(report.signals.duplicateParagraphCount > 0);
  assert.ok(report.unresolvedActions.length >= 1, JSON.stringify(report, null, 2));
});

test("term inconsistency should fail terminology action", () => {
  const body = [
    "課税標準額を確認したうえで手続きを進めます。",
    "別段落では課税標準金額と記載してしまっています。",
  ].join("\n\n");

  const report = evaluateAiActionCompletion(body, [
    "统一专业术语表述，避免'課税標準額'等关键概念前后不一致",
  ]);

  assert.equal(report.signals.termConsistencyPassed, false);
  assert.ok(report.unresolvedActions.length >= 1, JSON.stringify(report, null, 2));
});

test("evidence failure reason should surface when evidence action unresolved", () => {
  const report = evaluateAiActionCompletion(
    "本文には出典や数値の記載がありません。",
    ["增加统计数据的具体数值和来源，提升内容可信度"],
    { evidenceFailureReason: "外部リサーチAPIタイムアウト" }
  );

  assert.ok(
    report.unresolvedActions.some((item) => item.includes("外部リサーチAPIタイムアウト")),
    JSON.stringify(report, null, 2)
  );
});

test("evidence action should degrade gracefully when remote evidence is unavailable", () => {
  const body = [
    "建設・不動産業界の調査では導入率9.4%、効果実感86.7%と報告されています。",
    "出典: 建設・不動産業界の生成AI活用調査",
  ].join("\n");

  const report = evaluateAiActionCompletion(
    body,
    ["增加统计数据的具体数值和来源，提升内容可信度"],
    { evidenceFailureReason: "リサーチ取得失敗: fetch failed" }
  );

  assert.equal(report.completionScore, 100, JSON.stringify(report, null, 2));
  assert.equal(report.unresolvedActions.length, 0, JSON.stringify(report, null, 2));
});
