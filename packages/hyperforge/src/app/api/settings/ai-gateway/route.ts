import { NextResponse } from "next/server";

/**
 * GET /api/settings/ai-gateway
 * Fetches the Vercel AI Gateway credit balance and usage
 *
 * @see https://ai-gateway.vercel.sh/v1/credits
 */
export async function GET() {
  // Try AI_GATEWAY_API_KEY first, then fall back to VERCEL_OIDC_TOKEN
  const apiKey =
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;

  if (!apiKey) {
    return NextResponse.json(
      {
        configured: false,
        error:
          "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN environment variable is not set",
      },
      { status: 200 },
    );
  }

  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          configured: true,
          error: `Failed to fetch credits: ${response.status} ${response.statusText}`,
          details: errorData,
        },
        { status: 200 },
      );
    }

    const data = await response.json();

    return NextResponse.json({
      configured: true,
      balance: parseFloat(data.balance),
      totalUsed: parseFloat(data.total_used),
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        error: `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 200 },
    );
  }
}
