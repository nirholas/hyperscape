/**
 * Shared types for Dashboard components
 */

export interface Agent {
  id: string;
  name: string;
  characterName?: string;
  bio?: string;
  status: "active" | "inactive" | string;
  settings?: {
    accountId?: string;
    characterType?: string;
    avatar?: string;
    [key: string]: unknown;
  };
}

export interface AgentPanel {
  id: string;
  name: string;
  url: string;
  type: string;
}
