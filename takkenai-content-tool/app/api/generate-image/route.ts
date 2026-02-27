import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  generateCoverImage,
} from "@/lib/cover-image";
import { generateInlineImage } from "@/lib/inline-image";
import {
  DEFAULT_COVER_STYLE,
  getCoverStylesByPlatform,
  isCoverStyleId,
  type CoverStyleId,
} from "@/lib/cover-style";
import { resolveCoverProfile, type CoverTextDensity } from "@/lib/cover-profile";
import {
  ensureDirExists,
  resolveGeneratedOutputDir,
  resolveRunContext,
  type SkillRunMode,
} from "@/lib/site-config";
import type { Platform } from "@/lib/topic-engine";
import { buildCoverApiResponse } from "@/lib/generate-image-response";
import {
  getContentFileBase,
  getGeneratedImagePrefix,
  resolveContentKey,
} from "@/lib/content-variant";

type ImageType = "cover" | "inline";

type RequestBody = {
  prompt: string;
  platform: Platform;
  date: string;
  contentKey?: "standard" | "note-viral";
  siteId?: string;
  language?: string;
  mode?: SkillRunMode;
  articleTitle?: string;
  articleBody?: string;
  hashtags?: string[];
  imageType?: ImageType;
  coverStyle?: CoverStyleId;
  sectionHeading?: string;
  sectionParagraph?: string;
  sectionAlt?: string;
  stylePack?: string;
  textDensity?: CoverTextDensity;
  imageProviderPreference?: "closeai" | "openrouter";
  imageModel?: string;
};

function resolveCoverStyle(style?: string): CoverStyleId {
  if (style && isCoverStyleId(style)) return style;
  return DEFAULT_COVER_STYLE;
}

type NormalizedImageType = "cover" | "inline";

function resolveImageType(type?: string | null): NormalizedImageType {
  return type === "inline" ? "inline" : "cover";
}

function isSupportedImageFile(name: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

function resolveGeneratedDir(mode: SkillRunMode, siteId: string): string {
  const generatedDir = resolveGeneratedOutputDir({ mode, siteId });
  ensureDirExists(generatedDir);
  return generatedDir;
}

function listGeneratedFiles(
  generatedDir: string,
  date: string,
  platform: string,
  imageType: NormalizedImageType,
  contentKey: "standard" | "note-viral"
): string[] {
  const typedPlatform = platform as Platform;
  const prefix = getGeneratedImagePrefix(
    date,
    typedPlatform,
    imageType,
    resolveContentKey(typedPlatform, contentKey)
  );

  return fs
    .readdirSync(generatedDir)
    .filter((file) => file.startsWith(prefix))
    .filter(isSupportedImageFile)
    .sort((a, b) => {
      const aPath = path.join(generatedDir, a);
      const bPath = path.join(generatedDir, b);
      const aMtime = fs.statSync(aPath).mtimeMs;
      const bMtime = fs.statSync(bPath).mtimeMs;
      return bMtime - aMtime;
    });
}

function mimeTypeByExt(fileName: string): string {
  if (fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".jpg")) return "image/jpeg";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function timestampTag(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const platform = searchParams.get("platform");
  const typedPlatform =
    platform === "ameba" || platform === "note" || platform === "hatena"
      ? platform
      : null;
  const resolvedContentKey =
    typedPlatform === null
      ? "standard"
      : resolveContentKey(typedPlatform, searchParams.get("contentKey"));
  const imageType = resolveImageType(searchParams.get("type"));
  const runContext = resolveRunContext({
    siteId: searchParams.get("siteId") || undefined,
    language: searchParams.get("language") || undefined,
    mode: (searchParams.get("mode") as SkillRunMode | null) || undefined,
  });
  const generatedDir = resolveGeneratedDir(runContext.mode, runContext.siteId);
  const stylePack = searchParams.get("stylePack") || undefined;

  if (searchParams.get("styles") === "1") {
    const stylePlatform: Platform =
      platform === "ameba" || platform === "note" || platform === "hatena"
        ? (platform as Platform)
        : "note";
    const resolvedCover = resolveCoverProfile({
      profile: runContext.manifest.cover,
      platform: stylePlatform,
      stylePack,
    });
    const orderedStyles = getCoverStylesByPlatform(stylePlatform);
    return NextResponse.json({
      styles: orderedStyles.filter((item) =>
        resolvedCover.availableStyles.includes(item.id)
      ),
      defaultStyle: resolvedCover.styleId || DEFAULT_COVER_STYLE,
      stylePack: resolvedCover.stylePack,
      textDensity: resolvedCover.textDensity,
      region: resolvedCover.region,
    });
  }

  const filename = searchParams.get("filename");
  if (filename) {
    if (
      filename.includes("/") ||
      filename.includes("\\") ||
      !isSupportedImageFile(filename)
    ) {
      return NextResponse.json({ error: "不正な filename です" }, { status: 400 });
    }

    const imagePath = path.join(generatedDir, filename);
    if (!fs.existsSync(imagePath)) {
      return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
    }

    const imageBuffer = fs.readFileSync(imagePath);
    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": mimeTypeByExt(filename.toLowerCase()),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    });
  }

  if (!date || !platform) {
    return NextResponse.json(
      { error: "date と platform は必須です" },
      { status: 400 }
    );
  }

  const files = listGeneratedFiles(
    generatedDir,
    date,
    platform,
    imageType,
    resolvedContentKey
  );
  if (searchParams.get("list") === "1") {
    return NextResponse.json({
      files,
      latest: files[0] || null,
      type: imageType,
    });
  }

  const latestFile = files[0];
  if (!latestFile) {
    return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
  }

  const imagePath = path.join(generatedDir, latestFile);
  const imageBuffer = fs.readFileSync(imagePath);
  return new NextResponse(imageBuffer, {
    headers: {
      "Content-Type": mimeTypeByExt(latestFile.toLowerCase()),
      "Content-Disposition": `inline; filename="${latestFile}"`,
      "Cache-Control": "no-cache",
    },
  });
}

export async function POST(req: NextRequest) {
  let providerDebug = "";
  try {
    const body = (await req.json()) as RequestBody;
    const {
      prompt,
      platform,
      date,
      articleTitle,
      articleBody,
      hashtags,
      imageType = "cover",
      contentKey,
      coverStyle,
      sectionHeading,
      sectionParagraph,
      sectionAlt,
      stylePack,
      textDensity,
    } = body;
    const runContext = resolveRunContext({
      siteId: body.siteId,
      language: body.language,
      mode: body.mode,
    });

    const normalizedImageProviderPreference = (
      typeof body.imageProviderPreference === "string"
        ? body.imageProviderPreference.trim().toLowerCase()
        : ""
    ) as "closeai" | "openrouter" | "";
    console.log(
      `[generate-image] incoming provider=${String(body.imageProviderPreference || "")} normalized=${normalizedImageProviderPreference || "(empty)"} model=${String(body.imageModel || "")} platform=${String(
        body.platform || ""
      )} type=${String(body.imageType || "cover")}`
    );
    if (
      normalizedImageProviderPreference !== "closeai" &&
      normalizedImageProviderPreference !== "openrouter"
    ) {
      return NextResponse.json(
        { error: "画像提供商未指定或不正确。请先明确选择 closeai 或 openrouter 后再生成。" },
        { status: 400 }
      );
    }
    const imageProviderPreference = normalizedImageProviderPreference;
    providerDebug = imageProviderPreference;

    if (!platform || !date) {
      return NextResponse.json(
        { error: "platform, date は必須です" },
        { status: 400 }
      );
    }

    if (!["ameba", "note", "hatena"].includes(platform)) {
      return NextResponse.json(
        { error: "無効なプラットフォームです" },
        { status: 400 }
      );
    }
    const resolvedContentKey = resolveContentKey(platform, contentKey);
    const contentFileBase = getContentFileBase(date, platform, resolvedContentKey);

    if (!articleTitle || !articleBody) {
      return NextResponse.json(
        { error: "articleTitle と articleBody は必須です" },
        { status: 400 }
      );
    }

    const generatedDir = resolveGeneratedDir(runContext.mode, runContext.siteId);

    if (imageType === "cover") {
      if (
        imageProviderPreference === "openrouter" &&
        !(process.env.OPENROUTER_API_KEY || "").trim()
      ) {
        return NextResponse.json(
          { error: "openrouter を選択しましたが、OPENROUTER_API_KEY が設定されていません" },
          { status: 400 }
        );
      }
      if (
        imageProviderPreference === "closeai" &&
        !(process.env.CLOSEAI_API_KEY || "").trim()
      ) {
        return NextResponse.json(
          { error: "closeai を選択しましたが、CLOSEAI_API_KEY が設定されていません" },
          { status: 400 }
        );
      }

      const resolvedCover = resolveCoverProfile({
        profile: runContext.manifest.cover,
        platform,
        stylePack,
        textDensity,
        styleId: coverStyle,
      });
      const styleId = resolveCoverStyle(resolvedCover.styleId);
      console.log(
        `[cover-image] mode=${runContext.mode}, site=${runContext.siteId}, platform=${platform}, provider=${imageProviderPreference}, style=${styleId}, density=${resolvedCover.textDensity}, title=${articleTitle.slice(0, 30)}…`
      );

      const coverResult = await generateCoverImage({
        title: articleTitle,
        body: articleBody,
        platform,
        hashtags: hashtags || [],
        styleId,
        imageProviderPreference,
        imageModel: body.imageModel,
      });

      const filename = `${contentFileBase}-cover-${styleId}-${timestampTag()}.${coverResult.ext}`;
      const outputPath = path.join(generatedDir, filename);
      fs.writeFileSync(outputPath, coverResult.imageBuffer);

      console.log(`[cover-image] saved ${filename} (${coverResult.imageBuffer.length} bytes)`);

      return NextResponse.json(
        buildCoverApiResponse({
          filename,
          coverResult,
          styleId,
          stylePack: resolvedCover.stylePack,
          textDensity: resolvedCover.textDensity,
          region: resolvedCover.region,
          siteId: runContext.siteId,
          mode: runContext.mode,
        })
      );
    }

    const inlinePrompt = [prompt || "", sectionHeading || "", sectionParagraph || ""]
      .map((item) => (item || "").trim())
      .filter(Boolean)
      .join("\n");
    if (!inlinePrompt) {
      return NextResponse.json(
        { error: "inline 画像生成には prompt または段落コンテキストが必要です" },
        { status: 400 }
      );
    }

    console.log(
      `[inline-image] mode=${runContext.mode}, site=${runContext.siteId}, platform=${platform}, provider=${imageProviderPreference}, title=${articleTitle.slice(
        0,
        30
      )}…`
    );

    if (
      imageProviderPreference === "openrouter" &&
      !(process.env.OPENROUTER_API_KEY || "").trim()
    ) {
      return NextResponse.json(
        { error: "openrouter を選択しましたが、OPENROUTER_API_KEY が設定されていません" },
        { status: 400 }
      );
    }
    if (
      imageProviderPreference === "closeai" &&
      !(process.env.CLOSEAI_API_KEY || "").trim()
    ) {
      return NextResponse.json(
        { error: "closeai を選択しましたが、CLOSEAI_API_KEY が設定されていません" },
        { status: 400 }
      );
    }

    const inlineResult = await generateInlineImage({
      title: articleTitle,
      body: sectionParagraph || articleBody,
      platform,
      prompt: inlinePrompt,
      imageProviderPreference,
      imageModel: body.imageModel,
    });
    const inlineBuffer = inlineResult.imageBuffer;

    const filename = `${contentFileBase}-inline-${timestampTag()}.png`;
    const outputPath = path.join(generatedDir, filename);
    fs.writeFileSync(outputPath, inlineBuffer);

    console.log(`[inline-image] saved ${filename} (${inlineBuffer.length} bytes)`);

    return NextResponse.json({
      filename,
      mimeType: "image/png",
      saved: true,
      imageType: "inline",
      imageProviderUsed: inlineResult.providerUsed,
      imageModelUsed: inlineResult.modelUsed,
      sectionHeading: sectionHeading || "",
      sectionAlt: sectionAlt || "",
      siteId: runContext.siteId,
      mode: runContext.mode,
      imageUrl: `/api/generate-image?filename=${encodeURIComponent(filename)}`,
    });
  } catch (err: unknown) {
    console.error("Image generation failed:", err);
    const rawMessage =
      err instanceof Error ? err.message : "不明なエラーが発生しました";
    const readabilityOverflow = /readability check failed/i.test(rawMessage) &&
      /(clip|crop|overflow|safe|trunc|切|見切|画面外|はみ出|text-clipped|text-cropped)/i.test(
        rawMessage
      );
    const message = readabilityOverflow
      ? "封面文字可能超出画布，系统已自动压缩文案并重试；仍失败时建议换封面类型"
      : rawMessage;
    return NextResponse.json(
      { error: providerDebug ? `${message} [provider=${providerDebug}]` : message },
      { status: 500 }
    );
  }
}
