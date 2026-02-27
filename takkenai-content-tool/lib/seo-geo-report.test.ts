import test from "node:test";
import assert from "node:assert/strict";

import { evaluateSeoGeoRules } from "./seo-geo-report";

test("high-quality note article should pass SEO/GEO", () => {
  const body = [
    "結論として、不動産AIを導入すると査定業務の精度と速度を両立できます。",
    "## 不動産AIとは",
    "不動産AIとは、物件査定やデータ分析を自動化する仕組みです。",
    "## 活用メリット",
    "- 査定時間を短縮できる",
    "- 誤差を抑えて提案品質を上げられる",
    "## FAQ",
    "Q: 導入コストは高いですか？",
    "A: 段階導入なら初期負担を抑えられます。",
    "Q: 現場運用は難しいですか？",
    "A: テンプレート化で定着しやすくなります。",
    "国土交通省の調査（2025年）ではデジタル活用率が上昇しています。",
    "総務省（令和6年度）では関連統計が前年比2.3%増と公表されています。",
    "補足: https://takkenai.jp/tools/assessment/?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
  ].join("\n");

  const report = evaluateSeoGeoRules({
    platform: "note",
    title: "不動産AIで査定業務を効率化する方法",
    body,
    primaryKeyword: "不動産AI",
    trackedUrl:
      "https://takkenai.jp/tools/assessment/?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
  });

  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.ok(report.seoScore >= 75, `seoScore=${report.seoScore}`);
  assert.ok(report.geoScore >= 75, `geoScore=${report.geoScore}`);
  assert.ok(report.chatgptSearchScore >= 85, `chatgptSearchScore=${report.chatgptSearchScore}`);
  assert.equal(report.chatgptSearchPassed, true, JSON.stringify(report, null, 2));
});

test("low-quality article should fail", () => {
  const report = evaluateSeoGeoRules({
    platform: "note",
    title: "雑談メモ",
    body: "今日は気分で書きました。",
    primaryKeyword: "不動産AI",
    trackedUrl: "https://takkenai.jp/tools/assessment/?utm_source=note&utm_medium=blog&utm_campaign=daily_content",
  });

  assert.equal(report.passed, false);
  assert.ok(report.seoScore < 75);
  assert.ok(report.geoScore < 75);
  assert.ok(report.chatgptSearchScore < 85);
});

test("hatena markdown table is optional (no hard issue/penalty)", () => {
  const baseBody = [
    "結論：都市計画法の比較は要点整理でも十分に判断できます。",
    "## 都市計画法とは",
    "都市計画法とは、用途や区域を決める制度です。",
    "## 要点整理",
    "- 区域区分の目的を確認する",
    "- 面積要件の基準を先に押さえる",
    "## FAQ",
    "Q: 試験で頻出ですか？",
    "A: 頻出です。",
    "Q: 実務でも使いますか？",
    "A: 使います。",
    "国土交通省資料（2025年）を参照。",
  ].join("\n");

  const withTableBody = [
    baseBody,
    "## 比較表",
    "| 項目 | 要点 |",
    "|---|---|",
    "| 区域 | 用途制限の確認 |",
  ].join("\n");

  const reportWithoutTable = evaluateSeoGeoRules({
    platform: "hatena",
    title: "都市計画法の基礎",
    body: baseBody,
    primaryKeyword: "都市計画法",
  });
  const reportWithTable = evaluateSeoGeoRules({
    platform: "hatena",
    title: "都市計画法の基礎",
    body: withTableBody,
    primaryKeyword: "都市計画法",
  });

  assert.equal(reportWithoutTable.signals.hasTable, false);
  assert.equal(reportWithTable.signals.hasTable, true);
  assert.ok(
    !reportWithoutTable.issues.some((i) => i.includes("比较表")),
    reportWithoutTable.issues.join("\n")
  );
  assert.equal(reportWithoutTable.seoScore, reportWithTable.seoScore);
  assert.equal(reportWithoutTable.geoScore, reportWithTable.geoScore);
});

test("ameba FAQ=1 should satisfy minimum FAQ rule", () => {
  const body = [
    "結論：宅建の暗記は図解で進めると定着します。",
    "## 宅建とは",
    "宅建とは不動産取引の基礎資格です。",
    "## FAQ",
    "Q: 何から始めるべき？",
    "A: 頻出分野からです。",
    "統計データ（2025年）出典: 国土交通省",
  ].join("\n");

  const report = evaluateSeoGeoRules({
    platform: "ameba",
    title: "宅建学習の始め方",
    body,
    primaryKeyword: "宅建",
  });

  assert.ok(!report.issues.some((i) => i.includes("FAQ 数量不足")), report.issues.join("\n"));
});

test("note/hatena FAQ<2 should raise issue", () => {
  const body = [
    "結論：不動産AIは入力品質で結果が変わります。",
    "## 不動産AIとは",
    "不動産AIとは、査定を支援する仕組みです。",
    "## FAQ",
    "Q: 使う価値はありますか？",
    "A: あります。",
    "国土交通省データ（2025年）を参照。",
  ].join("\n");

  const report = evaluateSeoGeoRules({
    platform: "note",
    title: "不動産AIの活用",
    body,
    primaryKeyword: "不動産AI",
  });

  assert.ok(report.issues.some((i) => i.includes("FAQ 数量不足")), report.issues.join("\n"));
});

test("data citation detection should distinguish with/without source context", () => {
  const withCitation = evaluateSeoGeoRules({
    platform: "note",
    title: "不動産AIの指標",
    body: "## 不動産AIとは\n定義です。\n国土交通省の調査（2025年）によると導入率は上昇。\n## FAQ\nQ: 使えますか？\nA: はい。\nQ: 難しい？\nA: いいえ。",
    primaryKeyword: "不動産AI",
  });

  const withoutCitation = evaluateSeoGeoRules({
    platform: "note",
    title: "不動産AIの指標",
    body: "## 不動産AIとは\n定義です。\n導入率は上昇しています。\n## FAQ\nQ: 使えますか？\nA: はい。\nQ: 難しい？\nA: いいえ。",
    primaryKeyword: "不動産AI",
  });

  assert.equal(withCitation.signals.hasDataCitation, true);
  assert.equal(withoutCitation.signals.hasDataCitation, false);
});

test("data citation detection should accept japanese era year context", () => {
  const report = evaluateSeoGeoRules({
    platform: "ameba",
    title: "固定資産税の基礎",
    body: [
      "結論として、固定資産税の基礎を押さえると判断しやすくなります。",
      "## 固定資産税とは",
      "固定資産税とは、土地と建物にかかる地方税です。",
      "総務省の統計（令和5年度）をもとに整理します。",
      "## FAQ",
      "Q: 何を先に覚えるべき？",
      "A: 定義と税率です。",
    ].join("\n"),
    primaryKeyword: "固定資産税",
  });

  assert.equal(report.signals.hasDataCitation, true);
});

test("edge case: short body should not crash and should produce report", () => {
  const report = evaluateSeoGeoRules({
    platform: "hatena",
    title: "短文テスト",
    body: "短文です。",
  });

  assert.equal(typeof report.seoScore, "number");
  assert.equal(typeof report.geoScore, "number");
  assert.equal(Array.isArray(report.issues), true);
  assert.equal(report.passed, false);
});

test("hook-based intro should be accepted without fixed conclusion opener", () => {
  const body = [
    "なぜ不動産AIの導入で判断ミスが減るのでしょうか？",
    "## 不動産AIとは",
    "不動産AIとは、査定や与信判断を補助する仕組みです。",
    "## 実務での使い方",
    "- 先に入力項目をそろえる",
    "- 根拠データを確認してから結論を出す",
    "## FAQ",
    "Q: 導入の最初の一歩は？",
    "A: 1つの業務に限定して試行することです。",
    "Q: 精度はどう担保しますか？",
    "A: 週次で誤差をレビューし、入力ルールを更新します。",
    "国土交通省の調査（2025年）ではデジタル活用率が上昇しています。",
  ].join("\n");

  const report = evaluateSeoGeoRules({
    platform: "note",
    title: "不動産AI導入の実務ポイント",
    body,
    primaryKeyword: "不動産AI",
  });

  assert.equal(report.signals.answerFirstIntro, true, JSON.stringify(report, null, 2));
  assert.ok(!report.issues.some((item) => item.includes("开头缺少可读钩子")), report.issues.join("\n"));
});

test("FAQ count should recognize numbered bold format (Q1/Q2)", () => {
  const body = [
    "実は、固定資産税は順番を間違えると失点しやすい論点です。",
    "## 固定資産税とは",
    "固定資産税とは、土地・建物にかかる地方税です。",
    "## FAQ",
    "**Q1: 何から覚えるべきですか？**",
    "A1: 税率と課税標準の関係です。",
    "**Q2: 実務で最初に確認すべき点は？**",
    "A2: 適用特例の有無です。",
    "総務省資料（令和5年度）を参照。",
  ].join("\n");

  const report = evaluateSeoGeoRules({
    platform: "hatena",
    title: "固定資産税の基礎",
    body,
    primaryKeyword: "固定資産税",
  });

  assert.equal(report.signals.faqCount >= 2, true, JSON.stringify(report, null, 2));
  assert.ok(!report.issues.some((item) => item.includes("FAQ 数量不足")), report.issues.join("\n"));
});

test("FAQ count should recognize dotted numbering format (Q1./Q2.)", () => {
  const body = [
    "問いの順番を固定すると判断ミスを減らせます。",
    "## 用語定義",
    "固定資産税とは、土地・建物にかかる地方税です。",
    "## FAQ",
    "**Q1. まず何を確認するべきですか？**",
    "A1. 課税対象の範囲です。",
    "**Q2. 実務での確認順は？**",
    "A2. 定義→要件→例外の順で整理します。",
    "総務省の調査（2025年）を参照。",
  ].join("\n");

  const report = evaluateSeoGeoRules({
    platform: "note",
    title: "固定資産税の確認手順",
    body,
    primaryKeyword: "固定資産税",
  });

  assert.ok(report.signals.faqCount >= 2, JSON.stringify(report, null, 2));
  assert.ok(!report.issues.some((item) => item.includes("FAQ 数量不足")), report.issues.join("\n"));
});
