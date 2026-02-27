"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type KeyStatus = {
  openrouter: boolean;
  closeai: boolean;
  r2Configured: boolean;
  r2PublicBaseReachable: boolean;
  r2MissingEnv: string[];
};

export default function SettingsPage() {
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [closeaiKey, setCloseaiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({
    openrouter: false,
    closeai: false,
    r2Configured: false,
    r2PublicBaseReachable: false,
    r2MissingEnv: [],
  });

  useEffect(() => {
    // Load saved keys from localStorage
    const savedOpenrouterKey =
      localStorage.getItem("OPENROUTER_API_KEY") || "";
    const savedCloseaiKey =
      localStorage.getItem("CLOSEAI_API_KEY") || "";

    setOpenrouterKey(savedOpenrouterKey);
    setCloseaiKey(savedCloseaiKey);

    setKeyStatus({
      openrouter: savedOpenrouterKey.length > 0,
      closeai: savedCloseaiKey.length > 0,
      r2Configured: false,
      r2PublicBaseReachable: false,
      r2MissingEnv: [],
    });

    // Also check if env variables are set
    checkEnvKeys();
  }, []);

  const checkEnvKeys = async () => {
    try {
      const res = await fetch("/api/settings/status");
      if (res.ok) {
        const data = await res.json();
        setKeyStatus((prev) => ({
          openrouter: prev.openrouter || data.openrouter,
          closeai: prev.closeai || data.closeai,
          r2Configured: !!data.r2Configured,
          r2PublicBaseReachable: !!data.r2PublicBaseReachable,
          r2MissingEnv: Array.isArray(data.r2MissingEnv) ? data.r2MissingEnv : [],
        }));
      }
    } catch {
      // API might not exist yet, ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      // Save to localStorage
      if (openrouterKey) {
        localStorage.setItem("OPENROUTER_API_KEY", openrouterKey);
      } else {
        localStorage.removeItem("OPENROUTER_API_KEY");
      }
      if (closeaiKey) {
        localStorage.setItem("CLOSEAI_API_KEY", closeaiKey);
      } else {
        localStorage.removeItem("CLOSEAI_API_KEY");
      }

      setKeyStatus({
        openrouter: openrouterKey.length > 0,
        closeai: closeaiKey.length > 0,
        r2Configured: keyStatus.r2Configured,
        r2PublicBaseReachable: keyStatus.r2PublicBaseReachable,
        r2MissingEnv: keyStatus.r2MissingEnv,
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Save failed:", err);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        &#8592; カレンダーに戻る
      </Link>

      <div>
        <h2 className="text-2xl font-bold text-gray-900">設定</h2>
        <p className="text-sm text-gray-500 mt-1">
          APIキーの設定を管理します
        </p>
      </div>

      {/* Status Overview */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">
          APIキー ステータス
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  keyStatus.openrouter ? "bg-green-500" : "bg-red-400"
                }`}
              />
              <span className="text-sm font-medium text-gray-700">
                OpenRouter API Key (文章生成用)
              </span>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                keyStatus.openrouter
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-600"
              }`}
            >
              {keyStatus.openrouter ? "設定済み" : "未設定"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  keyStatus.closeai ? "bg-green-500" : "bg-red-400"
                }`}
              />
              <span className="text-sm font-medium text-gray-700">
                CloseAI API Key (画像生成用)
              </span>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                keyStatus.closeai
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-600"
              }`}
            >
              {keyStatus.closeai ? "設定済み" : "未設定"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  keyStatus.r2Configured && keyStatus.r2PublicBaseReachable
                    ? "bg-green-500"
                    : keyStatus.r2Configured
                    ? "bg-amber-500"
                    : "bg-red-400"
                }`}
              />
              <span className="text-sm font-medium text-gray-700">
                Cloudflare R2 (Markdown封面图托管)
              </span>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                keyStatus.r2Configured && keyStatus.r2PublicBaseReachable
                  ? "bg-green-100 text-green-700"
                  : keyStatus.r2Configured
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-100 text-red-600"
              }`}
            >
              {keyStatus.r2Configured && keyStatus.r2PublicBaseReachable
                ? "可用"
                : keyStatus.r2Configured
                ? "已配置，公网待检查"
                : "未配置"}
            </span>
          </div>
          {!keyStatus.r2Configured && keyStatus.r2MissingEnv.length > 0 && (
            <p className="text-xs text-rose-600 mt-1">
              缺失变量: {keyStatus.r2MissingEnv.join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* API Key Inputs */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
          APIキー入力
        </h3>

        {/* OpenRouter API Key */}
        <div>
          <label
            htmlFor="openrouter-key"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            OpenRouter API Key
          </label>
          <p className="text-xs text-gray-400 mb-2">
            コンテンツ生成に使用します（OpenRouter経由でClaude Sonnet 4）
          </p>
          <input
            id="openrouter-key"
            type="password"
            value={openrouterKey}
            onChange={(e) => setOpenrouterKey(e.target.value)}
            placeholder="sk-or-v1-..."
            className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent font-mono"
          />
        </div>

        {/* CloseAI API Key */}
        <div>
          <label
            htmlFor="closeai-key"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            CloseAI API Key
          </label>
          <p className="text-xs text-gray-400 mb-2">
            画像生成に使用します（Gemini via CloseAI proxy）
          </p>
          <input
            id="closeai-key"
            type="password"
            value={closeaiKey}
            onChange={(e) => setCloseaiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent font-mono"
          />
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                保存中...
              </span>
            ) : (
              "保存"
            )}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium flex items-center gap-1">
              <svg
                className="w-4 h-4"
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
              保存しました
            </span>
          )}
        </div>
      </div>

      {/* Tips */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p className="text-sm text-amber-800 font-medium mb-1">
          ヒント
        </p>
        <ul className="text-xs text-amber-700 space-y-1">
          <li>
            .env.local ファイルに直接 OPENROUTER_API_KEY と CLOSEAI_API_KEY を設定することもできます
          </li>
          <li>
            Markdown 导出封面图依赖 R2：R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL
          </li>
          <li>
            .env.local に設定されたキーはサーバー再起動後に反映されます
          </li>
          <li>
            localStorage に保存したキーはブラウザごとに異なります
          </li>
          <li>
            .env.local のキーが優先されます（設定されている場合）
          </li>
        </ul>
      </div>
    </div>
  );
}
