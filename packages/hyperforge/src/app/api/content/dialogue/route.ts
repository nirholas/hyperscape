/**
 * Dialogue Generation API Route
 * Generate NPC dialogue trees using AI
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils";

const log = logger.child("API:dialogue");
import {
  generateDialogueTree,
  generateNPCContent,
  createEmptyDialogueTree,
} from "@/lib/generation/dialogue-generator";
import type { DialogueGenerationContext } from "@/types/game/dialogue-types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    switch (action) {
      case "generate": {
        // Generate a dialogue tree for an NPC
        const context: DialogueGenerationContext = {
          npcName: params.npcName,
          npcDescription: params.npcDescription,
          npcCategory: params.npcCategory || "neutral",
          npcPersonality: params.npcPersonality,
          npcRole: params.npcRole,
          services: params.services,
          questContext: params.questContext,
          lore: params.lore,
          tone: params.tone,
        };

        if (!context.npcName || !context.npcDescription) {
          return NextResponse.json(
            { error: "NPC name and description are required" },
            { status: 400 },
          );
        }

        const dialogue = await generateDialogueTree(context);

        return NextResponse.json({
          success: true,
          dialogue,
          nodeCount: dialogue.nodes.length,
        });
      }

      case "generateFull": {
        // Generate full NPC content including backstory
        const context: DialogueGenerationContext = {
          npcName: params.npcName,
          npcDescription: params.npcDescription,
          npcCategory: params.npcCategory || "neutral",
          npcPersonality: params.npcPersonality,
          npcRole: params.npcRole,
          services: params.services,
          questContext: params.questContext,
          lore: params.lore,
          tone: params.tone,
        };

        if (!context.npcName || !context.npcDescription) {
          return NextResponse.json(
            { error: "NPC name and description are required" },
            { status: 400 },
          );
        }

        const content = await generateNPCContent(
          context,
          params.generateBackstory !== false,
        );

        return NextResponse.json({
          success: true,
          content,
        });
      }

      case "createEmpty": {
        // Create an empty dialogue tree template
        const npcName = params.npcName || "Unknown NPC";
        const dialogue = createEmptyDialogueTree(npcName);

        return NextResponse.json({
          success: true,
          dialogue,
        });
      }

      default:
        return NextResponse.json(
          {
            error:
              "Invalid action. Use 'generate', 'generateFull', or 'createEmpty'",
          },
          { status: 400 },
        );
    }
  } catch (error) {
    log.error({ error }, "Dialogue generation failed");
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Dialogue generation failed",
      },
      { status: 500 },
    );
  }
}
