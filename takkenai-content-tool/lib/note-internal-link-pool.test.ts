import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import {
  getNoteInternalLinkPoolStatus,
  normalizeNoteArticleUrl,
  pickRelatedNoteLink,
  registerPublishedNoteUrl,
} from "./note-internal-link-pool";

test("normalizeNoteArticleUrl keeps canonical note article URL only", () => {
  assert.equal(
    normalizeNoteArticleUrl("https://note.com/Some_Account/n/AbC123?foo=bar"),
    "https://note.com/some_account/n/abc123"
  );
  assert.equal(
    normalizeNoteArticleUrl("https://example.com/a/b"),
    ""
  );
  assert.equal(
    normalizeNoteArticleUrl(""),
    ""
  );
});

test("register and pick related note links with whitelist and viral exclusion", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "note-link-pool-"));
  const poolFile = path.join(tmpDir, "note-internal-links.json");
  const prevPoolFile = process.env.NOTE_INTERNAL_LINK_POOL_FILE;
  const prevEnabled = process.env.NOTE_INTERNAL_LINKS_ENABLED;
  process.env.NOTE_INTERNAL_LINK_POOL_FILE = poolFile;
  process.env.NOTE_INTERNAL_LINKS_ENABLED = "true";

  try {
    registerPublishedNoteUrl({
      url: "https://note.com/acme_jp/n/aaa111",
      title: "第一篇",
      date: "2026-02-10",
      contentKey: "standard",
    });
    registerPublishedNoteUrl({
      url: "https://note.com/acme_jp/n/bbb222",
      title: "第二篇",
      date: "2026-02-11",
      contentKey: "standard",
    });
    registerPublishedNoteUrl({
      url: "https://note.com/acme_jp/n/ccc333",
      title: "爆款独立",
      date: "2026-02-12",
      contentKey: "note-viral",
    });

    assert.throws(
      () =>
        registerPublishedNoteUrl({
          url: "https://note.com/other_acc/n/zzz999",
          title: "第三方",
          date: "2026-02-13",
          contentKey: "standard",
        }),
      /白名/
    );

    const status = getNoteInternalLinkPoolStatus();
    assert.equal(status.enabled, true);
    assert.deepEqual(status.allowedAccounts, ["acme_jp"]);
    assert.equal(status.count, 3);

    const picked = pickRelatedNoteLink({
      date: "2026-02-13",
      currentContentKey: "standard",
      currentTitle: "第二篇相关主题",
      currentTakkenaiUrl: "https://takkenai.jp/tools/loan/",
      cooldownDays: 7,
    });
    assert.ok(picked, "expected one related note link");
    assert.equal(picked?.account, "acme_jp");
    assert.ok(
      picked?.url === "https://note.com/acme_jp/n/aaa111" ||
        picked?.url === "https://note.com/acme_jp/n/bbb222"
    );

    const skippedForViral = pickRelatedNoteLink({
      date: "2026-02-13",
      currentContentKey: "note-viral",
    });
    assert.equal(skippedForViral, null);
  } finally {
    if (prevPoolFile === undefined) {
      delete process.env.NOTE_INTERNAL_LINK_POOL_FILE;
    } else {
      process.env.NOTE_INTERNAL_LINK_POOL_FILE = prevPoolFile;
    }
    if (prevEnabled === undefined) {
      delete process.env.NOTE_INTERNAL_LINKS_ENABLED;
    } else {
      process.env.NOTE_INTERNAL_LINKS_ENABLED = prevEnabled;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

