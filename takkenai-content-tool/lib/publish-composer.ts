import {
  buildInlineImagePrompt,
  injectInlineImageMarkdown,
  pickInlineAnchor,
  type InlineImageAnchor,
} from "./inline-image-placement";
import type { Platform } from "./topic-engine";

export interface ComposePublishInput {
  title: string;
  body: string;
  platform: Platform;
  coverImageUrl?: string;
  inlineImageUrl?: string;
  inlineImageAlt?: string;
}

export interface ComposePublishOutput {
  markdown: string;
  plainText: string;
  html: string;
  anchor: InlineImageAnchor;
  inlinePrompt: string;
}

export interface ComposeBodyPublishOutput {
  markdown: string;
  plainText: string;
  html: string;
  anchor: InlineImageAnchor;
  inlinePrompt: string;
}

function sanitize(input: string): string {
  return (input || "").replace(/\r/g, "").trim();
}

export function stripMarkdownHeadingMarkers(input: string): string {
  const normalized = (input || "").replace(/\r/g, "");
  if (!normalized) return "";
  return normalized
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s{0,3})#{1,6}\s+(.+)$/);
      if (!match) return line;
      return `${match[1]}${match[2]}`;
    })
    .join("\n")
    .trim();
}

function sanitizeAlt(input: string, fallback: string): string {
  const value = (input || "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return value || fallback;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInlineMarkdownToHtml(text: string): string {
  let html = escapeHtml(text);

  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt: string, src: string) =>
      `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:10px 0;" />`
  );

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label: string, href: string) =>
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
  );

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return html;
}

function markdownBodyToHtml(bodyMarkdown: string): string {
  const lines = bodyMarkdown.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length);
      out.push(`<h${level}>${applyInlineMarkdownToHtml(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line)) {
      out.push(`<p>${applyInlineMarkdownToHtml(line)}</p>`);
      i++;
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, "").trim());
        i++;
      }
      out.push(
        `<ul>${items
          .map((item) => `<li>${applyInlineMarkdownToHtml(item)}</li>`)
          .join("")}</ul>`
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "").trim());
        i++;
      }
      out.push(
        `<ol>${items
          .map((item) => `<li>${applyInlineMarkdownToHtml(item)}</li>`)
          .join("")}</ol>`
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      paragraphLines.push(lines[i].trim());
      i++;
    }
    const paragraph = paragraphLines.join("<br />");
    out.push(`<p>${applyInlineMarkdownToHtml(paragraph)}</p>`);
  }

  return out.join("\n");
}

export function composeBodyWithInlineImage(input: {
  body: string;
  title: string;
  platform: Platform;
  inlineImageUrl?: string;
  inlineImageAlt?: string;
}): {
  body: string;
  anchor: InlineImageAnchor;
  inlinePrompt: string;
  inlineAlt: string;
} {
  const body = sanitize(input.body);
  const title = sanitize(input.title);
  const anchor = pickInlineAnchor(body, title);
  const inlineAlt = sanitizeAlt(
    input.inlineImageAlt || anchor.heading,
    `${title || "記事"} 本文イメージ`
  );
  const inlinePrompt = buildInlineImagePrompt({
    title,
    heading: anchor.heading,
    paragraph: anchor.paragraph,
    platform: input.platform,
  });

  const normalized = sanitize(body);
  if (!normalized || !input.inlineImageUrl) {
    return {
      body: normalized,
      anchor,
      inlinePrompt,
      inlineAlt,
    };
  }

  const inlineLine = `![${sanitizeAlt(inlineAlt, "本文イメージ")}](${input.inlineImageUrl})`;
  return {
    body: injectInlineImageMarkdown(normalized, inlineLine, anchor),
    anchor,
    inlinePrompt,
    inlineAlt,
  };
}

export function composeBodyPublishPayload(input: {
  title: string;
  body: string;
  platform: Platform;
  inlineImageUrl?: string;
  inlineImageAlt?: string;
}): ComposeBodyPublishOutput {
  const title = sanitize(input.title);
  const inline = composeBodyWithInlineImage({
    body: input.body,
    title,
    platform: input.platform,
    inlineImageUrl: input.inlineImageUrl,
    inlineImageAlt: input.inlineImageAlt,
  });
  const bodyWithInline = inline.body;
  return {
    markdown: bodyWithInline,
    plainText: stripMarkdownHeadingMarkers(bodyWithInline),
    html: markdownBodyToHtml(bodyWithInline),
    anchor: inline.anchor,
    inlinePrompt: inline.inlinePrompt,
  };
}

export function composePublishPayload(input: ComposePublishInput): ComposePublishOutput {
  const title = sanitize(input.title);
  const body = sanitize(input.body);
  const inline = composeBodyWithInlineImage({
    body,
    title,
    platform: input.platform,
    inlineImageUrl: input.inlineImageUrl,
    inlineImageAlt: input.inlineImageAlt,
  });
  const bodyWithInline = inline.body;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  if (input.coverImageUrl) {
    lines.push(`![${sanitizeAlt(title, "封面图")}](${input.coverImageUrl})`);
    lines.push("");
  }
  lines.push(bodyWithInline);
  lines.push("");

  const markdown = lines.join("\n");

  const htmlParts: string[] = [];
  htmlParts.push(`<h1>${escapeHtml(title)}</h1>`);
  if (input.coverImageUrl) {
    htmlParts.push(
      `<p><img src="${escapeHtml(input.coverImageUrl)}" alt="${escapeHtml(
        sanitizeAlt(title, "封面图")
      )}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:10px 0;" /></p>`
    );
  }
  htmlParts.push(markdownBodyToHtml(bodyWithInline));

  return {
    markdown,
    plainText: stripMarkdownHeadingMarkers(markdown),
    html: htmlParts.join("\n"),
    anchor: inline.anchor,
    inlinePrompt: inline.inlinePrompt,
  };
}
