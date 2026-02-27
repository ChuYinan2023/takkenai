import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "fs";
import path from "path";
import type { Platform } from "./topic-engine";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InfoSection {
  title: string;
  points: string[];
}

interface InfographicParams {
  title: string;
  body: string;
  platform: Platform;
  hashtags?: string[];
}

// ---------------------------------------------------------------------------
// Platform color themes
// ---------------------------------------------------------------------------

interface PlatformTheme {
  headerBg: string;
  headerText: string;
  bodyBg: string;
  cardBg: string;
  cardBorder: string;
  sectionTitleColor: string;
  numberBg: string;
  numberText: string;
  textColor: string;
  bulletColor: string;
  accentLine: string;
  footerBg: string;
  footerText: string;
}

const THEMES: Record<Platform, PlatformTheme> = {
  ameba: {
    headerBg: "#EA580C",
    headerText: "#FFFFFF",
    bodyBg: "#FFF7ED",
    cardBg: "#FFFFFF",
    cardBorder: "#FED7AA",
    sectionTitleColor: "#7C2D12",
    numberBg: "#F97316",
    numberText: "#FFFFFF",
    textColor: "#1C1917",
    bulletColor: "#EA580C",
    accentLine: "#FDBA74",
    footerBg: "#7C2D12",
    footerText: "#FED7AA",
  },
  note: {
    headerBg: "#1E3A5F",
    headerText: "#FFFFFF",
    bodyBg: "#EFF6FF",
    cardBg: "#FFFFFF",
    cardBorder: "#BFDBFE",
    sectionTitleColor: "#0F2942",
    numberBg: "#2563EB",
    numberText: "#FFFFFF",
    textColor: "#0F172A",
    bulletColor: "#2563EB",
    accentLine: "#93C5FD",
    footerBg: "#1E3A5F",
    footerText: "#93C5FD",
  },
  hatena: {
    headerBg: "#14532D",
    headerText: "#FFFFFF",
    bodyBg: "#F0FDF4",
    cardBg: "#FFFFFF",
    cardBorder: "#BBF7D0",
    sectionTitleColor: "#052E16",
    numberBg: "#16A34A",
    numberText: "#FFFFFF",
    textColor: "#0F172A",
    bulletColor: "#16A34A",
    accentLine: "#86EFAC",
    footerBg: "#14532D",
    footerText: "#86EFAC",
  },
};

const PLATFORM_LABELS: Record<Platform, string> = {
  ameba: "Ameba Blog",
  note: "note",
  hatena: "はてなブログ",
};

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function stripEmoji(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\u2600-\u27BF]/g, "")
    .trim();
}

function truncate(text: string, max: number): string {
  const clean = stripEmoji(text);
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}

function extractIntro(body: string): string {
  // Find the first section marker (【】 or ##)
  const bracketIdx = body.indexOf("【");
  const headingMatch = body.match(/^##\s/m);
  const headingIdx = headingMatch ? body.indexOf(headingMatch[0]) : -1;

  let firstSection = -1;
  if (bracketIdx > 0 && headingIdx > 0) {
    firstSection = Math.min(bracketIdx, headingIdx);
  } else if (bracketIdx > 0) {
    firstSection = bracketIdx;
  } else if (headingIdx > 0) {
    firstSection = headingIdx;
  }

  if (firstSection <= 0) return "";
  const intro = stripEmoji(body.slice(0, firstSection).trim());
  const lines = intro
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 10);
  return lines.length > 0 ? truncate(lines[0], 70) : "";
}

/**
 * Extract key points from a section's content.
 * Looks for bullet points first, then falls back to extracting
 * the first sentence from each paragraph.
 */
function extractPoints(content: string): string[] {
  const points: string[] = [];
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);

  // Pass 1: explicit bullet points and quiz options
  for (const line of lines) {
    if (
      line.startsWith("・") ||
      line.startsWith("- ") ||
      line.startsWith("✓")
    ) {
      points.push(truncate(line, 45));
    } else if (/^[A-D]\.\s/.test(line)) {
      points.push(truncate(line, 45));
    }
  }
  if (points.length > 0) return points.slice(0, 5);

  // Pass 2: extract first sentence of each paragraph
  const paragraphs = content.split("\n\n").filter((p) => p.trim());
  for (const para of paragraphs) {
    const clean = stripEmoji(para.trim());
    if (
      clean.length < 8 ||
      clean.startsWith("http") ||
      clean.startsWith("考えて")
    )
      continue;

    // Take first sentence (up to 。or full stop)
    const sentenceEnd = clean.indexOf("。");
    const sentence =
      sentenceEnd > 0 && sentenceEnd < 60
        ? clean.slice(0, sentenceEnd + 1)
        : truncate(clean, 55);
    points.push(sentence);
    if (points.length >= 3) break;
  }

  return points;
}

function extractSections(body: string): InfoSection[] {
  // Detect format: 【brackets】 or ## markdown headings
  const hasBrackets = /【.+?】/.test(body);
  const hasHeadings = /^##\s+.+$/m.test(body);

  if (hasBrackets) {
    return extractBracketSections(body);
  } else if (hasHeadings) {
    return extractMarkdownSections(body);
  }
  return [];
}

function extractBracketSections(body: string): InfoSection[] {
  const parts = body.split(/【(.+?)】/);
  const sections: InfoSection[] = [];

  for (let i = 1; i < parts.length; i += 2) {
    const rawTitle = parts[i].trim();
    const content = (parts[i + 1] || "").trim();

    // Skip CTA sections
    if (rawTitle.includes("今すぐチェック")) continue;
    if (rawTitle.includes("今すぐ") && rawTitle.includes("チェック")) continue;

    const points = extractPoints(content);
    if (points.length > 0) {
      sections.push({
        title: truncate(rawTitle, 20),
        points,
      });
    }
  }

  return sections.slice(0, 6);
}

function extractMarkdownSections(body: string): InfoSection[] {
  // Split by ## headings (not ### sub-headings)
  const parts = body.split(/^##\s+(.+)$/m);
  const sections: InfoSection[] = [];

  for (let i = 1; i < parts.length; i += 2) {
    const rawTitle = parts[i].trim();
    const content = (parts[i + 1] || "").trim();

    // Skip summary/conclusion sections
    if (rawTitle === "まとめ" || rawTitle === "おわりに") continue;

    const points = extractPoints(content);
    if (points.length > 0) {
      sections.push({
        title: truncate(rawTitle, 20),
        points,
      });
    }
  }

  return sections.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Font loading (cached in module scope)
// ---------------------------------------------------------------------------

let fontDataCache: Buffer | null = null;

async function loadFont(): Promise<Buffer> {
  if (fontDataCache) return fontDataCache;
  const fontPath = path.join(
    process.cwd(),
    "public",
    "fonts",
    "NotoSansJP-Static.ttf"
  );
  fontDataCache = await fs.promises.readFile(fontPath);
  return fontDataCache;
}

// ---------------------------------------------------------------------------
// Infographic generation
// ---------------------------------------------------------------------------

export async function generateInfographic(
  params: InfographicParams
): Promise<Buffer> {
  const { title, body, platform, hashtags = [] } = params;
  const sections = extractSections(body);
  const theme = THEMES[platform];
  const fontData = await loadFont();

  const displayTitle = truncate(title, 55);
  const introText = extractIntro(body);
  const displayTags = hashtags.slice(0, 8);

  // Layout calculations
  const WIDTH = 1792;
  const HEIGHT = 1024;
  const PADDING = 48;
  const CARD_GAP = 20;
  const contentWidth = WIDTH - PADDING * 2;

  // Determine card grid
  const count = sections.length;
  const cols = count <= 2 ? (count || 1) : count <= 4 ? 2 : 3;
  const cardW = Math.floor((contentWidth - (cols - 1) * CARD_GAP) / cols);

  // Calculate rows for card height
  const rows = Math.ceil(count / cols);
  // Available height: total - header(~140) - footer(~50) - padding(~40)
  const availableCardHeight = HEIGHT - 150 - 50 - 50;
  const cardH = Math.floor(
    (availableCardHeight - (rows - 1) * CARD_GAP) / rows
  );

  // Build the section cards
  const sectionCards: ReactNode[] = sections.map((section, idx) => {
    const isEndOfRow = (idx + 1) % cols === 0;

    const pointNodes: ReactNode[] = section.points.map((point, pIdx) => {
      const isBullet = point.startsWith("・") || point.startsWith("- ");
      const displayText = isBullet ? point.replace(/^[・\-]\s*/, "") : point;

      return (
        <div
          key={pIdx}
          style={{
            display: "flex",
            alignItems: "flex-start",
            marginBottom: 8,
            fontSize: 24,
            color: theme.textColor,
            lineHeight: 1.5,
          }}
        >
          {isBullet ? (
            <div
              style={{
                display: "flex",
                color: theme.bulletColor,
                fontWeight: 700,
                marginRight: 10,
                fontSize: 14,
                marginTop: 8,
                flexShrink: 0,
              }}
            >
              {"●"}
            </div>
          ) : null}
          <div style={{ display: "flex" }}>{displayText}</div>
        </div>
      );
    });

    return (
      <div
        key={idx}
        style={{
          display: "flex",
          flexDirection: "column",
          width: cardW,
          height: cardH,
          backgroundColor: theme.cardBg,
          border: `2px solid ${theme.cardBorder}`,
          borderRadius: 14,
          padding: "20px 24px",
          marginRight: isEndOfRow ? 0 : CARD_GAP,
          marginBottom: CARD_GAP,
        }}
      >
        {/* Section header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: theme.numberBg,
              color: theme.numberText,
              fontSize: 20,
              fontWeight: 700,
              marginRight: 12,
              flexShrink: 0,
            }}
          >
            {String(idx + 1)}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 700,
              color: theme.sectionTitleColor,
              lineHeight: 1.3,
            }}
          >
            {section.title}
          </div>
        </div>

        {/* Accent line */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: 3,
            backgroundColor: theme.accentLine,
            marginBottom: 12,
          }}
        />

        {/* Points */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          {pointNodes}
        </div>
      </div>
    );
  });

  // Build hashtag nodes
  const tagNodes: ReactNode[] = displayTags.map((tag, i) => (
    <div
      key={i}
      style={{
        display: "flex",
        fontSize: 20,
        color: theme.footerText,
        marginRight: 20,
        opacity: 0.9,
      }}
    >
      {`#${tag}`}
    </div>
  ));

  const element = (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.bodyBg,
        fontFamily: "NotoSansJP",
      }}
    >
      {/* ---- Header ---- */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: theme.headerBg,
          padding: "30px 56px 28px",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 17,
              color: theme.headerText,
              opacity: 0.8,
            }}
          >
            {PLATFORM_LABELS[platform]}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 17,
              color: theme.headerText,
              opacity: 0.8,
            }}
          >
            {"takkenai.jp"}
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            fontSize: 42,
            fontWeight: 700,
            color: theme.headerText,
            lineHeight: 1.35,
          }}
        >
          {displayTitle}
        </div>

        {/* Intro subtitle */}
        {introText ? (
          <div
            style={{
              display: "flex",
              fontSize: 18,
              color: theme.headerText,
              opacity: 0.85,
              marginTop: 10,
              lineHeight: 1.4,
            }}
          >
            {introText}
          </div>
        ) : null}
      </div>

      {/* ---- Body: section cards ---- */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexWrap: "wrap",
          padding: `24px ${PADDING}px 10px`,
          alignContent: "flex-start",
        }}
      >
        {sectionCards}
      </div>

      {/* ---- Footer ---- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: theme.footerBg,
          padding: "14px 56px",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap" }}>{tagNodes}</div>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            color: theme.footerText,
          }}
        >
          {"takkenai.jp"}
        </div>
      </div>
    </div>
  );

  // Render JSX → SVG via Satori
  const svg = await satori(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      {
        name: "NotoSansJP",
        data: fontData,
        style: "normal",
      },
    ],
  });

  // Convert SVG → PNG via Resvg
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}
