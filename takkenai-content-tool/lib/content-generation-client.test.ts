import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGenerateRequestPayload,
  buildRegenerateConfirmMessage,
  resolveSelectedArticleTypeAfterGenerate,
} from "./content-generation-client";

test("generate payload always uses currently selected articleType", () => {
  const payload = buildGenerateRequestPayload({
    date: "2026-02-19",
    platform: "ameba",
    articleType: "trend-analysis",
    takkenaiUrl: "https://takkenai.jp/tools/loan/  ",
  });

  assert.equal(payload.articleType, "trend-analysis");
  assert.equal(payload.enableResearch, true);
  assert.equal(payload.reviewRounds, 1);
  assert.equal(payload.takkenaiUrl, "https://takkenai.jp/tools/loan/");
});

test("generate payload omits empty takkenaiUrl", () => {
  const payload = buildGenerateRequestPayload({
    date: "2026-02-19",
    platform: "note",
    articleType: "practical-guide",
    takkenaiUrl: "   ",
  });

  assert.equal(payload.takkenaiUrl, undefined);
});

test("note viral payload carries isolated content key and selected option", () => {
  const payload = buildGenerateRequestPayload({
    date: "2026-02-19",
    platform: "note",
    articleType: "competitor-compare",
    contentKey: "note-viral",
    noteViralOptionId: "note-viral-123",
  });

  assert.equal(payload.contentKey, "note-viral");
  assert.equal(payload.noteViralOptionId, "note-viral-123");
});

test("note viral payload is included only for note and normalized", () => {
  const notePayload = buildGenerateRequestPayload({
    date: "2026-02-19",
    platform: "note",
    articleType: "competitor-compare",
    noteViralBrief: {
      enabled: true,
      sourceUrl: " https://note.com/sample/n/n123 ",
      sourceAccount: "  競合アカウント  ",
      viralPattern: "冒頭3行で課題提示 + 数字 + ベネフィット",
    },
  });
  assert.equal(notePayload.noteViralBrief?.enabled, true);
  assert.equal(notePayload.noteViralBrief?.sourceUrl, "https://note.com/sample/n/n123");
  assert.equal(notePayload.noteViralBrief?.sourceAccount, "競合アカウント");

  const amebaPayload = buildGenerateRequestPayload({
    date: "2026-02-19",
    platform: "ameba",
    articleType: "how-to",
    noteViralBrief: {
      enabled: true,
      sourceUrl: "https://note.com/sample/n/n123",
    },
  });
  assert.equal(amebaPayload.noteViralBrief, undefined);
});

test("selected articleType syncs to generation response meta", () => {
  const resolved = resolveSelectedArticleTypeAfterGenerate(
    { meta: { articleType: "how-to" } },
    "practical-guide"
  );
  assert.equal(resolved, "how-to");

  const fallback = resolveSelectedArticleTypeAfterGenerate(
    { meta: {} },
    "case-review"
  );
  assert.equal(fallback, "case-review");
});

test("regenerate confirm message shows current articleType", () => {
  const message = buildRegenerateConfirmMessage("tool-ranking");
  assert.match(message, /既存のコンテンツを上書きして再生成しますか/);
  assert.match(message, /当前文章类型：工具排行（选型决策）/);
});
