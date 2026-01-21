import { useState, useEffect, useCallback } from "react";
import type { QuickActionsData } from "./types";
import { GAME_API_URL } from "../../../lib/api-config";

// Configuration constants
const QUICK_ACTIONS_POLL_INTERVAL_MS = 3000; // Poll every 3 seconds while menu is open

interface UseQuickActionDataResult {
  data: QuickActionsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useQuickActionData(
  agentId: string,
  isOpen: boolean,
  authToken?: string,
): UseQuickActionDataResult {
  const [data, setData] = useState<QuickActionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!agentId) return;

    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch(
        `${GAME_API_URL}/api/agents/${agentId}/quick-actions`,
        { headers },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        setData({
          nearbyLocations: result.nearbyLocations || [],
          availableGoals: result.availableGoals || [],
          quickCommands: result.quickCommands || [],
          inventory: result.inventory || [],
          playerPosition: result.playerPosition || null,
        });
      } else {
        setError(result.error || "Failed to fetch quick actions");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [agentId, authToken]);

  // Fetch on open and poll every 3 seconds while open
  useEffect(() => {
    if (!isOpen) return;

    // Initial fetch
    fetchData();

    // Poll while menu is open
    const interval = setInterval(fetchData, QUICK_ACTIONS_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isOpen, fetchData]);

  return { data, loading, error, refetch: fetchData };
}
