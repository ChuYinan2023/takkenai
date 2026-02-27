import test from "node:test";
import assert from "node:assert/strict";
import { composeBodyWithInlineImage, composePublishPayload } from "./publish-composer";

test("composeBodyWithInlineImage injects inline image markdown", () => {
  const result = composeBodyWithInlineImage({
    title: "宅建の実務",
    body: "## 手順\n\nまず条件を確認します。\n\n次に比較します。",
    platform: "note",
    inlineImageUrl: "https://files.catbox.moe/abc.png",
    inlineImageAlt: "手順イメージ",
  });

  assert.match(result.body, /!\[手順イメージ\]\(https:\/\/files\.catbox\.moe\/abc\.png\)/);
  assert.equal(result.anchor.heading, "手順");
});

test("composePublishPayload outputs title + cover + body", () => {
  const result = composePublishPayload({
    title: "タイトルA",
    body: "本文です。",
    platform: "ameba",
    coverImageUrl: "https://files.catbox.moe/cover.png",
  });

  assert.match(result.markdown, /^# タイトルA/m);
  assert.match(result.markdown, /!\[タイトルA\]\(https:\/\/files\.catbox\.moe\/cover\.png\)/);
  assert.match(result.markdown, /本文です。/);
  assert.match(result.html, /<h1>タイトルA<\/h1>/);
});

test("composePublishPayload plainText strips markdown heading markers", () => {
  const result = composePublishPayload({
    title: "タイトルA",
    body: "## セクション\n本文です。",
    platform: "note",
  });

  assert.doesNotMatch(result.plainText, /^#\s+/m);
  assert.match(result.plainText, /^タイトルA$/m);
  assert.match(result.plainText, /^セクション$/m);
});
