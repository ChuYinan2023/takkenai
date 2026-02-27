import type { CoverStyleId } from "./cover-style";
import type { CoverTextDensity } from "./cover-profile";
import type { SkillRunMode } from "./site-config";
import type { CoverImageResult } from "./cover-image";

export type BuildCoverResponseInput = {
  filename: string;
  coverResult: CoverImageResult;
  styleId: CoverStyleId;
  stylePack: string;
  textDensity: CoverTextDensity;
  region: string;
  siteId: string;
  mode: SkillRunMode;
};

export function buildCoverApiResponse(input: BuildCoverResponseInput) {
  return {
    filename: input.filename,
    mimeType: input.coverResult.mimeType,
    saved: true,
    imageType: "cover" as const,
    coverStyle: input.styleId,
    stylePack: input.stylePack,
    textDensity: input.textDensity,
    region: input.region,
    qualityCheck: input.coverResult.qualityCheck,
    qualityIssues: input.coverResult.qualityIssues,
    textAdjusted: input.coverResult.textAdjusted,
    imageProviderUsed: input.coverResult.providerUsed,
    imageModelUsed: input.coverResult.modelUsed,
    siteId: input.siteId,
    mode: input.mode,
    imageUrl: `/api/generate-image?filename=${encodeURIComponent(input.filename)}`,
  };
}
