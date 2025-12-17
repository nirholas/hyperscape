import { NextResponse } from "next/server";

/**
 * GET /api/settings/status
 * Returns the configuration status of all API keys
 */
export async function GET() {
  // AI Gateway can use either AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN
  const aiGatewayKey =
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;

  const status = {
    meshy: {
      configured: !!process.env.MESHY_API_KEY,
      keyPrefix: process.env.MESHY_API_KEY
        ? `${process.env.MESHY_API_KEY.substring(0, 8)}...`
        : null,
    },
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      keyPrefix: process.env.OPENAI_API_KEY
        ? `${process.env.OPENAI_API_KEY.substring(0, 8)}...`
        : null,
    },
    elevenlabs: {
      configured: !!process.env.ELEVENLABS_API_KEY,
      keyPrefix: process.env.ELEVENLABS_API_KEY
        ? `${process.env.ELEVENLABS_API_KEY.substring(0, 8)}...`
        : null,
    },
    supabase: {
      configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      url: process.env.SUPABASE_URL
        ? process.env.SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0] +
          "..."
        : null,
    },
    aiGateway: {
      configured: !!aiGatewayKey,
      keyPrefix: aiGatewayKey ? `${aiGatewayKey.substring(0, 8)}...` : null,
    },
  };

  return NextResponse.json(status);
}
