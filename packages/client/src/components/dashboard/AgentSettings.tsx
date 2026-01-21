import React from "react";
import { Save, RefreshCw, Trash2, Key, Eye, EyeOff } from "lucide-react";
import { Agent } from "../../screens/DashboardScreen";
import { ELIZAOS_API } from "@/lib/api-config";

interface AgentSettingsProps {
  agent: Agent;
  onDelete?: (agentId: string) => Promise<void>;
}

interface AgentSettingsData {
  accountId?: string;
  characterType?: string;
  avatar?: string;
  [key: string]: unknown;
}

interface SecretsData {
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  [key: string]: string | undefined;
}

export const AgentSettings: React.FC<AgentSettingsProps> = ({
  agent,
  onDelete,
}) => {
  const [settings, setSettings] = React.useState<AgentSettingsData | null>(
    null,
  );
  const [secrets, setSecrets] = React.useState<SecretsData>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [savingSecrets, setSavingSecrets] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("Basic");
  const [showSecrets, setShowSecrets] = React.useState<Record<string, boolean>>(
    {},
  );

  const tabs = ["Basic", "Content", "Style", "API Keys"] as const;

  // Common API key configurations
  const apiKeyConfigs = [
    {
      key: "OPENROUTER_API_KEY",
      label: "OpenRouter API Key",
      placeholder: "sk-or-v1-...",
      description: "Required for LLM access via OpenRouter",
    },
    {
      key: "OPENAI_API_KEY",
      label: "OpenAI API Key",
      placeholder: "sk-...",
      description: "Optional: Direct OpenAI API access",
    },
    {
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic API Key",
      placeholder: "sk-ant-...",
      description: "Optional: Direct Anthropic API access",
    },
  ];

  React.useEffect(() => {
    const fetchSettings = async () => {
      try {
        // Use ElizaOS native agent API endpoint
        const response = await fetch(`${ELIZAOS_API}/agents/${agent.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            // Map ElizaOS agent data to settings format
            const agentData = data.data;
            setSettings({
              name: agentData.name,
              username: agentData.username,
              bio: Array.isArray(agentData.bio)
                ? agentData.bio.join("\n")
                : agentData.bio || agentData.system,
              lore: agentData.lore,
              topics: agentData.topics,
              style: agentData.style,
              adjectives: agentData.adjectives,
              modelProvider: agentData.settings?.model,
            });
            // Extract secrets (they come masked from the API)
            if (agentData.settings?.secrets) {
              const existingSecrets: SecretsData = {};
              for (const key of Object.keys(agentData.settings.secrets)) {
                // Show placeholder if secret exists but is masked
                existingSecrets[key] = agentData.settings.secrets[key] || "";
              }
              setSecrets(existingSecrets);
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [agent.id]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      // Use official ElizaOS API to update agent configuration
      const response = await fetch(`${ELIZAOS_API}/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: settings.name,
          username: settings.username,
          bio: settings.bio,
          lore: settings.lore,
          topics: settings.topics,
          style: settings.style,
          adjectives: settings.adjectives,
        }),
      });
      if (response.ok) {
        console.log("[AgentSettings] ✅ Settings updated successfully");
        // eslint-disable-next-line no-undef
        alert("Settings saved successfully!");
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error("[AgentSettings] ❌ Failed to save settings:", errorData);
        // eslint-disable-next-line no-undef
        alert(
          `Failed to save settings: ${errorData.error || response.statusText}`,
        );
      }
    } catch (error) {
      console.error("[AgentSettings] ❌ Error saving settings:", error);
      // eslint-disable-next-line no-undef
      alert("Error saving settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSecrets = async () => {
    setSavingSecrets(true);
    try {
      // Filter out empty secrets and only send non-empty values
      const secretsToSave: Record<string, string> = {};
      for (const [key, value] of Object.entries(secrets)) {
        if (value && value.trim() && !value.startsWith("***")) {
          secretsToSave[key] = value.trim();
        }
      }

      if (Object.keys(secretsToSave).length === 0) {
        alert("No API keys to save. Please enter at least one API key.");
        setSavingSecrets(false);
        return;
      }

      // Use ElizaOS API to update agent secrets
      const response = await fetch(`${ELIZAOS_API}/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            secrets: secretsToSave,
          },
        }),
      });

      if (response.ok) {
        console.log("[AgentSettings] ✅ API keys saved successfully");
        alert(
          "API keys saved successfully! Restart the agent for changes to take effect.",
        );
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error("[AgentSettings] ❌ Failed to save API keys:", errorData);
        alert(
          `Failed to save API keys: ${errorData.error || response.statusText}`,
        );
      }
    } catch (error) {
      console.error("[AgentSettings] ❌ Error saving API keys:", error);
      alert("Error saving API keys.");
    } finally {
      setSavingSecrets(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(agent.id);
      console.log("[AgentSettings] ✅ Agent deleted successfully");
      // Navigation will happen automatically when agent is removed from list
    } catch (error) {
      console.error("[AgentSettings] ❌ Error deleting agent:", error);
      // eslint-disable-next-line no-undef
      alert("Failed to delete agent. Please try again.");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading)
    return <div className="p-6 text-[#f2d08a]">Loading settings...</div>;
  if (!settings)
    return <div className="p-6 text-red-400">Failed to load settings.</div>;

  return (
    <div className="flex flex-col h-full bg-[#0b0a15]/50 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[#8b4513]/30 bg-[#0b0a15]/80">
        <h2 className="font-bold text-[#f2d08a] text-2xl mb-2">
          Agent Settings
        </h2>
        <p className="text-[#f2d08a]/60 text-sm">
          Configure your AI agent's behaviour and capabilities.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Tabs */}
          <div className="flex border-b border-[#8b4513]/30 gap-6">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab
                    ? "text-[#f2d08a]"
                    : "text-[#f2d08a]/40 hover:text-[#f2d08a]/80"
                }`}
              >
                {tab}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#f2d08a]" />
                )}
              </button>
            ))}
          </div>

          {/* Form Fields - Tab Content */}
          <div className="space-y-6">
            {activeTab === "Basic" && (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#f2d08a]/80">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={(settings.name as string | undefined) || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, name: e.target.value })
                    }
                    className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors"
                  />
                  <p className="text-xs text-[#f2d08a]/40">
                    The primary identifier for this agent
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#f2d08a]/80">
                    Username
                  </label>
                  <input
                    type="text"
                    value={(settings.username as string | undefined) || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, username: e.target.value })
                    }
                    placeholder="@username"
                    className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors"
                  />
                  <p className="text-xs text-[#f2d08a]/40">
                    Used in URLs and API endpoints
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#f2d08a]/80">
                    System Prompt <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={6}
                    value={(settings.bio as string | undefined) || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, bio: e.target.value })
                    }
                    className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors resize-none font-mono text-sm"
                  />
                  <p className="text-xs text-[#f2d08a]/40">
                    System prompt defining agent behavior
                  </p>
                </div>
              </>
            )}

            {activeTab === "Content" && (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#f2d08a]/80">
                    Lore
                  </label>
                  <textarea
                    rows={4}
                    value={
                      Array.isArray(settings.lore)
                        ? (settings.lore as string[]).join("\n")
                        : (settings.lore as string | undefined) || ""
                    }
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        lore: e.target.value.split("\n"),
                      })
                    }
                    placeholder="Background story and lore (one item per line)"
                    className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors resize-none font-mono text-sm"
                  />
                  <p className="text-xs text-[#f2d08a]/40">
                    Background information about the agent (one item per line)
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#f2d08a]/80">
                    Topics
                  </label>
                  <textarea
                    rows={3}
                    value={
                      Array.isArray(settings.topics)
                        ? (settings.topics as string[]).join(", ")
                        : (settings.topics as string | undefined) || ""
                    }
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        topics: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="gaming, rpg, exploration, combat"
                    className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors resize-none"
                  />
                  <p className="text-xs text-[#f2d08a]/40">
                    Topics the agent is knowledgeable about (comma-separated)
                  </p>
                </div>
              </>
            )}

            {activeTab === "Style" && (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#f2d08a]/80">
                    Adjectives
                  </label>
                  <textarea
                    rows={2}
                    value={
                      Array.isArray(settings.adjectives)
                        ? (settings.adjectives as string[]).join(", ")
                        : (settings.adjectives as string | undefined) || ""
                    }
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        adjectives: e.target.value
                          .split(",")
                          .map((a) => a.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="adventurous, strategic, friendly"
                    className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors resize-none"
                  />
                  <p className="text-xs text-[#f2d08a]/40">
                    Personality traits (comma-separated)
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#f2d08a]/80">
                    Communication Style
                  </label>
                  <textarea
                    rows={3}
                    value={
                      typeof settings.style === "object" &&
                      settings.style !== null
                        ? JSON.stringify(settings.style, null, 2)
                        : ""
                    }
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        setSettings({ ...settings, style: parsed });
                      } catch {
                        // Allow typing invalid JSON temporarily
                      }
                    }}
                    placeholder='{"all": ["Be helpful", "Be concise"]}'
                    className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors resize-none font-mono text-sm"
                  />
                  <p className="text-xs text-[#f2d08a]/40">
                    Style configuration (JSON format)
                  </p>
                </div>
              </>
            )}

            {activeTab === "API Keys" && (
              <>
                <div className="bg-[#1a1005]/50 border border-[#8b4513]/30 rounded-lg p-4 mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Key size={16} className="text-[#f2d08a]" />
                    <span className="text-sm font-medium text-[#f2d08a]">
                      API Key Configuration
                    </span>
                  </div>
                  <p className="text-xs text-[#f2d08a]/60">
                    Configure API keys for LLM providers. These are stored
                    securely and used by the agent for AI responses. You'll need
                    to restart the agent after saving for changes to take
                    effect.
                  </p>
                </div>

                {apiKeyConfigs.map((config) => (
                  <div key={config.key} className="space-y-2">
                    <label className="block text-sm font-medium text-[#f2d08a]/80">
                      {config.label}
                    </label>
                    <div className="relative">
                      <input
                        type={showSecrets[config.key] ? "text" : "password"}
                        value={secrets[config.key] || ""}
                        onChange={(e) =>
                          setSecrets({
                            ...secrets,
                            [config.key]: e.target.value,
                          })
                        }
                        placeholder={config.placeholder}
                        className="w-full bg-[#1a1005] border border-[#8b4513]/30 rounded-lg p-3 pr-12 text-[#e8ebf4] focus:border-[#f2d08a] outline-none transition-colors font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => toggleSecretVisibility(config.key)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#f2d08a]/40 hover:text-[#f2d08a] transition-colors"
                      >
                        {showSecrets[config.key] ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-[#f2d08a]/40">
                      {config.description}
                    </p>
                  </div>
                ))}

                <div className="pt-4">
                  <button
                    onClick={handleSaveSecrets}
                    disabled={savingSecrets}
                    className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[#f2d08a] text-[#0b0a15] font-bold hover:bg-[#e5c07b] transition-colors shadow-lg shadow-[#f2d08a]/20 disabled:opacity-50"
                  >
                    <Key size={16} />
                    {savingSecrets ? "Saving..." : "Save API Keys"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="pt-6 flex items-center justify-between gap-4 border-t border-[#8b4513]/30">
            <div>
              {onDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  Delete Agent
                </button>
              )}
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#f2d08a]/30 text-[#f2d08a] hover:bg-[#f2d08a]/10 transition-colors"
              >
                <RefreshCw size={16} />
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[#f2d08a] text-[#0b0a15] font-bold hover:bg-[#e5c07b] transition-colors shadow-lg shadow-[#f2d08a]/20 disabled:opacity-50"
              >
                <Save size={16} />
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0b0a15] border-2 border-red-500/30 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 className="text-red-400" size={24} />
              </div>
              <div>
                <h3 className="font-bold text-[#f2d08a] text-lg">
                  Delete Agent
                </h3>
                <p className="text-[#f2d08a]/60 text-sm">
                  This action cannot be undone
                </p>
              </div>
            </div>

            <p className="text-[#e8ebf4]/80 mb-6">
              Are you sure you want to delete{" "}
              <span className="font-bold text-[#f2d08a]">{agent.name}</span>?
              This will permanently remove the agent and all its data.
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2 rounded-lg border border-[#f2d08a]/30 text-[#f2d08a] hover:bg-[#f2d08a]/10 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-white font-bold hover:bg-red-600 transition-colors disabled:opacity-50 shadow-lg shadow-red-500/20"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
