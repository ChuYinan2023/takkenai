export type InlineImageAnchor = {
  heading: string;
  paragraph: string;
  insertAfterLine: number;
};

type Section = {
  heading: string;
  headingLine: number;
  endLine: number;
};

const LIST_LINE_REGEX = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
const TABLE_LINE_REGEX = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER_REGEX = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const FAQ_HEADING_REGEX = /(FAQ|よくある質問|Q&A|Q＆A)/i;
const SUMMARY_HEADING_REGEX = /(まとめ|結論|総括|おわりに|最後に)/;
const PRACTICAL_HEADING_REGEX = /(実務|手順|ポイント|判断|計算|活用|使い方|事例|比較)/;

function sanitizeText(input: string): string {
  return (input || "")
    .replace(/\r/g, "")
    .replace(/\u200B/g, "")
    .trim();
}

function extractSections(lines: string[]): Section[] {
  const headingIndexes: Array<{ idx: number; heading: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^##+\s+(.+)$/);
    if (m) {
      headingIndexes.push({ idx: i, heading: sanitizeText(m[1]) });
    }
  }

  if (headingIndexes.length === 0) {
    return [
      {
        heading: "本文要点",
        headingLine: -1,
        endLine: lines.length - 1,
      },
    ];
  }

  const sections: Section[] = [];
  for (let i = 0; i < headingIndexes.length; i++) {
    const current = headingIndexes[i];
    const next = headingIndexes[i + 1];
    sections.push({
      heading: current.heading,
      headingLine: current.idx,
      endLine: next ? next.idx - 1 : lines.length - 1,
    });
  }
  return sections;
}

function shouldSkipBlock(rawBlock: string): boolean {
  const block = rawBlock.trim();
  if (!block) return true;

  const lines = block.split("\n").map((line) => line.trim());
  if (lines.length === 0) return true;

  if (lines.some((line) => /^##+\s+/.test(line))) return true;
  if (lines.every((line) => LIST_LINE_REGEX.test(line))) return true;
  if (lines.every((line) => TABLE_LINE_REGEX.test(line) || TABLE_DIVIDER_REGEX.test(line))) {
    return true;
  }

  return false;
}

function blockScore(block: string, positionRatio: number): number {
  const text = block.replace(/\s+/g, " ").trim();
  const chars = text.length;
  let score = chars;

  if (chars < 80) score -= 40;
  if (chars > 420) score -= 20;

  if (/\d/.test(text)) score += 8;
  if (/（.+?）/.test(text)) score += 6;
  if (/具体|事例|手順|ポイント|注意|チェック|判断|計算/.test(text)) score += 10;
  if (/FAQ|よくある質問|まとめ|結論/.test(text)) score -= 12;
  if (/^\s*(?:Q|A)\d*[:：]/m.test(block)) score -= 42;
  if (positionRatio > 0.9) score -= 48;
  else if (positionRatio > 0.75) score -= 16;
  else if (positionRatio < 0.55) score += 8;

  return score;
}

function sectionScoreOffset(section: Section, index: number, total: number): number {
  const heading = sanitizeText(section.heading);
  let offset = 0;

  if (FAQ_HEADING_REGEX.test(heading)) offset -= 120;
  if (SUMMARY_HEADING_REGEX.test(heading)) offset -= 80;
  if (PRACTICAL_HEADING_REGEX.test(heading)) offset += 20;

  // Avoid tail placements unless no better candidate exists.
  if (total > 1 && index === total - 1) offset -= 30;
  return offset;
}

function pickParagraphBlockInSection(
  lines: string[],
  section: Section
): { paragraph: string; insertAfterLine: number; score: number } | null {
  const start = Math.max(0, section.headingLine + 1);
  const end = Math.min(lines.length - 1, section.endLine);
  if (start > end) return null;

  let best: { paragraph: string; insertAfterLine: number; score: number } | null = null;

  let cursor = start;
  while (cursor <= end) {
    while (cursor <= end && lines[cursor].trim() === "") cursor++;
    if (cursor > end) break;

    const blockStart = cursor;
    const buf: string[] = [];
    while (cursor <= end && lines[cursor].trim() !== "") {
      buf.push(lines[cursor]);
      cursor++;
    }

    const rawBlock = buf.join("\n");
    if (shouldSkipBlock(rawBlock)) continue;

    const paragraph = sanitizeText(rawBlock);
    if (!paragraph) continue;

    const sectionSpan = Math.max(1, end - start + 1);
    const positionRatio = Math.max(0, Math.min(1, (blockStart - start) / sectionSpan));
    const score = blockScore(paragraph, positionRatio);
    if (!best || score > best.score) {
      best = {
        paragraph,
        insertAfterLine: cursor - 1,
        score,
      };
    }
  }

  if (!best) return null;
  return {
    paragraph: best.paragraph,
    insertAfterLine: best.insertAfterLine,
    score: best.score,
  };
}

export function pickInlineAnchor(body: string, title: string): InlineImageAnchor {
  const normalized = (body || "").replace(/\r/g, "");
  const lines = normalized.split("\n");
  const sections = extractSections(lines);

  let bestAcrossSections:
    | (InlineImageAnchor & { score: number })
    | null = null;

  for (let idx = 0; idx < sections.length; idx++) {
    const section = sections[idx];
    const picked = pickParagraphBlockInSection(lines, section);
    if (picked) {
      const score = picked.score + sectionScoreOffset(section, idx, sections.length);
      const candidate: InlineImageAnchor & { score: number } = {
        heading: section.heading || sanitizeText(title) || "本文要点",
        paragraph: picked.paragraph,
        insertAfterLine: picked.insertAfterLine,
        score,
      };
      if (!bestAcrossSections || candidate.score > bestAcrossSections.score) {
        bestAcrossSections = candidate;
      }
    }
  }

  if (bestAcrossSections) {
    return {
      heading: bestAcrossSections.heading,
      paragraph: bestAcrossSections.paragraph,
      insertAfterLine: bestAcrossSections.insertAfterLine,
    };
  }

  const firstParagraph = normalizeFallbackParagraph(lines);
  return {
    heading: sanitizeText(title) || "本文要点",
    paragraph: firstParagraph.paragraph,
    insertAfterLine: firstParagraph.insertAfterLine,
  };
}

function normalizeFallbackParagraph(
  lines: string[]
): { paragraph: string; insertAfterLine: number } {
  let cursor = 0;
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor].trim()) cursor++;
    if (cursor >= lines.length) break;

    const start = cursor;
    const block: string[] = [];
    while (cursor < lines.length && lines[cursor].trim()) {
      block.push(lines[cursor]);
      cursor++;
    }

    const paragraph = sanitizeText(block.join("\n"));
    if (
      paragraph &&
      !/^##+\s+/.test(paragraph) &&
      !shouldSkipBlock(paragraph)
    ) {
      return {
        paragraph,
        insertAfterLine: Math.max(start, cursor - 1),
      };
    }
  }

  return {
    paragraph: "本文の要点を視覚的に伝える挿絵",
    insertAfterLine: Math.max(lines.length - 1, 0),
  };
}

export function buildInlineImagePrompt(input: {
  title: string;
  heading: string;
  paragraph: string;
  platform: "ameba" | "note" | "hatena";
}): string {
  const title = sanitizeText(input.title).slice(0, 120);
  const heading = sanitizeText(input.heading).slice(0, 120);
  const paragraph = sanitizeText(input.paragraph)
    .replace(/\n+/g, " ")
    .slice(0, 420);

  const style =
    input.platform === "ameba"
      ? "明るく親しみやすい、柔らかいイラスト調"
      : input.platform === "hatena"
      ? "情報整理に強い、クリーンな図解イラスト調"
      : "洗練された、静かなプロフェッショナル調";

  return [
    "ブログ本文の段落に挿入する挿絵を1枚生成してください。",
    "16:9 横長。高解像度。",
    "段落の意味を視覚化し、読者が直感的に理解できる構図にしてください。",
    `画風: ${style}`,
    "必須: 文字・ロゴ・透かし・URL・UIスクリーンショットを入れない。",
    "被写体は段落内容と一致させる。誇張しすぎない。",
    `記事タイトル: ${title}`,
    `該当見出し: ${heading}`,
    `該当段落: ${paragraph}`,
  ].join("\n");
}

export function injectInlineImageMarkdown(
  body: string,
  inlineMarkdown: string,
  anchor: InlineImageAnchor
): string {
  const normalizedBody = (body || "").replace(/\r/g, "").trim();
  const imageLine = (inlineMarkdown || "").trim();
  if (!normalizedBody || !imageLine) return normalizedBody;

  if (normalizedBody.includes(imageLine)) {
    return normalizedBody;
  }

  const lines = normalizedBody.split("\n");
  const insertAt = Math.max(0, Math.min(lines.length - 1, anchor.insertAfterLine)) + 1;

  const out = [...lines];
  out.splice(insertAt, 0, "", imageLine, "");

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
