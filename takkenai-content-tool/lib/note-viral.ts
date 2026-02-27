export interface NoteViralBrief {
  enabled: boolean;
  sourceUrl?: string;
  sourceAccount?: string;
  viralPattern?: string;
  sourceTitle?: string;
  hotReason?: string;
  fitReason?: string;
}

function normalizeHttpUrl(raw: string | undefined): string {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function sanitizeText(raw: string | undefined, maxLength: number): string {
  return (raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

export function normalizeNoteViralBrief(
  raw: Partial<NoteViralBrief> | undefined
): NoteViralBrief | undefined {
  if (!raw || raw.enabled !== true) return undefined;

  const sourceUrl = normalizeHttpUrl(raw.sourceUrl);
  const sourceAccount = sanitizeText(raw.sourceAccount, 80);
  const viralPattern = sanitizeText(raw.viralPattern, 280);
  const sourceTitle = sanitizeText(raw.sourceTitle, 120);
  const hotReason = sanitizeText(raw.hotReason, 180);
  const fitReason = sanitizeText(raw.fitReason, 180);

  if (
    !sourceUrl &&
    !sourceAccount &&
    !viralPattern &&
    !sourceTitle &&
    !hotReason &&
    !fitReason
  ) {
    return undefined;
  }

  return {
    enabled: true,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceAccount ? { sourceAccount } : {}),
    ...(viralPattern ? { viralPattern } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    ...(hotReason ? { hotReason } : {}),
    ...(fitReason ? { fitReason } : {}),
  };
}
