import test from "node:test";
import assert from "node:assert/strict";
import {
  applyArticleTypeFallbackStructure,
  validateArticleTypeStructure,
} from "./article-type-validator";

const baseBody = `## 導入\n本文です。\n\n## 詳細\n- 要点A\n- 要点B\n- 要点C`;

test("tool-ranking validation catches missing ranking signals", () => {
  const issues = validateArticleTypeStructure(baseBody, "tool-ranking", "note");
  assert.ok(issues.some((item) => item.includes("排序") || item.includes("排行")));
});

test("how-to validation passes with 3 steps and error handling", () => {
  const body = `## 手順\n1. 前提確認\n2. 入力\n3. 検証\n\n## 例\n入力例を示します。\n\n## エラー対処\nつまずき時の対処。`;
  const issues = validateArticleTypeStructure(body, "how-to", "note");
  assert.equal(issues.length, 0);
});

test("trend-analysis requires source and year", () => {
  const body = `## 市場トレンド\n市場動向を解説。\n\n## 実務アクション\n対策をまとめます。`;
  const issues = validateArticleTypeStructure(body, "trend-analysis", "hatena");
  assert.ok(issues.some((item) => item.includes("来源") || item.includes("出典")));
});

test("case-review requires context process and result", () => {
  const body = `## ケース背景\n背景。\n\n## 判断プロセス\n判断。\n\n## 結果と学び\n結果。`;
  const issues = validateArticleTypeStructure(body, "case-review", "note");
  assert.equal(issues.length, 0);
});

test("fallback structure can inject missing how-to steps", () => {
  const updated = applyArticleTypeFallbackStructure("## 導入\n本文", "how-to", "賃貸管理");
  assert.ok(updated.includes("賃貸管理の実行手順"));
  assert.ok(updated.includes("1."));
});

test("trend-analysis fallback should not inject fixed template sections", () => {
  const updated = applyArticleTypeFallbackStructure(
    "## 市場トレンド\nトレンド解説\n\n## 実務アクション\n行動案",
    "trend-analysis",
    "不動産市場"
  );
  assert.equal(updated.includes("## 直近の動向と実務への影響"), false, updated);
  assert.equal(updated.includes("## 市場データの根拠"), false, updated);
  assert.equal(updated.includes("国土交通省"), false, updated);
});

test("fallback structure can satisfy practical-guide with FAQ Q/A and headings", () => {
  const updated = applyArticleTypeFallbackStructure("本文のみ", "practical-guide", "学習計画作成");
  const issues = validateArticleTypeStructure(updated, "practical-guide", "ameba");
  assert.ok(updated.includes("## FAQ"), updated);
  assert.ok(/^\s*Q[:：]/m.test(updated), updated);
  assert.ok(/^\s*A[:：]/m.test(updated), updated);
  assert.equal(
    issues.some(
      (item) =>
        item.includes("H2/H3") ||
        item.includes("FAQ段落") ||
        item.includes("定义段") ||
        item.includes("流程")
    ),
    false,
    issues.join("\n")
  );
});

test("competitor-compare fallback avoids template-like strength/weakness blocks", () => {
  const updated = applyArticleTypeFallbackStructure(
    "## 導入\n比較対象の前提だけを説明します。",
    "competitor-compare",
    "業務効率化ツール"
  );
  assert.equal(updated.includes("## 強み（採用しやすい条件）"), false, updated);
  assert.equal(updated.includes("## 劣勢・境界条件（失敗を避ける視点）"), false, updated);
  assert.equal(updated.includes("メリット: 初期運用で比較しやすく、意思決定が速い"), false, updated);
  const issues = validateArticleTypeStructure(updated, "competitor-compare", "note");
  assert.equal(
    issues.some((item) => item.includes("比較维度") || item.includes("优势") || item.includes("劣势")),
    false,
    issues.join("\n")
  );
});

test("practical-guide fallback avoids generic process/caution template headings", () => {
  const updated = applyArticleTypeFallbackStructure(
    "## 導入\n本文のみ",
    "practical-guide",
    "種規制と種制限"
  );
  assert.equal(updated.includes("## 実務での進め方"), false, updated);
  assert.equal(updated.includes("## 注意点・よくあるミス"), false, updated);
  const issues = validateArticleTypeStructure(updated, "practical-guide", "ameba");
  assert.equal(
    issues.some(
      (item) =>
        item.includes("定义段") ||
        item.includes("流程") ||
        item.includes("注意点") ||
        item.includes("FAQ")
    ),
    false,
    issues.join("\n")
  );
});
