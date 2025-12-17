import { NextResponse } from "next/server";

/**
 * GET /api/settings/balance
 * Fetches the current Meshy API credit balance
 *
 * @see https://docs.meshy.ai/en/api/balance
 */
export async function GET() {
  const apiKey = process.env.MESHY_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        configured: false,
        error: "MESHY_API_KEY environment variable is not set",
      },
      { status: 200 },
    );
  }

  try {
    const response = await fetch("https://api.meshy.ai/openapi/v1/balance", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          configured: true,
          error: `Failed to fetch balance: ${response.status} ${response.statusText}`,
          details: errorData,
        },
        { status: 200 },
      );
    }

    const data = await response.json();

    return NextResponse.json({
      configured: true,
      balance: data.balance,
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
