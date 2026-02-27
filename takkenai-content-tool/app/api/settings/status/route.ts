import { NextResponse } from "next/server";
import { getImageHostingStatus } from "@/lib/image-hosting";

export async function GET() {
  const hostingStatus = await getImageHostingStatus().catch(() => ({
    r2Configured: false,
    r2PublicBaseReachable: false,
    r2MissingEnv: [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
      "R2_PUBLIC_BASE_URL",
    ],
    activeProvider: "catbox" as const,
    fallbackProviderAvailable: false,
  }));

  return NextResponse.json({
    openrouter:
      !!process.env.OPENROUTER_API_KEY &&
      process.env.OPENROUTER_API_KEY.length > 10,
    closeai:
      !!process.env.CLOSEAI_API_KEY &&
      process.env.CLOSEAI_API_KEY.length > 10,
    r2Configured: hostingStatus.r2Configured,
    r2PublicBaseReachable: hostingStatus.r2PublicBaseReachable,
    r2MissingEnv: hostingStatus.r2MissingEnv,
    activeImageHostingProvider: hostingStatus.activeProvider,
    fallbackProviderAvailable: hostingStatus.fallbackProviderAvailable,
  });
}
