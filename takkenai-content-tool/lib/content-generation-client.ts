import {
  getArticleTypeOption,
  resolveArticleType,
  type CoreArticleType,
} from "./article-type";
import type { GeneratedContent } from "./claude";
import {
  normalizeNoteViralBrief,
  type NoteViralBrief,
} from "./note-viral";
import { resolveContentKey, type ContentKey } from "./content-variant";
import type { Platform } from "./topic-engine";

export interface GenerateRequestInput {
  date: string;
  platform: Platform;
  articleType?: CoreArticleType;
  takkenaiUrl?: string;
  contentKey?: ContentKey;
  noteViralOptionId?: string;
  noteViralBrief?: Partial<NoteViralBrief>;
}

export interface GenerateRequestPayload {
  date: string;
  platform: Platform;
  articleType?: CoreArticleType;
  takkenaiUrl?: string;
  contentKey?: ContentKey;
  noteViralOptionId?: string;
  noteViralBrief?: NoteViralBrief;
  enableResearch: true;
  reviewRounds: 1;
}

export function buildGenerateRequestPayload(
  input: GenerateRequestInput
): GenerateRequestPayload {
  const normalizedUrl = (input.takkenaiUrl || "").trim();
  const contentKey = resolveContentKey(input.platform, input.contentKey);
  const normalizedViralOptionId =
    input.platform === "note"
      ? String(input.noteViralOptionId || "").trim()
      : "";
  const normalizedViral = normalizeNoteViralBrief(input.noteViralBrief);
  return {
    date: input.date,
    platform: input.platform,
    ...(input.articleType ? { articleType: input.articleType } : {}),
    takkenaiUrl: normalizedUrl || undefined,
    ...(contentKey !== "standard" ? { contentKey } : {}),
    ...(contentKey === "note-viral" && normalizedViralOptionId
      ? { noteViralOptionId: normalizedViralOptionId }
      : {}),
    ...(input.platform === "note" && normalizedViral
      ? { noteViralBrief: normalizedViral }
      : {}),
    enableResearch: true,
    reviewRounds: 1,
  };
}

export function resolveSelectedArticleTypeAfterGenerate(
  generated: Pick<GeneratedContent, "meta"> | null | undefined,
  fallback: CoreArticleType
): CoreArticleType {
  return resolveArticleType(generated?.meta?.articleType, fallback);
}

export function buildRegenerateConfirmMessage(
  articleType: CoreArticleType
): string {
  const option = getArticleTypeOption(articleType);
  return [
    "既存のコンテンツを上書きして再生成しますか？",
    `当前文章类型：${option.label}（${option.focus}）`,
  ].join("\n");
}
