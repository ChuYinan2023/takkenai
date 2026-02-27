"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  CalendarDay,
  ContentStatus,
} from "@/lib/calendar-engine";
import { formatAssetIdLabel } from "@/lib/topic-label";
import {
  getArticleTypeOption,
  getEnabledArticleTypeOptions,
  getRecommendedArticleType,
  resolveArticleType,
  type AssetType,
  type CoreArticleType,
} from "@/lib/article-type";

const PLATFORM_CONFIG = {
  ameba: {
    label: "Ameba",
    colorBg: "bg-green-50",
    colorBorder: "border-green-300",
    colorText: "text-green-700",
    colorAccent: "bg-green-500",
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
    colorLight: "bg-blue-100",
    icon: "B!",
    iconBg: "bg-blue-500",
  },
} as const;

type Platform = keyof typeof PLATFORM_CONFIG;
const ENABLED_ARTICLE_TYPES = getEnabledArticleTypeOptions();

const STATUS_CONFIG: Record<ContentStatus, { label: string; color: string }> = {
  pending: { label: "未生成", color: "bg-gray-100 text-gray-600" },
  generated: {
    label: "生成済み",
    color: "bg-emerald-100 text-emerald-700",
  },
  reviewed: {
    label: "レビュー済み",
    color: "bg-blue-100 text-blue-700",
  },
  published: {
    label: "公開済み",
    color: "bg-purple-100 text-purple-700",
  },
  skipped: {
    label: "スキップ",
    color: "bg-gray-100 text-gray-400",
  },
};

export default function DayOverviewClient({
  date,
  calendarDay,
}: {
  date: string;
  calendarDay: CalendarDay;
}) {
  const router = useRouter();
  const resolveAssetTypeByPlatform = (platform: Platform): AssetType | undefined => {
    const raw = calendarDay.motherTopics?.[platform]?.assetType;
    if (raw === "tool" || raw === "knowledge-point" || raw === "past-question") {
      return raw;
    }
    return undefined;
  };
  const [generatingPlatform, setGeneratingPlatform] = useState<
    Platform | null
  >(null);
  const [articleTypeByPlatform, setArticleTypeByPlatform] = useState<
    Record<Platform, CoreArticleType>
  >(() => ({
    ameba: getRecommendedArticleType("ameba", resolveAssetTypeByPlatform("ameba")),
    note: getRecommendedArticleType("note", resolveAssetTypeByPlatform("note")),
    hatena: getRecommendedArticleType("hatena", resolveAssetTypeByPlatform("hatena")),
  }));

  useEffect(() => {
    setArticleTypeByPlatform({
      ameba: resolveArticleType(
        calendarDay.platforms.ameba.articleType ||
          localStorage.getItem("takkenai_article_type_ameba"),
        getRecommendedArticleType("ameba", resolveAssetTypeByPlatform("ameba"))
      ),
      note: resolveArticleType(
        calendarDay.platforms.note.articleType ||
          localStorage.getItem("takkenai_article_type_note"),
        getRecommendedArticleType("note", resolveAssetTypeByPlatform("note"))
      ),
      hatena: resolveArticleType(
        calendarDay.platforms.hatena.articleType ||
          localStorage.getItem("takkenai_article_type_hatena"),
        getRecommendedArticleType("hatena", resolveAssetTypeByPlatform("hatena"))
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const handleArticleTypeChange = (platform: Platform, next: string) => {
    const fallback = getRecommendedArticleType(
      platform,
      resolveAssetTypeByPlatform(platform)
    );
    const resolved = resolveArticleType(next, fallback);
    setArticleTypeByPlatform((prev) => ({ ...prev, [platform]: resolved }));
    localStorage.setItem(`takkenai_article_type_${platform}`, resolved);
  };

  const handleGenerate = async (platform: Platform) => {
    setGeneratingPlatform(platform);
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 120000);
      let res: Response;
      try {
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            date,
            platform,
            articleType: articleTypeByPlatform[platform],
          }),
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (res.ok) {
        router.push(`/day/${date}/${platform}`);
      } else {
        const err = await res.json();
        alert(
          `コンテンツ生成に失敗しました: ${err.error || "不明なエラー"}`
        );
      }
    } catch (err) {
      const aborted =
        typeof DOMException !== "undefined" &&
        err instanceof DOMException &&
        err.name === "AbortError";
      if (aborted) {
        router.push(`/day/${date}/${platform}`);
        alert("生成请求超时，已跳转详情页。若后台已完成，会显示最新内容。");
        return;
      }
      console.error("Generation failed:", err);
      const message = err instanceof Error ? err.message : "不明なエラー";
      alert(`コンテンツ生成に失敗しました: ${message}`);
    } finally {
      setGeneratingPlatform(null);
    }
  };

  const isGenerated = (status: ContentStatus) =>
    status === "generated" ||
    status === "reviewed" ||
    status === "published";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        &#8592; カレンダーに戻る
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{date}</h2>
            <p className="text-sm text-gray-500 mt-1">
              3つのプラットフォームにそれぞれ異なるトピックを配信
            </p>
          </div>
        </div>
      </div>

      {/* Platform Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {(["ameba", "note", "hatena"] as const).map((platform) => {
          const config = PLATFORM_CONFIG[platform];
          const pEntry = calendarDay.platforms[platform];
          const statusConfig = STATUS_CONFIG[pEntry.status];
          const isGenerating = generatingPlatform === platform;
          const done = isGenerated(pEntry.status);

          return (
            <div
              key={platform}
              className={`rounded-xl border-2 ${config.colorBorder} ${config.colorBg} p-6 flex flex-col`}
            >
              {/* Platform icon + name */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`w-10 h-10 rounded-lg ${config.iconBg} text-white flex items-center justify-center font-bold text-sm`}
                >
                  {config.icon}
                </div>
                <div>
                  <h3 className={`text-lg font-bold ${config.colorText}`}>
                    {config.label}
                  </h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${statusConfig.color}`}
                  >
                    {statusConfig.label}
                  </span>
                </div>
              </div>

              {/* Topic info */}
              {calendarDay.motherTopics && (
                <div className="mb-3 p-2 rounded bg-white/60">
                  <p className="text-xs text-gray-500 mb-0.5">トピック</p>
                  <p className="text-sm font-medium text-gray-900">
                    {calendarDay.motherTopics[platform].assetType === "knowledge-point"
                      ? "知識ポイント"
                      : calendarDay.motherTopics[platform].assetType === "tool"
                        ? "ツール"
                        : "過去問"}
                    <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                      {formatAssetIdLabel(
                        calendarDay.motherTopics[platform].assetId,
                        calendarDay.motherTopics[platform].assetType as
                          | "knowledge-point"
                          | "tool"
                          | "past-question"
                      )}
                    </span>
                  </p>
                  <a
                    href={calendarDay.motherTopics[platform].takkenaiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline truncate block mt-0.5"
                  >
                    {calendarDay.motherTopics[platform].takkenaiUrl}
                  </a>
                </div>
              )}

              {/* Suggested title */}
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">提案タイトル</p>
                <p className="text-sm font-medium text-gray-900 leading-relaxed">
                  {pEntry.titleSuggestion}
                </p>
              </div>

              {/* Angle */}
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">アングル</p>
                <span
                  className={`inline-block text-xs font-medium px-2 py-1 rounded ${config.colorLight} ${config.colorText}`}
                >
                  {pEntry.angle}
                </span>
              </div>

              {/* Target length */}
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-1">目標文字数</p>
                <span className="text-xs text-gray-700">
                  {pEntry.targetLength.min} &#8211; {pEntry.targetLength.max}文字
                </span>
              </div>

              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-1">文章类型</p>
                <select
                  value={articleTypeByPlatform[platform]}
                  onChange={(e) => handleArticleTypeChange(platform, e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {ENABLED_ARTICLE_TYPES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  {getArticleTypeOption(articleTypeByPlatform[platform]).description}
                </p>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Actions */}
              <div className="space-y-2 pt-4 border-t border-gray-200/50">
                {platform === "note" && (
                  <Link
                    href={`/day/${date}/note-viral`}
                    className="block w-full text-center py-2 rounded-lg text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                  >
                    爆款承接入口を開く
                  </Link>
                )}
                {done ? (
                  <Link
                    href={`/day/${date}/${platform}`}
                    className={`block w-full text-center py-2.5 rounded-lg font-medium text-white ${config.colorAccent} hover:opacity-90 transition-opacity text-sm`}
                  >
                    コンテンツを見る
                  </Link>
                ) : (
                  <button
                    onClick={() => handleGenerate(platform)}
                    disabled={isGenerating}
                    className={`w-full py-2.5 rounded-lg font-medium text-white ${config.colorAccent} hover:opacity-90 transition-opacity text-sm disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isGenerating ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        生成中...
                      </span>
                    ) : (
                      "コンテンツを生成"
                    )}
                  </button>
                )}
                <Link
                  href={`/day/${date}/${platform}`}
                  className="block w-full text-center py-2 rounded-lg text-sm text-gray-600 hover:bg-white/60 transition-colors"
                >
                  詳細ページを開く &#8594;
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
