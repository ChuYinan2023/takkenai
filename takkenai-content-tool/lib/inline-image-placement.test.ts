import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInlineImagePrompt,
  injectInlineImageMarkdown,
  pickInlineAnchor,
} from "./inline-image-placement";

test("pickInlineAnchor prefers semantic section paragraph", () => {
  const body = `## 導入\n\n短い。\n\n## 実務での判断手順\n\n実務では、まず申込条件を確認し、次に返済比率と金利変動幅を比較して、審査可否を段階的に判断します。条件ごとに確認ポイントが異なるため、根拠をメモしながら進めると判断が安定します。\n\n- チェック1\n- チェック2`;

  const anchor = pickInlineAnchor(body, "住宅ローン審査");
  assert.equal(anchor.heading, "実務での判断手順");
  assert.match(anchor.paragraph, /審査可否/);
  assert.ok(anchor.insertAfterLine > 0);
});

test("injectInlineImageMarkdown inserts image after anchor line", () => {
  const body = `## 見出し\n\n段落A\n\n段落B`;
  const next = injectInlineImageMarkdown(body, "![alt](https://img.example/a.png)", {
    heading: "見出し",
    paragraph: "段落A",
    insertAfterLine: 2,
  });

  assert.match(next, /段落A\n\n!\[alt\]\(https:\/\/img\.example\/a\.png\)/);
});

test("pickInlineAnchor avoids FAQ tail section when richer practical section exists", () => {
  const body = `## 実務での進め方\n\n動画企画生成では、まず対象読者を決め、次に論点を3つに絞って、最後に1分で話せる構成へ落とし込むと再現性が高まります。実務で使える型として、導入→要点→チェックの順で組み立てるのが効果的です。\n\n## FAQ\nQ: 動画企画生成は何から覚えるべきですか？\nA: まず定義と計算・判断の基本式を押さえ、次に例題で確認すると定着しやすいです。`;

  const anchor = pickInlineAnchor(body, "動画企画生成");
  assert.equal(anchor.heading, "実務での進め方");
  assert.match(anchor.paragraph, /対象読者/);
});

test("buildInlineImagePrompt keeps no-text constraints", () => {
  const prompt = buildInlineImagePrompt({
    title: "タイトル",
    heading: "見出し",
    paragraph: "本文段落",
    platform: "note",
  });
  assert.match(prompt, /文字・ロゴ・透かし・URL/);
});
