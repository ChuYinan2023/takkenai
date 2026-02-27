import assert from "node:assert/strict";
import test from "node:test";
import {
  __testOnlyBuildLectureInfographicPrompt,
  __testOnlyBuildStyleAwareTextSet,
  __testOnlyGenerateCoverImageWithDeps,
} from "./cover-image";

test("real_photo_clean should compress long title under budget", () => {
  const body = [
    "## 準備の流れ",
    "- 問題文の型を先に見抜く",
    "- 結論を一言で言い切る",
    "- 根拠を最後まで確認する",
  ].join("\n");

  const textSet = __testOnlyBuildStyleAwareTextSet(
    {
      title:
        "オープンハウス案内生成｜【宅建実務】オープンハウス案内、AIで5分作成する時代が来た！",
      body,
      platform: "ameba",
    },
    "real_photo_clean",
    false
  );

  assert.ok(textSet.title.length <= 17, `title length=${textSet.title.length}`);
  assert.ok(textSet.subTitle.length > 0, "subtitle should exist");
  assert.ok(textSet.hook.length > 0, "hook should exist");
  assert.ok(textSet.point1.length > 0, "point1 should exist");
  assert.ok(textSet.point2.length > 0, "point2 should exist");
  assert.ok(textSet.footer.length > 0, "footer should exist");
  assert.notEqual(textSet.point1, textSet.title, "point1 should not duplicate title");
});

test("real_photo_clean strict mode should reduce to one point card", () => {
  const textSet = __testOnlyBuildStyleAwareTextSet(
    {
      title: "とても長いタイトルで文字量が多いケース",
      body: "本文には要点が複数あります。比較・注意・結論を含みます。",
      platform: "note",
    },
    "real_photo_clean",
    true
  );

  assert.ok(textSet.title.length <= 12, `title length=${textSet.title.length}`);
  assert.ok(textSet.point1.length > 0, "point1 should exist");
  assert.equal(textSet.point2, "", "strict mode should avoid second point");
  assert.equal(textSet.point3, "", "strict mode should avoid third point");
  assert.equal(textSet.hook, "", "strict mode should drop hook");
  assert.equal(textSet.footer, "", "strict mode should drop footer");
});

test("style-aware text set should dedupe repeated lines", () => {
  const body = [
    "## 同じ見出し",
    "同じ見出し",
    "同じ見出し",
    "- 同じ見出し",
    "## 同じ見出し",
  ].join("\n");

  const textSet = __testOnlyBuildStyleAwareTextSet(
    {
      title: "同じ見出し｜同じ見出し",
      body,
      platform: "note",
    },
    "lecture_blue",
    false
  );

  const lines = [textSet.point1, textSet.point2, textSet.point3].filter(Boolean);
  assert.equal(lines.length, new Set(lines).size);
});

test("lecture_blue should avoid empty third point in non-strict mode", () => {
  const textSet = __testOnlyBuildStyleAwareTextSet(
    {
      title: "短いタイトル",
      body: "本文が短くても空欄カードを出さない",
      platform: "hatena",
    },
    "lecture_blue",
    false
  );

  assert.ok(textSet.point1.length > 0, "point1 should exist");
  assert.ok(textSet.point2.length > 0, "point2 should exist");
  assert.ok(textSet.point3.length > 0, "point3 should exist");
});

test("cover prompt should include safe area anti-crop constraints", () => {
  const prompt = __testOnlyBuildLectureInfographicPrompt(
    {
      title: "テストタイトル",
      body: "テスト本文",
      platform: "hatena",
      styleId: "real_photo_clean",
    },
    false
  );

  assert.match(prompt, /安全エリア/);
  assert.match(prompt, /画面外に出る配置をしない/);
  assert.match(prompt, /文字を貼り付けない/);
});

test("strict real_photo prompt should allow one point card", () => {
  const prompt = __testOnlyBuildLectureInfographicPrompt(
    {
      title: "長いタイトル",
      body: "本文",
      platform: "note",
      styleId: "real_photo_clean",
    },
    true
  );
  assert.match(prompt, /要点カード数: 1/);
});

test("qa failure on first attempt should trigger one retry and return retry_pass", async () => {
  let callCount = 0;
  let evalCount = 0;
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  ]);

  const result = await __testOnlyGenerateCoverImageWithDeps(
    {
      title: "超長いタイトルのテストケース",
      body: "本文テスト",
      platform: "ameba",
      styleId: "real_photo_clean",
    },
    {
      callImageApiFn: async () => {
        callCount += 1;
        return {
          imageBuffer: pngBuffer,
          providerUsed: "closeai",
          modelUsed: "mock-model",
        };
      },
      evaluateCoverTextReadabilityFn: async () => {
        evalCount += 1;
        if (evalCount === 1) {
          return { pass: false, issues: ["text-clipped"] };
        }
        return { pass: true, issues: [] };
      },
      getApiKeyFn: () => "test-key",
      getModelCandidatesFn: () => ({
        candidates: ["mock-model"],
        strict: true,
      }),
      enforceReadableText: true,
    }
  );

  assert.equal(result.qualityCheck, "retry_pass");
  assert.equal(result.textAdjusted, true);
  assert.equal(result.mimeType, "image/png");
  assert.equal(callCount, 2);
  assert.equal(evalCount, 2);
});

test("note readability non-critical mismatch should be accepted after retry", async () => {
  let evalCount = 0;
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  ]);

  const result = await __testOnlyGenerateCoverImageWithDeps(
    {
      title: "テストタイトル",
      body: "本文テスト",
      platform: "note",
      styleId: "real_photo_clean",
    },
    {
      callImageApiFn: async () => ({
        imageBuffer: pngBuffer,
        providerUsed: "closeai",
        modelUsed: "mock-model",
      }),
      evaluateCoverTextReadabilityFn: async () => {
        evalCount += 1;
        return { pass: false, issues: ["expected-japanese-text-mismatch(1/4)"] };
      },
      getApiKeyFn: () => "test-key",
      getModelCandidatesFn: () => ({
        candidates: ["mock-model"],
        strict: true,
      }),
      enforceReadableText: true,
    }
  );

  assert.equal(result.qualityCheck, "pass");
  assert.ok(Array.isArray(result.qualityIssues));
  assert.equal(evalCount, 1);
});
