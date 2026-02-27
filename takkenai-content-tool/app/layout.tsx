import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "takkenai.jp Content Tool",
  description: "3-platform content production tool for takkenai.jp",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 min-h-screen">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900">
              takkenai.jp Content Tool
            </h1>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
              3-Platform
            </span>
          </div>
          <a
            href="/settings"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Settings
          </a>
        </header>
        <main className="max-w-6xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
