"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CalendarDay, ContentStatus } from "@/lib/calendar-engine";
import type { GeneratedContent } from "@/lib/claude";
import {
  evaluateSeoGeoRules,
  type SeoGeoReport,
  type SeoGeoSignals,
} from "@/lib/seo-geo-report";
import {
  evaluateAiActionCompletion,
  type AiActionReport,
} from "@/lib/ai-action-report";
import {
  COVER_STYLE_OPTIONS,
  DEFAULT_COVER_STYLE,
  getCoverStylesByPlatform,
  type CoverStyleId,
} from "@/lib/cover-style";
import {
  composeBodyWithInlineImage,
  composePublishPayload,
  stripMarkdownHeadingMarkers,
} from "@/lib/publish-composer";
import {
  buildGenerateRequestPayload,
  buildRegenerateConfirmMessage,
  resolveSelectedArticleTypeAfterGenerate,
} from "@/lib/content-generation-client";
import {
  getArticleTypeOption,
  getEnabledArticleTypeOptions,
  getRecommendedArticleType,
  resolveArticleType,
  type AssetType,
  type CoreArticleType,
} from "@/lib/article-type";
import {
  resolveContentKey,
  type ContentKey,
} from "@/lib/content-variant";
import type { NoteViralOption } from "@/lib/note-viral-options";

type Platform = "ameba" | "note" | "hatena";
type ImageProviderPreference = "closeai" | "openrouter";
type SettingsStatus = {
  openrouter: boolean;
  closeai: boolean;
  r2Configured?: boolean;
  r2PublicBaseReachable?: boolean;
  r2MissingEnv?: string[];
  activeImageHostingProvider?: "r2" | "uguu" | "catbox" | "telegra-ph";
  fallbackProviderAvailable?: boolean;
};

const CLOSEAI_IMAGE_MODEL = "gemini-3-pro-image-preview";
const OPENROUTER_IMAGE_MODEL = "gemini-3-pro-image-preview";

const PLATFORM_CONFIG = {
  ameba: {
    label: "Ameba",
    colorBg: "bg-green-50",
    colorBorder: "border-green-300",
    colorText: "text-green-700",
    colorAccent: "bg-green-500",
    colorAccentHover: "hover:bg-green-600",
    colorLight: "bg-green-100",
    icon: "A",
    iconBg: "bg-green-500",
  },
  note: {
    label: "note",
    colorBg: "bg-yellow-50",
    colorBorder: "border-yellow-300",
    colorText: "text-yellow-700",
    colorAccent: "bg-yellow-500",
    colorAccentHover: "hover:bg-yellow-600",
    colorLight: "bg-yellow-100",
    icon: "N",
    iconBg: "bg-yellow-500",
  },
  hatena: {
    label: "はてなブログ",
    colorBg: "bg-blue-50",
    colorBorder: "border-blue-300",
    colorText: "text-blue-700",
    colorAccent: "bg-blue-500",
    colorAccentHover: "hover:bg-blue-600",
    colorLight: "bg-blue-100",
    icon: "B!",
    iconBg: "bg-blue-500",
  },
} as const;

const STATUS_LABELS: Record<ContentStatus, string> = {
  pending: "未生成",
  generated: "生成済み",
  reviewed: "レビュー済み",
  published: "公開済み",
  skipped: "スキップ",
};

const SEO_GEO_SIGNAL_LABELS: Record<keyof SeoGeoSignals, string> = {
  keywordInTitle: "关键词在标题",
  keywordInIntro: "关键词在开头",
  keywordInHeadings: "关键词在小节标题",
  answerFirstIntro: "开头有钩子/摘要",
  hasDefinition: "包含定义段落（〜とは）",
  faqCount: "FAQ数量",
  hasDataCitation: "含数据/机构引用",
  hasStructuredHeadings: "结构化H2/H3",
  hasQuoteFriendlyBullets: "可引用要点列表",
  hasTable: "含Markdown表格",
};

const SEO_GEO_TARGET_SCORE = 85;
const ENABLED_ARTICLE_TYPES = getEnabledArticleTypeOptions();

function isValidTakkenaiUrl(raw: string): boolean {
  const trimmed = (raw || "").trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      hostname === "takkenai.jp"
    );
  } catch {
    return false;
  }
}

function normalizeNotePublishUrl(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") return "";
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "note.com") return "";
    const match = parsed.pathname.match(/^\/([a-zA-Z0-9_]+)\/n\/([a-zA-Z0-9]+)\/?$/);
    if (!match) return "";
    const account = match[1].toLowerCase();
    const articleId = match[2].toLowerCase();
    return `https://note.com/${account}/n/${articleId}`;
  } catch {
    return "";
  }
}

function deriveTitleFromBodyForDisplay(body: string, fallbackLabel = "不動産実務"): string {
  const text = (body || "").trim();
  if (!text) return `${fallbackLabel}の要点解説`;
  const headingCandidate = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^##+\s+/.test(line))
    ?.replace(/^##+\s+/, "")
    .trim();
  const heading =
    headingCandidate && !/^https?:\/\//i.test(headingCandidate)
      ? headingCandidate
      : "";
  const base = (heading || fallbackLabel)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^このテーマ(?:とは|の.*)?$/i, "")
    .trim();
  if (!base) return `${fallbackLabel}の要点解説`;
  if (/ガイド|解説|ポイント/.test(base)) return base;
  if (base.endsWith("とは")) return `${base.replace(/とは$/, "").trim()}の要点解説`;
  return `${base}の要点解説`;
}

function formatImageProviderLabel(provider: string): string {
  if (provider === "closeai") return "CloseAI";
  if (provider === "openrouter") return "OpenRouter";
  return provider || "未记录";
}

// ---------------------------------------------------------------------------
// Copy button component
// ---------------------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
    >
      {copied ? (
        <>
          <svg
            className="w-3.5 h-3.5 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          コピー済み
        </>
      ) : (
        <>
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          {label || "コピー"}
        </>
      )}
    </button>
  );
}
// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function MarkdownRenderer({ content }: { content: string }) {
  const html = convertMarkdownToHtml(content);
  return (
    <div
      className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-li:text-gray-700 prose-a:text-blue-600"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function convertMarkdownToHtml(md: string): string {
  let html = md;

  // Code blocks (must come before other transformations)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="bg-gray-100 rounded-md p-3 overflow-x-auto"><code>$2</code></pre>'
  );

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="bg-gray-100 px-1 rounded text-sm">$1</code>'
  );

  // Tables
  html = html.replace(
    /(?:^|\n)((?:\|[^\n]+\|\n)+)/g,
    (_, tableBlock: string) => {
      const rows = tableBlock.trim().split("\n");
      if (rows.length < 2) return tableBlock;

      let tableHtml = '<table class="border-collapse border border-gray-300 w-full my-4">';

      rows.forEach((row, idx) => {
        // Skip separator row (|---|---|)
        if (/^\|[\s-:]+\|$/.test(row.trim())) return;

        const cells = row
          .split("|")
          .filter((c) => c.trim() !== "")
          .map((c) => c.trim());

        const isHeader = idx === 0;
        const tag = isHeader ? "th" : "td";
        const cellClass = isHeader
          ? 'class="border border-gray-300 bg-gray-50 px-3 py-2 text-left text-sm font-medium"'
          : 'class="border border-gray-300 px-3 py-2 text-sm"';

        tableHtml += "<tr>";
        cells.forEach((cell) => {
          tableHtml += "<" + tag + " " + cellClass + ">" + cell + "</" + tag + ">";
        });
        tableHtml += "</tr>";
      });

      tableHtml += "</table>";
      return "\n" + tableHtml + "\n";
    }
  );

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 class="text-base font-semibold mt-4 mb-2">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-5 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Images
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="rounded-md border border-gray-200 w-full h-auto my-3" loading="lazy" />'
  );

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">$1</a>'
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');

  // Blockquotes
  html = html.replace(
    /^> (.+)$/gm,
    '<blockquote class="border-l-4 border-gray-300 pl-4 italic text-gray-600 my-2">$1</blockquote>'
  );

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-4 border-gray-200" />');

  // Paragraphs (double newlines)
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol") ||
        trimmed.startsWith("<blockquote") ||
        trimmed.startsWith("<pre") ||
        trimmed.startsWith("<hr") ||
        trimmed.startsWith("<table") ||
        trimmed.startsWith("<li")
      ) {
        return trimmed;
      }
      return `<p class="my-2">${trimmed}</p>`;
    })
    .join("\n");

  // Line breaks within paragraphs
  html = html.replace(
    /(?<!<\/?\w[^>]*>)\n(?!<\/?[\w])/g,
    "<br />"
  );

  return html;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ContentPageClient({
  date,
  platform,
  calendarDay,
  generatedContent,
  coverFile,
  coverFiles,
  inlineFile,
  inlineFiles,
  contentKey = "standard",
  isNoteViralPage = false,
}: {
  date: string;
  platform: Platform;
  calendarDay: CalendarDay | null;
  generatedContent: GeneratedContent | null;
  coverFile: string | null;
  coverFiles: string[];
  inlineFile: string | null;
  inlineFiles: string[];
  contentKey?: ContentKey;
  isNoteViralPage?: boolean;
}) {
  const router = useRouter();
  const config = PLATFORM_CONFIG[platform];
  const resolvedContentKey = resolveContentKey(platform, contentKey);
  const inNoteViralPage =
    platform === "note" &&
    isNoteViralPage === true &&
    resolvedContentKey === "note-viral";
  const platformEntry = calendarDay?.platforms[platform];
  const resolvePlatformAssetType = (): AssetType | undefined => {
    const raw = calendarDay?.motherTopics?.[platform]?.assetType;
    if (raw === "tool" || raw === "knowledge-point" || raw === "past-question") {
      return raw;
    }
    return undefined;
  };
  const defaultArticleType = getRecommendedArticleType(
    platform,
    resolvePlatformAssetType()
  );
  const contentArticleType = generatedContent?.meta?.articleType;
  const initialArticleType = resolveArticleType(contentArticleType, defaultArticleType);
  const initialResolvedTitle =
    (generatedContent?.title || "").trim() ||
    (platformEntry?.generatedTitle || "").trim() ||
    deriveTitleFromBodyForDisplay(
      generatedContent?.body || "",
      platformEntry?.titleSuggestion || "不動産実務"
    );

  const [content, setContent] = useState<GeneratedContent | null>(
    generatedContent
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [editTitle, setEditTitle] = useState(
    initialResolvedTitle
  );
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [editBody, setEditBody] = useState(
    generatedContent?.body || ""
  );
  const [currentCoverFile, setCurrentCoverFile] = useState(coverFile);
  const [coverHistoryFiles, setCoverHistoryFiles] = useState<string[]>(
    coverFiles
  );
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [coverQualityHint, setCoverQualityHint] = useState("");
  const [coverImageProviderUsed, setCoverImageProviderUsed] = useState("");
  const [coverImageModelUsed, setCoverImageModelUsed] = useState("");
  const [currentInlineFile, setCurrentInlineFile] = useState(inlineFile);
  const [inlineHistoryFiles, setInlineHistoryFiles] = useState<string[]>(
    inlineFiles
  );
  const [isGeneratingInline, setIsGeneratingInline] = useState(false);
  const [inlineImageProviderUsed, setInlineImageProviderUsed] = useState("");
  const [inlineImageModelUsed, setInlineImageModelUsed] = useState("");
  const [isPreparingCopy, setIsPreparingCopy] = useState(false);
  const [selectedCoverStyle, setSelectedCoverStyle] =
    useState<CoverStyleId>(DEFAULT_COVER_STYLE);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageTitle, setPreviewImageTitle] = useState<string>("");
  const [previewImageFile, setPreviewImageFile] = useState<string>("");
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false);
  const [lastMarkdownPath, setLastMarkdownPath] = useState("");
  const [lastMarkdownFile, setLastMarkdownFile] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(
    null
  );
  const [isPublishing, setIsPublishing] = useState(false);
  const [isOptimizingSeoGeo, setIsOptimizingSeoGeo] = useState(false);
  const [customTakkenaiUrl, setCustomTakkenaiUrl] = useState(
    generatedContent?.takkenaiLink ||
      calendarDay?.motherTopics?.[platform]?.takkenaiUrl ||
      ""
  );
  const [publishedNoteUrlInput, setPublishedNoteUrlInput] = useState(
    platformEntry?.publishedUrl || ""
  );
  const [selectedArticleType, setSelectedArticleType] =
    useState<CoreArticleType>(initialArticleType);
  const [noteViralOptions, setNoteViralOptions] = useState<NoteViralOption[]>([]);
  const [selectedNoteViralOptionId, setSelectedNoteViralOptionId] = useState(
    generatedContent?.meta?.noteViralOptionId || ""
  );
  const [isLoadingNoteViralOptions, setIsLoadingNoteViralOptions] =
    useState(inNoteViralPage);
  const [isRefreshingNoteViralOptions, setIsRefreshingNoteViralOptions] =
    useState(false);
  const [noteViralOptionsError, setNoteViralOptionsError] = useState("");
  const [noteViralOptionsUpdatedAt, setNoteViralOptionsUpdatedAt] = useState("");
  const [imageProviderPreference, setImageProviderPreference] =
    useState<ImageProviderPreference>("closeai");
  const [isImageProviderHydrated, setIsImageProviderHydrated] = useState(false);
  const imageProviderTouchedRef = useRef(false);

  const defaultTakkenaiUrl =
    calendarDay?.motherTopics?.[platform]?.takkenaiUrl || content?.takkenaiLink || "";
  const takkenaiUrl = (customTakkenaiUrl || defaultTakkenaiUrl).trim();
  const orderedCoverStyles = useMemo(() => getCoverStylesByPlatform(platform), [platform]);
  const defaultCoverStyleForPlatform =
    orderedCoverStyles[0]?.id || DEFAULT_COVER_STYLE;
  const recommendedCoverStyleIds = useMemo(
    () => new Set(orderedCoverStyles.slice(0, 3).map((style) => style.id)),
    [orderedCoverStyles]
  );
  const imageModelForRequest =
    imageProviderPreference === "openrouter"
      ? OPENROUTER_IMAGE_MODEL
      : CLOSEAI_IMAGE_MODEL;
  const isImageProviderAvailable = useCallback(
    (provider: ImageProviderPreference) => {
      if (!settingsStatus) return true;
      return provider === "closeai" ? !!settingsStatus.closeai : !!settingsStatus.openrouter;
    },
    [settingsStatus]
  );
  const ensureImageProviderReady = useCallback(() => {
    if (!isImageProviderAvailable(imageProviderPreference)) {
      const active = formatImageProviderLabel(imageProviderPreference);
      alert(`${active} 已被禁用：对应密钥未配置，请在环境变量中配置后重试。`);
      return false;
    }
    return true;
  }, [imageProviderPreference, isImageProviderAvailable]);
  const handleImageProviderPreferenceChange = useCallback(
    (provider: ImageProviderPreference) => {
      imageProviderTouchedRef.current = true;
      setImageProviderPreference(provider);
    },
    []
  );

  useEffect(() => {
    setCoverHistoryFiles(coverFiles);
    setCurrentCoverFile(coverFile);
    setCoverQualityHint("");
  }, [coverFiles, coverFile]);

  useEffect(() => {
    setInlineHistoryFiles(inlineFiles);
    setCurrentInlineFile(inlineFile);
  }, [inlineFiles, inlineFile]);

  useEffect(() => {
    setContent(generatedContent);
    const nextResolvedTitle =
      (generatedContent?.title || "").trim() ||
      (platformEntry?.generatedTitle || "").trim() ||
      deriveTitleFromBodyForDisplay(
        generatedContent?.body || "",
        platformEntry?.titleSuggestion || "不動産実務"
      );
    setEditTitle(nextResolvedTitle);
    setEditBody(generatedContent?.body || "");
    setCustomTakkenaiUrl(
      generatedContent?.takkenaiLink ||
        calendarDay?.motherTopics?.[platform]?.takkenaiUrl ||
        ""
    );
    setSelectedArticleType(
      resolveArticleType(generatedContent?.meta?.articleType, defaultArticleType)
    );
    setCurrentCoverFile(coverFile);
    setCoverHistoryFiles(coverFiles);
    setCurrentInlineFile(inlineFile);
    setInlineHistoryFiles(inlineFiles);
  }, [
    generatedContent,
    platformEntry?.generatedTitle,
    platformEntry?.titleSuggestion,
    calendarDay?.motherTopics,
    platform,
    defaultArticleType,
    coverFile,
    coverFiles,
    inlineFile,
    inlineFiles,
  ]);

  useEffect(() => {
    const key = "takkenai_cover_style";
    const saved = localStorage.getItem(key);
    if (saved && orderedCoverStyles.some((s) => s.id === saved)) {
      setSelectedCoverStyle(saved as CoverStyleId);
      return;
    }
    setSelectedCoverStyle(defaultCoverStyleForPlatform);
  }, [defaultCoverStyleForPlatform, orderedCoverStyles]);

  useEffect(() => {
    if (!orderedCoverStyles.some((style) => style.id === selectedCoverStyle)) {
      setSelectedCoverStyle(defaultCoverStyleForPlatform);
    }
  }, [selectedCoverStyle, orderedCoverStyles, defaultCoverStyleForPlatform]);

  useEffect(() => {
    localStorage.setItem("takkenai_cover_style", selectedCoverStyle);
  }, [selectedCoverStyle]);

  useEffect(() => {
    const saved = localStorage.getItem(`takkenai_article_type_${platform}`);
    const preferred = resolveArticleType(
      content?.meta?.articleType || saved,
      defaultArticleType
    );
    setSelectedArticleType(preferred);
  }, [platform, content?.meta?.articleType, defaultArticleType]);

  useEffect(() => {
    localStorage.setItem(`takkenai_article_type_${platform}`, selectedArticleType);
  }, [platform, selectedArticleType]);

  useEffect(() => {
    setPublishedNoteUrlInput(platformEntry?.publishedUrl || "");
  }, [platformEntry?.publishedUrl]);

  useEffect(() => {
    localStorage.setItem(
      "takkenai_image_provider_preference",
      imageProviderPreference
    );
  }, [imageProviderPreference]);

  const loadNoteViralOptions = useCallback(
    async (refresh = false) => {
      if (!inNoteViralPage) return;
      if (refresh) {
        setIsRefreshingNoteViralOptions(true);
      } else {
        setIsLoadingNoteViralOptions(true);
      }
      setNoteViralOptionsError("");
      try {
        const params = new URLSearchParams({ date });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/note-viral-options?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "爆款候选の取得に失敗しました");
        }
        const payload = (await res.json()) as {
          options?: NoteViralOption[];
          updatedAt?: string;
        };
        const options = Array.isArray(payload.options) ? payload.options : [];
        setNoteViralOptions(options);
        setNoteViralOptionsUpdatedAt(String(payload.updatedAt || ""));

        setSelectedNoteViralOptionId((prev) => {
          const contentSelected = content?.meta?.noteViralOptionId || "";
          const prioritized = contentSelected || prev;
          if (prioritized && options.some((item) => item.id === prioritized)) {
            return prioritized;
          }
          return options[0]?.id || "";
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "不明なエラー";
        setNoteViralOptionsError(message);
      } finally {
        setIsLoadingNoteViralOptions(false);
        setIsRefreshingNoteViralOptions(false);
      }
    },
    [date, inNoteViralPage, content?.meta?.noteViralOptionId]
  );

  useEffect(() => {
    if (!inNoteViralPage) return;
    void loadNoteViralOptions(false);
  }, [inNoteViralPage, loadNoteViralOptions]);

  useEffect(() => {
    let active = true;
    const loadSettingsStatus = async () => {
      try {
        const res = await fetch("/api/settings/status");
        if (!res.ok) return;
        const data = (await res.json()) as SettingsStatus;
        if (!active) return;
        setSettingsStatus(data);
      } catch {
        // ignore
      }
    };
    loadSettingsStatus();
    return () => {
      active = false;
    };
  }, []);

  const getImageUrlByFile = useCallback(
    (fileName: string) =>
      `/api/generate-image?filename=${encodeURIComponent(fileName)}`,
    []
  );

  const inlinePlacement = useMemo(() => {
    if (!content) {
      return {
        body: "",
        anchor: { heading: "", paragraph: "", insertAfterLine: 0 },
        inlinePrompt: "",
        inlineAlt: "",
      };
    }
    return composeBodyWithInlineImage({
      body: (editBody || content.body).trim(),
      title: (editTitle || content.title).trim(),
      platform,
      inlineImageAlt: "本文配图",
    });
  }, [content, editBody, editTitle, platform]);

  const markdownPreview = useMemo(() => {
    if (!content) return "";
    const composed = composePublishPayload({
      title: (editTitle || content.title).trim(),
      body: (editBody || content.body).trim(),
      platform,
      coverImageUrl: currentCoverFile ? getImageUrlByFile(currentCoverFile) : undefined,
      inlineImageUrl: currentInlineFile ? getImageUrlByFile(currentInlineFile) : undefined,
      inlineImageAlt: "本文配图",
    });
    return composed.markdown;
  }, [
    content,
    editTitle,
    editBody,
    platform,
    currentCoverFile,
    currentInlineFile,
    getImageUrlByFile,
  ]);

  const handleGenerateInline = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!content) return;
      if (!ensureImageProviderReady()) return;
      setIsGeneratingInline(true);
      try {
        const activeTitle = (editTitle || content.title).trim();
        const activeBody = (editBody || content.body).trim();
        const draft = composeBodyWithInlineImage({
          body: activeBody,
          title: activeTitle,
          platform,
        });
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 180000);
        let res: Response;
        try {
          res = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              imageProviderPreference,
              imageModel: imageModelForRequest,
              platform,
              date,
              contentKey: resolvedContentKey,
              articleTitle: activeTitle,
              articleBody: activeBody,
              imageType: "inline",
              prompt: draft.inlinePrompt,
              sectionHeading: draft.anchor.heading,
              sectionParagraph: draft.anchor.paragraph,
              sectionAlt: draft.inlineAlt,
            }),
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "正文配图生成失败");
        }

        const result = await res.json();
        setCurrentInlineFile(result.filename);
        setInlineImageProviderUsed(result.imageProviderUsed || "");
        setInlineImageModelUsed(result.imageModelUsed || "");
        setInlineHistoryFiles((prev) => [
          result.filename,
          ...prev.filter((item) => item !== result.filename),
        ]);
      } catch (err: unknown) {
        if (!opts?.silent) {
          const aborted =
            typeof DOMException !== "undefined" &&
            err instanceof DOMException &&
            err.name === "AbortError";
          const message = aborted
            ? `请求超时（provider=${imageProviderPreference}）`
            : err instanceof Error
              ? err.message
              : "不明なエラー";
          alert(`正文配图生成失败: ${message}`);
        }
      } finally {
        setIsGeneratingInline(false);
      }
    },
    [
      content,
      editTitle,
      editBody,
      platform,
      date,
      imageProviderPreference,
      imageModelForRequest,
      ensureImageProviderReady,
      resolvedContentKey,
      composeBodyWithInlineImage
    ]
  );

  const handleGenerate = async () => {
    if (!inNoteViralPage && !isValidTakkenaiUrl(takkenaiUrl)) {
      alert("takkenai.jp のURLのみ指定できます（例: https://takkenai.jp/tools/loan/）");
      return;
    }
    if (inNoteViralPage && !selectedNoteViralOptionId) {
      alert("爆款候选を1つ選択してから生成してください。");
      return;
    }

    setIsGenerating(true);
    setStreamText("インターネットで最新情報をリサーチ中...");

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 120000);
      let res: Response;
      try {
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(
            buildGenerateRequestPayload({
              date,
              platform,
              ...(inNoteViralPage
                ? {}
                : {
                    articleType: selectedArticleType,
                    takkenaiUrl,
                  }),
              contentKey: resolvedContentKey,
              ...(inNoteViralPage
                ? { noteViralOptionId: selectedNoteViralOptionId }
                : {}),
            })
          ),
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "生成に失敗しました");
      }

      const result: GeneratedContent = await res.json();
      setContent(result);
      setEditTitle(result.title);
      setEditBody(result.body);
      setSelectedArticleType(
        resolveSelectedArticleTypeAfterGenerate(result, selectedArticleType)
      );
      setCurrentCoverFile(null);
      setCurrentInlineFile(null);
      if (result.meta?.noteViralOptionId) {
        setSelectedNoteViralOptionId(result.meta.noteViralOptionId);
      }
      setStreamText("");
    } catch (err: unknown) {
      const aborted =
        typeof DOMException !== "undefined" &&
        err instanceof DOMException &&
        err.name === "AbortError";
      if (aborted) {
        setStreamText("");
        await router.refresh();
        alert("生成请求超时，已自动刷新页面。若后台已完成，会直接显示最新内容。");
        return;
      }
      const message =
        err instanceof Error ? err.message : "不明なエラー";
      alert(`コンテンツ生成に失敗しました: ${message}`);
      setStreamText("");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    const confirmMessage = inNoteViralPage
      ? "選択中の爆款候选で再生成します。よろしいですか？"
      : buildRegenerateConfirmMessage(selectedArticleType);
    if (!confirm(confirmMessage)) {
      return;
    }
    await handleGenerate();
  };

  const handleOptimizeSeoGeo = async () => {
    if (!content) return;
    if (!inNoteViralPage && !isValidTakkenaiUrl(takkenaiUrl)) {
      alert("takkenai.jp のURLのみ指定できます（例: https://takkenai.jp/tools/loan/）");
      return;
    }

    setIsOptimizingSeoGeo(true);
    try {
      const beforeTrackedUrl =
        takkenaiUrl || content.complianceReport?.trackedUrl || content.takkenaiLink;
      const beforeReport = evaluateSeoGeoRules({
        platform,
        title: (editTitle || content.title).trim(),
        body: (editBody || content.body).trim(),
        seoTitle: content.seoTitle,
        primaryKeyword: content.seoGeoReport?.primaryKeyword,
        trackedUrl: beforeTrackedUrl,
      });
      const beforeAiReport = evaluateAiActionCompletion(
        (editBody || content.body).trim(),
        content.seoGeoReport?.aiActionsChinese || [],
        {
          platform,
          primaryKeyword:
            content.seoGeoReport?.primaryKeyword || beforeReport.primaryKeyword,
        }
      );

      const res = await fetch("/api/optimize-seo-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          platform,
          contentKey: resolvedContentKey,
          articleType: inNoteViralPage ? undefined : selectedArticleType,
          takkenaiUrl: inNoteViralPage ? undefined : takkenaiUrl || undefined,
          targetSeoScore: SEO_GEO_TARGET_SCORE,
          targetGeoScore: SEO_GEO_TARGET_SCORE,
          targetAiScore: SEO_GEO_TARGET_SCORE,
          targetChatgptSearchScore: SEO_GEO_TARGET_SCORE,
          aiGateMode: "hard",
          evidenceMode: "auto",
          maxRounds: 3,
          content: {
            ...content,
            title: (editTitle || content.title).trim(),
            body: (editBody || content.body).trim(),
            takkenaiLink: takkenaiUrl || (content.takkenaiLink || "").trim(),
            meta: {
              ...(content.meta || {}),
              contentKey: resolvedContentKey,
              ...(inNoteViralPage
                ? {}
                : { articleType: selectedArticleType }),
            },
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "SEO/GEO 优化失败");
      }

      const result = await res.json();
      const optimized = result.content as GeneratedContent;
      setContent(optimized);
      setEditTitle(optimized.title);
      setEditBody(optimized.body);
      setSelectedArticleType(
        resolveSelectedArticleTypeAfterGenerate(optimized, selectedArticleType)
      );
      setCurrentCoverFile(null);

      const afterTrackedUrl =
        optimized.complianceReport?.trackedUrl ||
        optimized.takkenaiLink ||
        beforeTrackedUrl;
      const afterReport = evaluateSeoGeoRules({
        platform,
        title: optimized.title,
        body: optimized.body,
        seoTitle: optimized.seoTitle,
        primaryKeyword:
          optimized.seoGeoReport?.primaryKeyword ||
          beforeReport.primaryKeyword,
        trackedUrl: afterTrackedUrl,
      });
      const afterAiReport = evaluateAiActionCompletion(
        optimized.body,
        optimized.seoGeoReport?.aiActionsChinese ||
          content.seoGeoReport?.aiActionsChinese ||
          [],
        {
          platform,
          primaryKeyword:
            optimized.seoGeoReport?.primaryKeyword ||
            beforeReport.primaryKeyword,
        }
      );
      const improvement = result.improvement as
        | {
            seoScoreBefore: number;
            seoScoreAfter: number;
            geoScoreBefore: number;
            geoScoreAfter: number;
            chatgptSearchBefore: number;
            chatgptSearchAfter: number;
            aiCompletionBefore: number;
            aiCompletionAfter: number;
            unresolvedBefore: number;
            unresolvedAfter: number;
          }
        | undefined;

      alert(
        `${result.message}\n` +
          `优化轮次: ${result.rounds}\n` +
          `SEO: ${improvement?.seoScoreBefore ?? beforeReport.seoScore} -> ${
            improvement?.seoScoreAfter ?? afterReport.seoScore
          }\n` +
          `GEO: ${improvement?.geoScoreBefore ?? beforeReport.geoScore} -> ${
            improvement?.geoScoreAfter ?? afterReport.geoScore
          }\n` +
          `ChatGPT Search: ${
            improvement?.chatgptSearchBefore ??
            beforeReport.chatgptSearchScore
          } -> ${
            improvement?.chatgptSearchAfter ?? afterReport.chatgptSearchScore
          }\n` +
          `AI执行率: ${
            improvement?.aiCompletionBefore ?? beforeAiReport.completionScore
          } -> ${
            improvement?.aiCompletionAfter ?? afterAiReport.completionScore
          }\n` +
          `未闭环项: ${improvement?.unresolvedBefore ?? beforeAiReport.unresolvedActions.length} -> ${
            improvement?.unresolvedAfter ?? afterAiReport.unresolvedActions.length
          }`
      );
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      alert(`SEO/GEO 优化失败: ${message}`);
    } finally {
      setIsOptimizingSeoGeo(false);
    }
  };

  const handleMarkPublished = async () => {
    const normalizedNotePublishUrl =
      platform === "note" && !inNoteViralPage
        ? normalizeNotePublishUrl(publishedNoteUrlInput)
        : "";
    if (
      platform === "note" &&
      !inNoteViralPage &&
      publishedNoteUrlInput.trim() &&
      !normalizedNotePublishUrl
    ) {
      alert("发布 URL 仅支持 note 文章链接（例: https://note.com/account/n/xxxxxx）");
      return;
    }

    setIsPublishing(true);
    try {
      const res = await fetch("/api/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          platform,
          status: "published",
          ...(platform === "note" &&
          !inNoteViralPage &&
          normalizedNotePublishUrl
            ? { publishedUrl: normalizedNotePublishUrl }
            : {}),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "公開ステータス更新に失敗しました");
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      alert(`公開ステータス更新に失敗しました: ${message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const copyPlainTextFallback = useCallback(async (text: string) => {
    const value = text || "";
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }, []);

  const copyHtmlByExecCommand = useCallback((html: string, plain: string): boolean => {
    let handled = false;
    const onCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", plain);
      handled = true;
    };
    document.addEventListener("copy", onCopy);
    const success = document.execCommand("copy");
    document.removeEventListener("copy", onCopy);
    return handled && success;
  }, []);

  const copyPublishPayload = useCallback(
    async (html: string, plain: string): Promise<"rich" | "plain"> => {
      if (html) {
        if (
          typeof window !== "undefined" &&
          "ClipboardItem" in window &&
          typeof navigator.clipboard?.write === "function"
        ) {
          try {
            const ClipboardItemCtor = (window as Window & {
              ClipboardItem: typeof ClipboardItem;
            }).ClipboardItem;
            const item = new ClipboardItemCtor({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([plain], { type: "text/plain" }),
            });
            await navigator.clipboard.write([item]);
            return "rich";
          } catch {
            // fallback to execCommand(html) below
          }
        }

        if (copyHtmlByExecCommand(html, plain)) {
          return "rich";
        }
      }

      await copyPlainTextFallback(plain);
      return "plain";
    },
    [copyHtmlByExecCommand, copyPlainTextFallback]
  );

  const handleCopyAll = async () => {
    if (!content) return;
    setIsPreparingCopy(true);
    try {
      const res = await fetch("/api/prepare-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (editTitle || content.title).trim(),
          body: (editBody || content.body).trim(),
          contentKey: resolvedContentKey,
          coverFile: currentCoverFile,
          inlineImageFile: currentInlineFile,
          inlineImageAlt: inlinePlacement.anchor.heading || "本文配图",
          scope: "full",
          date,
          platform,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "图文复制准备失败");
      }

      const result = await res.json();
      const html = String(result.html || "");
      const plain = String(result.plainText || result.markdown || "");
      const mode = await copyPublishPayload(html, plain);

      alert(
        mode === "rich"
          ? "图文已复制（富文本）。可直接粘贴发布。"
          : "内容已复制（文本兜底）。如需带图请粘贴 Markdown 或重试。"
      );
    } catch (err: unknown) {
      const fallback = stripMarkdownHeadingMarkers(
        markdownPreview || (editBody || content.body)
      );
      await copyPlainTextFallback(fallback);
      const message = err instanceof Error ? err.message : "不明なエラー";
      alert(`复制失败，已降级为文本复制。原因: ${message}`);
    } finally {
      setIsPreparingCopy(false);
    }
  };

  const handleGenerateCover = async () => {
    if (!content) return;
    if (!ensureImageProviderReady()) return;

    setCoverQualityHint("");
    setIsGeneratingCover(true);
    try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 240000);
        let res: Response;
        try {
          res = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              prompt: content.imagePrompt,
              platform,
              date,
              contentKey: resolvedContentKey,
              articleTitle: editTitle || content.title,
              articleBody: editBody || content.body,
              hashtags: content.hashtags || [],
              imageProviderPreference,
              imageModel: imageModelForRequest,
              imageType: "cover",
              coverStyle: selectedCoverStyle,
            }),
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "封面図生成に失敗しました");
      }

      const result = await res.json();
      setCurrentCoverFile(result.filename);
      setCoverImageProviderUsed(result.imageProviderUsed || "");
      setCoverImageModelUsed(result.imageModelUsed || "");
      setCoverHistoryFiles((prev) => [
        result.filename,
        ...prev.filter((file) => file !== result.filename),
      ]);
      const hints: string[] = [];
      if (result.textAdjusted === true) {
        hints.push("封面文字已自动缩短以避免截断");
      }
      if (result.qualityCheck === "retry_pass") {
        hints.push("首次排版有溢出，已自动修复并重生成功");
      }
      setCoverQualityHint(hints.join("；"));
    } catch (err: unknown) {
      const aborted =
        typeof DOMException !== "undefined" &&
        err instanceof DOMException &&
        err.name === "AbortError";
      const message = aborted
        ? `请求超时（provider=${imageProviderPreference}）`
        : err instanceof Error
          ? err.message
          : "不明なエラー";
      alert(`封面図生成に失敗しました [provider=${imageProviderPreference}]: ${message}`);
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const handleDownloadImage = (file: string | null) => {
    if (!file) return;
    const imageUrl = getImageUrlByFile(file);
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = file;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportMarkdown = async () => {
    if (!content) return;
    if (!currentCoverFile) {
      alert("封面图未选择，请先生成并选中封面图后再导出 Markdown");
      return;
    }

    setIsExportingMarkdown(true);
    try {
      const res = await fetch("/api/export-markdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle || content.title,
          body: editBody || content.body,
          contentKey: resolvedContentKey,
          coverFile: currentCoverFile,
          inlineImageFile: currentInlineFile,
          inlineImageAlt: inlinePlacement.anchor.heading || "本文配图",
          date,
          platform,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Markdown 导出失败");
      }

      const result = await res.json();
      setLastMarkdownPath(result.markdownPath || "");
      setLastMarkdownFile(result.markdownFile || "");

      if (typeof result.bodyChars === "number" && result.bodyChars <= 0) {
        throw new Error("导出内容为空（bodyChars=0），已阻止空文件导出");
      }

      const uploadWarnings = Array.isArray(result.imageUploadWarnings)
        ? result.imageUploadWarnings
            .map((item: { kind?: string; file?: string; message?: string }) => {
              const kindLabel = item.kind === "inline" ? "正文配图" : "封面图";
              const fileLabel = item.file ? `(${item.file})` : "";
              const msg = item.message || "upload failed";
              return `- ${kindLabel}${fileLabel}: ${msg}`;
            })
            .filter(Boolean)
        : [];

      alert(
        `Markdown 已导出:\n${result.markdownPath}\n${
          result.coverImageMode === "r2-url"
            ? "封面图已上传到持久图床（R2），同事可直接访问"
            : result.coverImageMode === "catbox-url"
            ? "封面图已上传到公网图床（Catbox，无需自定义域名），同事可直接访问"
            : result.coverImageMode === "uguu-url"
            ? "封面图已上传到公网图床（Uguu，兼容模式），同事可直接访问"
            : result.coverImageMode === "telegra-url"
            ? "封面图已上传到公网图床（无需自定义域名），同事可直接访问"
            : result.includedCoverImage
            ? "封面图已包含"
            : "未找到封面图，导出文件中不含图片"
        }\n${
          result.inlineImageUrl
            ? "正文配图已上传并写入 Markdown"
            : "未选择正文配图，仅导出封面图"
        }\n正文字符: ${result.bodyChars ?? "unknown"}\n字节: ${
          result.writtenBytes ?? result.markdownBytes ?? "unknown"
        }\n仅输出 1 个文件，不再额外下载副本${
          uploadWarnings.length > 0
            ? `\n\n图片上传警告（本次已降级为仅文本/部分图片）:\n${uploadWarnings.join("\n")}`
            : ""
        }`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      alert("Markdown 导出失败: " + message);
    } finally {
      setIsExportingMarkdown(false);
    }
  };

  const openPreview = (fileName: string, title: string) => {
    setPreviewImageTitle(title);
    setPreviewImageFile(fileName);
    setPreviewImageUrl(getImageUrlByFile(fileName));
  };
  const complianceReport = content?.complianceReport || null;
  const seoGeoReport: SeoGeoReport | null = useMemo(() => {
    if (!content) return null;
    const fallbackTrackedUrl =
      complianceReport?.trackedUrl || takkenaiUrl || content.takkenaiLink;
    const bodyForEval = editBody || content.body;
    const titleForEval = editTitle || content.title;
    const liveRuleReport = evaluateSeoGeoRules({
      platform,
      title: titleForEval,
      body: bodyForEval,
      seoTitle: content.seoTitle,
      primaryKeyword: content.seoGeoReport?.primaryKeyword,
      trackedUrl: fallbackTrackedUrl,
    });
    const liveAiActionReport = evaluateAiActionCompletion(
      bodyForEval,
      content.seoGeoReport?.aiActionsChinese || [],
      {
        platform,
        primaryKeyword:
          content.seoGeoReport?.primaryKeyword || liveRuleReport.primaryKeyword,
      }
    );
    const liveDualThresholdPassed =
      liveRuleReport.seoScore >= SEO_GEO_TARGET_SCORE &&
      liveRuleReport.geoScore >= SEO_GEO_TARGET_SCORE &&
      liveAiActionReport.completionScore >= SEO_GEO_TARGET_SCORE;
    if (!content.seoGeoReport) {
      return {
        ...liveRuleReport,
        aiActionReport: liveAiActionReport,
        dualThresholdPassed: liveDualThresholdPassed,
      };
    }
    return {
      ...liveRuleReport,
      aiStatus: content.seoGeoReport.aiStatus,
      aiSummaryChinese: content.seoGeoReport.aiSummaryChinese,
      aiActionsChinese: content.seoGeoReport.aiActionsChinese,
      aiActionReport:
        content.seoGeoReport.aiActionReport || liveAiActionReport,
      dualThresholdPassed:
        typeof content.seoGeoReport.dualThresholdPassed === "boolean"
          ? content.seoGeoReport.dualThresholdPassed
          : liveDualThresholdPassed,
    };
  }, [content, complianceReport, takkenaiUrl, platform, editTitle, editBody]);
  const aiActionReport: AiActionReport | null = seoGeoReport?.aiActionReport || null;
  const chatgptSearchScore = seoGeoReport?.chatgptSearchScore ?? 0;
  const seoGeoTargetPassed =
    !!seoGeoReport &&
    seoGeoReport.seoScore >= SEO_GEO_TARGET_SCORE &&
    seoGeoReport.geoScore >= SEO_GEO_TARGET_SCORE &&
    (aiActionReport?.completionScore ?? 0) >= SEO_GEO_TARGET_SCORE;
  const selectedStyleMeta =
    orderedCoverStyles.find((style) => style.id === selectedCoverStyle) ||
    orderedCoverStyles[0] ||
    COVER_STYLE_OPTIONS[0];
  const r2Configured = settingsStatus?.r2Configured === true;
  const r2Reachable = settingsStatus?.r2PublicBaseReachable === true;
  const activeImageHostingProvider =
    settingsStatus?.activeImageHostingProvider || "catbox";
  const imageProviderCloseAvailable = settingsStatus?.closeai === true;
  const imageProviderOpenRouterAvailable = settingsStatus?.openrouter === true;
  const hasImageProviderStatus = settingsStatus !== null;

  useEffect(() => {
    if (!isImageProviderHydrated) {
      if (imageProviderTouchedRef.current) {
        setIsImageProviderHydrated(true);
        return;
      }
      const saved = localStorage.getItem("takkenai_image_provider_preference");
      const hasValidSaved =
        saved === "closeai" || saved === "openrouter";
      const initialPreference: ImageProviderPreference = hasValidSaved
        ? (saved as ImageProviderPreference)
        : "closeai";

      if (initialPreference !== imageProviderPreference) {
        setImageProviderPreference(initialPreference);
      }
      setIsImageProviderHydrated(true);
      return;
    }
  }, [
    isImageProviderHydrated,
    imageProviderPreference,
  ]);

  const imageProviderSelector = (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-xs text-gray-500 whitespace-nowrap">
        图片提供商
      </span>
      <select
        value={imageProviderPreference}
        onChange={(event) =>
          handleImageProviderPreferenceChange(
            event.target.value as ImageProviderPreference
          )
        }
        disabled={isGeneratingCover}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        title="图片提供商"
      >
        <option
          value="closeai"
          disabled={!hasImageProviderStatus || !imageProviderCloseAvailable}
        >
          CloseAI
        </option>
        <option
          value="openrouter"
          disabled={!hasImageProviderStatus || !imageProviderOpenRouterAvailable}
        >
          OpenRouter
        </option>
      </select>
    </label>
  );

  const imageModelLabel = (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span className="rounded border border-gray-200 bg-gray-100 px-2 py-1 text-xs">模型</span>
      {imageModelForRequest}
    </span>
  );

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href={`/day/${date}`}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            &#8592; 日別ページに戻る
          </Link>
          {inNoteViralPage && (
            <>
              <div className="h-4 w-px bg-gray-300" />
              <Link
                href={`/day/${date}/note`}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                note標準ページ
              </Link>
            </>
          )}
          <div className="h-4 w-px bg-gray-300" />
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            カレンダー
          </Link>
        </div>
        {content && (
          <div className="flex items-center gap-2">
            {platform === "note" && !inNoteViralPage && (
              <Link
                href={`/day/${date}/note-viral`}
                className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors"
              >
                爆款独立入口
              </Link>
            )}
            <button
              onClick={handleRegenerate}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              再生成
            </button>
          </div>
        )}
      </div>

      {/* Platform Header */}
      <div
        className={`rounded-xl border-2 ${config.colorBorder} ${config.colorBg} p-5`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-xl ${config.iconBg} text-white flex items-center justify-center font-bold text-lg`}
          >
            {config.icon}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className={`text-xl font-bold ${config.colorText}`}>
                {config.label}
              </h2>
              {inNoteViralPage && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  爆款独立版
                </span>
              )}
              <span className="text-sm text-gray-500">{date}</span>
              {platformEntry && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    platformEntry.status === "generated" || platformEntry.status === "reviewed"
                      ? "bg-emerald-100 text-emerald-700"
                      : platformEntry.status === "published"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {STATUS_LABELS[platformEntry.status]}
                </span>
              )}
            </div>
            {calendarDay && (
              <p className="text-sm text-gray-600 mt-1">
                {calendarDay.motherTopics?.[platform]?.phaseLabel} /
                アングル: {platformEntry?.angle}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Info Bar */}
      {(calendarDay || content) && (
        <div className="flex items-center gap-4 text-sm bg-white rounded-lg border border-gray-200 p-4 flex-wrap">
          {calendarDay && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">トピックタイプ:</span>
                <span className="font-medium text-gray-900">
                  {calendarDay.motherTopics?.[platform]?.assetType === "knowledge-point"
                    ? "知識ポイント"
                    : calendarDay.motherTopics?.[platform]?.assetType === "tool"
                      ? "ツール"
                      : "過去問"}
                </span>
              </div>
              <div className="h-4 w-px bg-gray-200" />
            </>
          )}
          {!inNoteViralPage && (
            <>
              <div className="flex min-w-[15rem] max-w-full flex-1 items-center gap-2">
                <span className="text-gray-500 whitespace-nowrap">文章类型:</span>
                <select
                  value={selectedArticleType}
                  onChange={(e) =>
                    setSelectedArticleType(
                      resolveArticleType(e.target.value, defaultArticleType)
                    )
                  }
                  className="min-w-[10rem] flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {ENABLED_ARTICLE_TYPES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-500">
                  {getArticleTypeOption(selectedArticleType).focus}
                </span>
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <div className="flex items-center gap-2 min-w-[26rem] max-w-full flex-1">
                <span className="text-gray-500 whitespace-nowrap">takkenai.jp:</span>
                <input
                  type="url"
                  value={customTakkenaiUrl}
                  onChange={(e) => setCustomTakkenaiUrl(e.target.value)}
                  placeholder="https://takkenai.jp/tools/loan/"
                  className={`min-w-[18rem] flex-1 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                    isValidTakkenaiUrl(customTakkenaiUrl)
                      ? "border-gray-300"
                      : "border-rose-300 bg-rose-50"
                  }`}
                />
                {takkenaiUrl && (
                  <a
                    href={takkenaiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-md text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors whitespace-nowrap"
                  >
                    開く
                  </a>
                )}
              </div>
            </>
          )}
          {inNoteViralPage && (
            <div className="flex items-center gap-2 text-xs text-indigo-700">
              <span className="font-medium">爆款模式:</span>
              <span>不需指定文章类型/URL，系统将按候选主题改写并自动匹配引流链接。</span>
            </div>
          )}
          {platformEntry && calendarDay && (
            <>
              <div className="h-4 w-px bg-gray-200" />
              <div className="flex items-center gap-2">
                <span className="text-gray-500">目標:</span>
                <span className="font-medium text-gray-700">
                  {platformEntry.targetLength.min}&#8211;{platformEntry.targetLength.max}文字
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {inNoteViralPage && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-indigo-900">
                爆款候选（选择题）
              </h3>
              <p className="text-xs text-indigo-700/80">
                请选择 1 个候选后点击“コンテンツを生成する”。原 note 流程保持不变，当前页面仅作用于独立爆款版本。
              </p>
              {noteViralOptionsUpdatedAt && (
                <p className="text-[11px] text-indigo-700/70 mt-1">
                  更新: {new Date(noteViralOptionsUpdatedAt).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void loadNoteViralOptions(true)}
              disabled={isRefreshingNoteViralOptions || isLoadingNoteViralOptions}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50"
            >
              {isRefreshingNoteViralOptions ? "更新中..." : "候选を更新"}
            </button>
          </div>

          {noteViralOptionsError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              候选取得失败: {noteViralOptionsError}
            </div>
          )}

          {isLoadingNoteViralOptions ? (
            <div className="text-sm text-indigo-700/80">候选を取得中...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {noteViralOptions.map((option) => {
                const selected = selectedNoteViralOptionId === option.id;
                return (
                  <div
                    key={option.id}
                    onClick={() => setSelectedNoteViralOptionId(option.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedNoteViralOptionId(option.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      selected
                        ? "border-indigo-500 bg-white ring-1 ring-indigo-300"
                        : "border-indigo-200 bg-white hover:bg-indigo-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs text-indigo-700 font-medium">
                        {option.sourceType === "competitor"
                          ? "竞品"
                          : option.sourceType === "note-pickup"
                          ? "note热门"
                          : "兜底"}
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] text-gray-500 truncate">
                          {option.sourceAccount}
                        </span>
                        <a
                          href={option.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="shrink-0 rounded border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          原文
                        </a>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
                      {option.title}
                    </p>
                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                      爆点: {option.hotReason}
                    </p>
                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                      迁移写法: {option.viralPattern}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {platform === "note" && !inNoteViralPage && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-indigo-900">爆款功能已独立</h3>
            <p className="text-xs text-indigo-700/80">
              原有 note 功能保持不变。爆款承接请进入独立入口进行选择题生成。
            </p>
          </div>
          <Link
            href={`/day/${date}/note-viral`}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-100 whitespace-nowrap"
          >
            打开爆款入口
          </Link>
        </div>
      )}

      {/* Not Generated State */}
      {!content && !isGenerating && (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <div className="text-gray-400 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </div>
          <p className="text-gray-500 mb-2">
            まだコンテンツが生成されていません
          </p>
          {platformEntry && (
            <p className="text-sm text-gray-400 mb-6">
              提案タイトル: {platformEntry.titleSuggestion}
            </p>
          )}
          {!inNoteViralPage && (
            <div className="mx-auto mb-5 max-w-md text-left">
              <label className="mb-1 block text-xs text-gray-500">文章类型（生成前选择）</label>
              <select
                value={selectedArticleType}
                onChange={(e) =>
                  setSelectedArticleType(
                    resolveArticleType(e.target.value, defaultArticleType)
                  )
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {ENABLED_ARTICLE_TYPES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-500">
                {getArticleTypeOption(selectedArticleType).description}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => void handleGenerate()}
              disabled={inNoteViralPage && !selectedNoteViralOptionId}
              className={`px-8 py-3 rounded-lg font-medium text-white ${config.colorAccent} ${config.colorAccentHover} transition-colors text-base disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {inNoteViralPage ? "候选を確定して生成する" : "コンテンツを生成する"}
            </button>
          </div>
        </div>
      )}

      {/* Generating State */}
      {isGenerating && (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600 font-medium mb-2">
            コンテンツを生成中...
          </p>
          <p className="text-sm text-gray-400">{streamText}</p>
          <p className="text-xs text-gray-300 mt-4">
            Step 1: 最新データのリサーチ → Step 2: 記事生成と品質検査（通常45〜180秒）
          </p>
        </div>
      )}

      {/* Generated Content */}
      {content && !isGenerating && (
        <div className="space-y-6">
          <div className="space-y-4">
            {/* Compliance Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">
                Compliance
              </h3>
              {complianceReport ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full font-medium ${
                        complianceReport.passed
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {complianceReport.passed ? "PASS" : "FAIL"}
                    </span>
                    <span className="text-gray-500">Platform:</span>
                    <span className="font-medium text-gray-800">
                      {complianceReport.platform}
                    </span>
                    <span className="text-gray-500">Link Count:</span>
                    <span className="font-medium text-gray-800">
                      {complianceReport.linkCount}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 break-all">
                    trackedUrl: {complianceReport.trackedUrl}
                  </div>
                  {complianceReport.issues.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-rose-700 space-y-1">
                      {complianceReport.issues.map((issue, idx) => (
                        <li key={`${issue}-${idx}`}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  合規チェック結果はまだありません
                </p>
              )}
            </div>

            {/* SEO / GEO Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  SEO / GEO
                </h3>
                <button
                  onClick={handleOptimizeSeoGeo}
                  disabled={isOptimizingSeoGeo || !content}
                  className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  {isOptimizingSeoGeo ? "优化中..." : "一键优化到 85+"}
                </button>
              </div>
              {seoGeoReport ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full font-medium ${
                        seoGeoTargetPassed
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {seoGeoTargetPassed ? "PASS (85+)" : "NEEDS IMPROVE"}
                    </span>
                    <span className="text-gray-500">SEO:</span>
                    <span className="font-medium text-gray-800">{seoGeoReport.seoScore}/100</span>
                    <span className="text-gray-500">GEO:</span>
                    <span className="font-medium text-gray-800">{seoGeoReport.geoScore}/100</span>
                    <span className="text-gray-500">ChatGPT Search:</span>
                    <span className="font-medium text-gray-800">
                      {chatgptSearchScore}/100
                    </span>
                    <span className="text-gray-500">AI执行率:</span>
                    <span className="font-medium text-gray-800">
                      {aiActionReport?.completionScore ?? 100}/100
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    达标标准: SEO/GEO/AI 均需 &gt;= {SEO_GEO_TARGET_SCORE}（ChatGPT Search 为尽力优化项，不阻断生成）
                  </div>
                  <div className="text-xs text-gray-600">
                    主关键词:{" "}
                    <span className="font-medium text-gray-800">
                      {seoGeoReport.primaryKeyword || "—"}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">关键属性</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(seoGeoReport.signals) as Array<keyof SeoGeoSignals>).map(
                        (key) => {
                          const value = seoGeoReport.signals[key];
                          const passed = typeof value === "number" ? value > 0 : !!value;
                          return (
                            <span
                              key={key}
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] ${
                                passed
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border border-rose-200"
                              }`}
                            >
                              {passed ? "✓" : "✗"} {SEO_GEO_SIGNAL_LABELS[key]}
                              {key === "faqCount" ? `(${value})` : ""}
                            </span>
                          );
                        }
                      )}
                    </div>
                  </div>
                  {(seoGeoReport.strengths.length > 0 ||
                    seoGeoReport.issues.length > 0 ||
                    seoGeoReport.chatgptSearchStrengths.length > 0 ||
                    seoGeoReport.chatgptSearchIssues.length > 0) && (
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-2.5 space-y-2">
                      {seoGeoReport.strengths.length > 0 && (
                        <div className="flex items-start gap-2">
                          <p className="text-xs text-gray-500 shrink-0 pt-0.5">优势</p>
                          <div className="flex flex-wrap gap-1.5">
                            {seoGeoReport.strengths.slice(0, 3).map((item, idx) => (
                              <span
                                key={`${item}-${idx}`}
                                className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                                title={item}
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {seoGeoReport.issues.length > 0 && (
                        <div className="flex items-start gap-2">
                          <p className="text-xs text-gray-500 shrink-0 pt-0.5">待优化</p>
                          <div className="flex flex-wrap gap-1.5">
                            {seoGeoReport.issues.slice(0, 3).map((item, idx) => (
                              <span
                                key={`${item}-${idx}`}
                                className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                                title={item}
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {seoGeoReport.chatgptSearchStrengths.length > 0 && (
                        <div className="flex items-start gap-2">
                          <p className="text-xs text-gray-500 shrink-0 pt-0.5">ChatGPT优势</p>
                          <div className="flex flex-wrap gap-1.5">
                            {seoGeoReport.chatgptSearchStrengths
                              .slice(0, 3)
                              .map((item, idx) => (
                                <span
                                  key={`${item}-${idx}`}
                                  className="inline-flex items-center rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700"
                                  title={item}
                                >
                                  {item}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}
                      {seoGeoReport.chatgptSearchIssues.length > 0 && (
                        <div className="flex items-start gap-2">
                          <p className="text-xs text-gray-500 shrink-0 pt-0.5">ChatGPT待优化</p>
                          <div className="flex flex-wrap gap-1.5">
                            {seoGeoReport.chatgptSearchIssues
                              .slice(0, 3)
                              .map((item, idx) => (
                                <span
                                  key={`${item}-${idx}`}
                                  className="inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-700"
                                  title={item}
                                >
                                  {item}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {aiActionReport && aiActionReport.requiredActions.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">AI已完成</p>
                        {aiActionReport.completedActions.length > 0 ? (
                          <ul className="list-disc pl-5 text-sm text-emerald-700 space-y-1">
                            {aiActionReport.completedActions.slice(0, 3).map((item, idx) => (
                              <li key={`${item}-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-gray-500">暂无已完成项</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">AI未闭环</p>
                        {aiActionReport.unresolvedActions.length > 0 ? (
                          <ul className="list-disc pl-5 text-sm text-rose-700 space-y-1">
                            {aiActionReport.unresolvedActions.slice(0, 3).map((item, idx) => (
                              <li key={`${item}-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-emerald-700">已全部闭环</p>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                    <p className="text-xs text-gray-500 mb-1">AI点评</p>
                    <p className="text-sm text-gray-700">
                      {seoGeoReport.aiSummaryChinese ||
                        "AI评审暂不可用，当前为规则评估结果"}
                    </p>
                    {seoGeoReport.aiActionsChinese &&
                      seoGeoReport.aiActionsChinese.length > 0 && (
                        <ul className="list-disc pl-5 text-sm text-gray-700 mt-2 space-y-1">
                          {seoGeoReport.aiActionsChinese.slice(0, 3).map((item, idx) => (
                            <li key={`${item}-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  SEO/GEO 评估结果暂不可用
                </p>
              )}
            </div>
          </div>

          {/* Title Section - Side by Side */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                タイトル
              </h3>
              <CopyButton text={editTitle} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-400 mb-1 block">日本語（発信用）</span>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full text-lg font-bold text-gray-900 border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>
              <div>
                <span className="text-xs text-gray-400 mb-1 block">中文（参考用）</span>
                <div className="text-lg font-bold text-gray-500 border border-gray-100 bg-gray-50 rounded-lg px-4 py-3">
                  {content.titleChinese || "—"}
                </div>
              </div>
            </div>
          </div>

          {/* SEO Title Section (Ameba only) */}
          {platform === "ameba" && content.seoTitle && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  検索表示タイトル
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    （Ameba検索強化サポート用）
                  </span>
                </h3>
                <CopyButton text={content.seoTitle} />
              </div>
              <div className="text-base text-gray-800 border border-gray-200 bg-gray-50 rounded-lg px-4 py-3">
                {content.seoTitle}
              </div>
            </div>
          )}

          {/* Body Section - Side by Side */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                本文
                {editBody && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    ({editBody.length}文字)
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditingBody(!isEditingBody)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    isEditingBody
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {isEditingBody ? "プレビュー" : "編集"}
                </button>
                <CopyButton text={editBody} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* Left: Japanese */}
              <div>
                <span className="text-xs text-gray-400 mb-1 block">日本語（発信用）</span>
                {isEditingBody ? (
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="w-full h-96 text-sm text-gray-800 border border-gray-200 rounded-lg px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-y"
                  />
                ) : (
                  <div className="border border-gray-100 rounded-lg p-4 min-h-[200px] max-h-[600px] overflow-y-auto">
                    <MarkdownRenderer content={editBody} />
                  </div>
                )}
              </div>
              {/* Right: Chinese */}
              <div>
                <span className="text-xs text-gray-400 mb-1 block">中文（参考用）</span>
                <p className="text-[11px] text-gray-400 mb-2">
                  中文由最终日文自动同步翻译（只读）
                </p>
                <div className="border border-gray-100 bg-gray-50 rounded-lg p-4 min-h-[200px] max-h-[600px] overflow-y-auto">
                  {content.bodyChinese ? (
                    <MarkdownRenderer content={content.bodyChinese} />
                  ) : (
                    <p className="text-gray-400 text-sm">中文翻译未生成</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cover Image */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                封面図（AI生成）
              </h3>
              <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                  {imageProviderSelector}
                  {imageModelLabel}
                </div>
      <button
                    onClick={handleGenerateCover}
                    disabled={isGeneratingCover}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGeneratingCover ? (
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-gray-600" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {isGeneratingCover ? "生成中..." : currentCoverFile ? "再生成" : "生成"}
                </button>
                {currentCoverFile && (
                  <button
                    onClick={() => handleDownloadImage(currentCoverFile)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    下载当前图
                  </button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              仅在你点击“生成/再生成”后才会生成封面图；生成正文和一键优化不会自动触发封面图生成。
            </p>
            {coverQualityHint && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-3">
                {coverQualityHint}
              </p>
            )}
            {coverImageProviderUsed && (
              <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 mb-3">
                当前封面图供应商：{formatImageProviderLabel(coverImageProviderUsed)}
                {coverImageModelUsed ? `（${coverImageModelUsed}）` : ""}
              </p>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
              <div>
                {currentCoverFile ? (
                  <div className="space-y-3">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openPreview(currentCoverFile, "封面図")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openPreview(currentCoverFile, "封面図");
                        }
                      }}
                      className="block w-full text-left cursor-pointer"
                    >
                      <img
                        src={getImageUrlByFile(currentCoverFile)}
                        alt="Cover image"
                        className="rounded-lg border border-gray-200 w-full aspect-[16/9] object-cover hover:opacity-95 transition-opacity"
                      />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-gray-500">クリックして拡大プレビュー</div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDownloadImage(currentCoverFile);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        下载
                      </button>
                    </div>
                  </div>

                    {coverHistoryFiles.length > 1 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">历史生成（已保留）</p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {coverHistoryFiles.map((file) => {
                            const isActive = file === currentCoverFile;
                            return (
                              <button
                                key={file}
                                type="button"
                                onClick={() => setCurrentCoverFile(file)}
                                className={`relative rounded-md overflow-hidden border flex-none w-28 sm:w-32 ${
                                  isActive
                                    ? "border-indigo-500 ring-2 ring-indigo-200"
                                    : "border-gray-200 hover:border-gray-300"
                                }`}
                                title={file}
                              >
                                <img
                                  src={getImageUrlByFile(file)}
                                  alt={file}
                                  className="w-full aspect-[16/9] object-cover"
                                  loading="lazy"
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
              <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg">
                    <p className="text-sm text-gray-400 mb-3">未生成</p>
                    <div className="flex items-center justify-center gap-2">
                      <div className="flex items-center gap-2">
                        {imageProviderSelector}
                        {imageModelLabel}
                      </div>
                      <button
                        onClick={handleGenerateCover}
                        disabled={isGeneratingCover}
                        className="px-5 py-2 rounded-lg font-medium text-white bg-indigo-500 hover:bg-indigo-600 transition-colors text-sm disabled:opacity-50"
                      >
                        {isGeneratingCover ? (
                          <span className="flex items-center gap-2">
                            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                            AI生成中...
                          </span>
                        ) : (
                          "封面図を生成する"
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-700">
                    画像タイプ（全{orderedCoverStyles.length}種）
                  </p>
                  <span className="text-[11px] text-indigo-600 font-medium">
                    {selectedStyleMeta.name}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mb-3">
                  {selectedStyleMeta.subtitle}
                </p>
                <div className="grid grid-cols-2 gap-2 flex-1 auto-rows-fr">
                  {orderedCoverStyles.map((style) => {
                    const selected = style.id === selectedCoverStyle;
                    const recommended = recommendedCoverStyleIds.has(style.id);
                    return (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => setSelectedCoverStyle(style.id)}
                        className={`relative rounded-md border overflow-hidden transition-all h-full min-h-[112px] ${
                          selected
                            ? "border-indigo-500 ring-2 ring-indigo-200 bg-white"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                        title={style.name}
                      >
                        <img
                          src={style.previewImage}
                          alt={style.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                        />
                        {recommended && (
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-indigo-600/95 text-[10px] font-semibold text-white">
                            推荐
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2 py-1.5">
                          <div className="text-[11px] font-semibold text-white truncate">
                            {style.name}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-500 mt-2">
                  点选上方案例图即可切换风格（无横向滚动）。
                </p>
              </div>
            </div>
          </div>

          {/* Inline Body Image */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                正文配图（AI生成）
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleGenerateInline()}
                  disabled={isGeneratingInline || !content}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGeneratingInline ? (
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-gray-600" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {isGeneratingInline ? "生成中..." : currentInlineFile ? "重生成正文图" : "生成正文图"}
                </button>
                {currentInlineFile && (
                  <button
                    onClick={() => handleDownloadImage(currentInlineFile)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    下载正文图
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              正文区不会自动插图。发布时请手动把这张图插入到下方建议位置；Markdown 导出会自动按该位置插图。
            </p>
            {inlineImageProviderUsed && (
              <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1 mb-3">
                当前正文图供应商：{formatImageProviderLabel(inlineImageProviderUsed)}
                {inlineImageModelUsed ? `（${inlineImageModelUsed}）` : ""}
              </p>
            )}
            <div className="rounded-md border border-indigo-100 bg-indigo-50/60 p-3 mb-3">
              <p className="text-xs font-semibold text-indigo-700">
                建议插入位置：在「{inlinePlacement.anchor.heading || "正文段落"}」段落后
              </p>
              <p className="text-[11px] text-indigo-700/90 mt-1 leading-5">
                匹配段落：{(inlinePlacement.anchor.paragraph || "（将根据正文自动定位）").slice(0, 140)}
                {inlinePlacement.anchor.paragraph &&
                inlinePlacement.anchor.paragraph.length > 140
                  ? "..."
                  : ""}
              </p>
              <p className="text-[11px] text-indigo-600/90 mt-1">
                参考行号：约第 {Math.max(1, inlinePlacement.anchor.insertAfterLine + 1)} 行后
              </p>
            </div>

            {currentInlineFile ? (
              <div className="space-y-3">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openPreview(currentInlineFile, "正文配图")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openPreview(currentInlineFile, "正文配图");
                    }
                  }}
                  className="block w-full text-left cursor-pointer"
                >
                  <img
                    src={getImageUrlByFile(currentInlineFile)}
                    alt="Inline body image"
                    className="rounded-lg border border-gray-200 w-full aspect-[16/9] object-cover hover:opacity-95 transition-opacity"
                  />
                </div>
                {inlineHistoryFiles.length > 1 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">历史正文图（已保留）</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {inlineHistoryFiles.map((file) => {
                        const isActive = file === currentInlineFile;
                        return (
                          <button
                            key={file}
                            type="button"
                            onClick={() => setCurrentInlineFile(file)}
                            className={`relative rounded-md overflow-hidden border flex-none w-28 sm:w-32 ${
                              isActive
                                ? "border-indigo-500 ring-2 ring-indigo-200"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                            title={file}
                          >
                            <img
                              src={getImageUrlByFile(file)}
                              alt={file}
                              className="w-full aspect-[16/9] object-cover"
                              loading="lazy"
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400">
                暂无正文配图（生成后可按上方位置手动插入）
              </div>
            )}
          </div>

          {/* Markdown Export */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                Markdown 预览与下载
              </h3>
              <div className="flex items-center gap-2">
                <CopyButton text={markdownPreview} label="复制MD" />
                <button
                  onClick={handleExportMarkdown}
                  disabled={isExportingMarkdown || !content}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExportingMarkdown ? (
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-8m0 8l-3-3m3 3l3-3M4 20h16" />
                    </svg>
                  )}
                  {isExportingMarkdown ? "导出中..." : "导出到 Desktop/takken"}
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-2">
              结构：标题（当前）+ 封面图（当前选中）+ 正文配图（当前选中）+ 正文（当前）。
            </p>
            <p className="text-xs text-gray-500 mb-3">
              导出文件仅保留读者发布内容：标题 + 图片 + 正文（图片使用公网链接）。
            </p>
            <p className="text-xs text-gray-500 mb-3">
              导出目录：<code>/Users/yoyomm/Desktop/takken</code>
            </p>
            {settingsStatus !== null && !r2Configured && (
              <p className="text-xs text-indigo-600 mb-3">
                当前未配置 R2：导出时将自动使用内置公网图床（无需自定义域名）。
              </p>
            )}
            {settingsStatus !== null && r2Configured && !r2Reachable && (
              <p className="text-xs text-amber-600 mb-3">
                R2 已配置但探活失败：导出时仍会尝试上传；失败时会自动回退到内置公网图床。
              </p>
            )}
            <p className="text-xs text-gray-500 mb-3">
              当前图床策略：<code>{activeImageHostingProvider}</code>
              {r2Configured && r2Reachable ? "（优先 R2）" : "（自动兜底）"}
            </p>
            {lastMarkdownPath && (
              <p className="text-xs text-emerald-700 mb-3">
                最近导出：<code>{lastMarkdownFile}</code>（{lastMarkdownPath}）
              </p>
            )}

            <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-80">
              {markdownPreview || "尚无可预览内容"}
            </pre>
          </div>

          {/* Hashtags Section (for note/hatena) */}
          {content.hashtags && content.hashtags.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  ハッシュタグ
                </h3>
                <CopyButton
                  text={content.hashtags.map((t) => `#${t}`).join(" ")}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {content.hashtags.map((tag, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${config.colorLight} ${config.colorText}`}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleCopyAll}
                disabled={isPreparingCopy}
                className="px-6 py-2.5 rounded-lg font-medium text-white bg-gray-800 hover:bg-gray-900 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPreparingCopy ? "图文复制中..." : "图文复制发布"}
              </button>
              {takkenaiUrl && (
                <a
                  href={takkenaiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors text-sm"
                >
                  takkenai.jp を開く
                </a>
              )}
              {platform === "note" && !inNoteViralPage && (
                <div className="flex min-w-[18rem] flex-col gap-1">
                  <label className="text-[11px] text-gray-500">发布 URL 登记（可选）</label>
                  <input
                    type="url"
                    value={publishedNoteUrlInput}
                    onChange={(event) => setPublishedNoteUrlInput(event.target.value)}
                    placeholder="https://note.com/account/n/xxxxxx"
                    className={`rounded-md border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                      publishedNoteUrlInput.trim() &&
                      !normalizeNotePublishUrl(publishedNoteUrlInput)
                        ? "border-rose-300 bg-rose-50"
                        : "border-gray-300 bg-white"
                    }`}
                  />
                </div>
              )}
            </div>
            {!inNoteViralPage && (
              <button
                onClick={handleMarkPublished}
                disabled={isPublishing}
                className="px-6 py-2.5 rounded-lg font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm"
              >
                {isPublishing ? "更新中..." : "公開済みにする"}
              </button>
            )}
          </div>
        </div>
      )}

      {previewImageUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
          <div className="relative w-full max-w-6xl">
            <button
              type="button"
              onClick={() => {
                setPreviewImageUrl(null);
                setPreviewImageFile("");
              }}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-gray-700 shadow hover:bg-gray-100"
              aria-label="Close preview"
            >
              ×
            </button>
            <div className="bg-white rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-medium text-gray-700">
                  {previewImageTitle}
                </div>
                {previewImageFile && (
                  <button
                    type="button"
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = getImageUrlByFile(previewImageFile);
                      link.download = previewImageFile;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    下载此图
                  </button>
                )}
              </div>
              <img
                src={previewImageUrl}
                alt={previewImageTitle}
                className="w-full rounded-md border border-gray-200"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
