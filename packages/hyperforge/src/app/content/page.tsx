"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { NPCContentGenerator } from "@/components/content/NPCContentGenerator";
import { QuestGenerator } from "@/components/content/QuestGenerator";
import { AreaGenerator } from "@/components/content/AreaGenerator";
import { ItemGenerator } from "@/components/content/ItemGenerator";
import {
  Users,
  Scroll,
  Map as MapIcon,
  Sword,
  Cuboid,
  MessageSquare,
  Settings,
  Image,
  Music,
  Trash2,
} from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import type { GeneratedNPCContent } from "@/types/game/dialogue-types";
import type {
  GeneratedQuestContent,
  GeneratedAreaContent,
  GeneratedItemContent,
} from "@/types/game/content-types";

// Dynamic import for Sparkles to avoid hydration mismatch
const Sparkles = dynamic(
  () => import("lucide-react").then((mod) => mod.Sparkles),
  { ssr: false, loading: () => <div className="w-5 h-5" /> },
);

const STORAGE_KEY = "hyperforge-generated-content";

const mainNavItems = [
  {
    href: "/",
    label: "3D Assets",
    icon: Cuboid,
    description: "Generate 3D models",
  },
  {
    href: "/assets/images",
    label: "Images",
    icon: Image,
    description: "Concept art & textures",
  },
  {
    href: "/assets/audio",
    label: "Audio",
    icon: Music,
    description: "Sound effects & music",
  },
  {
    href: "/content",
    label: "Content",
    icon: MessageSquare,
    description: "NPC dialogues & lore",
  },
];

type ContentTab = "npc" | "quest" | "area" | "item";

type GeneratedContent = {
  type: "npc" | "quest" | "area" | "item";
  name: string;
  id: string;
  timestamp: string;
  data?:
    | GeneratedNPCContent
    | GeneratedQuestContent
    | GeneratedAreaContent
    | GeneratedItemContent;
};

export default function ContentGenerationPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ContentTab>("npc");
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent[]>(
    [],
  );
  const [selectedContent, setSelectedContent] =
    useState<GeneratedContent | null>(null);

  const [isLoading, setIsLoading] = useState(true);

  // Hydration fix
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load from API and localStorage
  useEffect(() => {
    if (!mounted) return;

    async function loadContent() {
      setIsLoading(true);
      const contentMap = new Map<string, GeneratedContent>();

      // First, load from localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            parsed.forEach((item: GeneratedContent) => {
              contentMap.set(item.id, item);
            });
          }
        }
      } catch {
        // Ignore localStorage errors
      }

      // Then, fetch from API (Supabase)
      try {
        const response = await fetch("/api/content/list");
        if (response.ok) {
          const data = await response.json();
          if (data.success && Array.isArray(data.assets)) {
            for (const asset of data.assets) {
              if (asset.content) {
                // Parse the content based on type
                const content = asset.content;
                const type = asset.type as "npc" | "quest" | "area" | "item";

                let name = "Unknown";
                let id = asset.id;

                if (type === "npc" && content.name) {
                  name = content.name;
                  id = content.id || id;
                } else if (type === "quest" && content.name) {
                  name = content.name;
                  id = content.id || id;
                } else if (type === "area" && content.name) {
                  name = content.name;
                  id = content.id || id;
                } else if (type === "item" && content.name) {
                  name = content.name;
                  id = content.id || id;
                } else if (content.id) {
                  name = content.name || content.id;
                  id = content.id;
                }

                // Skip if type is not valid
                if (!["npc", "quest", "area", "item"].includes(type)) continue;

                const generatedItem: GeneratedContent = {
                  type,
                  name,
                  id,
                  timestamp: asset.createdAt || new Date().toISOString(),
                  data:
                    type === "npc"
                      ? (content as GeneratedNPCContent)
                      : type === "quest"
                        ? ({
                            quest: content,
                            generatedAt: asset.createdAt,
                          } as GeneratedQuestContent)
                        : type === "area"
                          ? ({
                              area: content,
                              generatedAt: asset.createdAt,
                            } as GeneratedAreaContent)
                          : ({
                              item: content,
                              generatedAt: asset.createdAt,
                            } as GeneratedItemContent),
                };

                // Add to map (API content may override localStorage)
                contentMap.set(id, generatedItem);
              }
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch content from API:", error);
      }

      // Convert map to array and sort by timestamp
      const allContent = Array.from(contentMap.values()).sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateB - dateA;
      });

      setGeneratedContent(allContent);
      setIsLoading(false);
    }

    loadContent();
  }, [mounted]);

  // Save to localStorage when content changes
  useEffect(() => {
    if (!mounted || isLoading) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(generatedContent));
    } catch {
      // Ignore localStorage errors
    }
  }, [generatedContent, mounted, isLoading]);

  // Read tab from URL query parameter
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && ["npc", "quest", "area", "item"].includes(tabParam)) {
      setActiveTab(tabParam as ContentTab);
    }
  }, [searchParams]);

  const contentTabs = [
    { id: "npc" as const, label: "NPCs", icon: Users },
    { id: "quest" as const, label: "Quests", icon: Scroll },
    { id: "area" as const, label: "Areas", icon: MapIcon },
    { id: "item" as const, label: "Items", icon: Sword },
  ];

  const handleNPCGenerated = (content: GeneratedNPCContent) => {
    setGeneratedContent((prev) => [
      {
        type: "npc",
        name: content.name,
        id: content.id,
        timestamp: content.generatedAt,
        data: content,
      },
      ...prev,
    ]);
  };

  const handleQuestGenerated = (content: GeneratedQuestContent) => {
    setGeneratedContent((prev) => [
      {
        type: "quest",
        name: content.quest.name,
        id: content.quest.id,
        timestamp: content.generatedAt,
        data: content,
      },
      ...prev,
    ]);
  };

  const handleAreaGenerated = (content: GeneratedAreaContent) => {
    setGeneratedContent((prev) => [
      {
        type: "area",
        name: content.area.name,
        id: content.area.id,
        timestamp: content.generatedAt,
        data: content,
      },
      ...prev,
    ]);
  };

  const handleItemGenerated = (content: GeneratedItemContent) => {
    setGeneratedContent((prev) => [
      {
        type: "item",
        name: content.item.name,
        id: content.item.id,
        timestamp: content.generatedAt,
        data: content,
      },
      ...prev,
    ]);
  };

  const handleDeleteContent = (id: string) => {
    setGeneratedContent((prev) => prev.filter((c) => c.id !== id));
    if (selectedContent?.id === id) {
      setSelectedContent(null);
    }
  };

  const handleSelectContent = (content: GeneratedContent) => {
    setSelectedContent(content);
    setActiveTab(content.type);
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return (
        date.toLocaleDateString() +
        " " +
        date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    } catch {
      return timestamp;
    }
  };

  // Filter content by current tab
  const filteredContent = generatedContent.filter((c) => c.type === activeTab);

  // Show loading skeleton during SSR or initial load
  if (!mounted || isLoading) {
    return (
      <div className="flex h-screen bg-background">
        <aside className="w-64 border-r border-glass-border bg-glass-bg/30" />
        <main className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading content...</p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Side Navigation */}
      <aside className="w-64 border-r border-glass-border bg-glass-bg/30 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-glass-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg">HyperForge</h1>
              <p className="text-xs text-muted-foreground">AI Asset Studio</p>
            </div>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="p-3 space-y-1 border-b border-glass-border">
          {mainNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg
                  transition-all duration-200
                  ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <item.icon className="w-5 h-5" />
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Content Type Tabs */}
        <div className="flex-1 p-3 space-y-1 overflow-y-auto">
          <p className="text-xs text-muted-foreground uppercase tracking-wider px-3 py-2">
            Content Types
          </p>
          {contentTabs.map((tab) => {
            const count = generatedContent.filter(
              (c) => c.type === tab.id,
            ).length;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  w-full flex items-center justify-between px-3 py-2 rounded-lg text-left
                  transition-all duration-200
                  ${
                    activeTab === tab.id
                      ? "bg-secondary/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <tab.icon className="w-4 h-4" />
                  <span className="text-sm">{tab.label}</span>
                </div>
                {count > 0 && (
                  <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Recent Generated Content */}
          {generatedContent.length > 0 && (
            <div className="mt-6 pt-4 border-t border-glass-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider px-3 py-2">
                Recent ({generatedContent.length})
              </p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {generatedContent.slice(0, 10).map((content) => (
                  <button
                    key={content.id}
                    onClick={() => handleSelectContent(content)}
                    className={`
                      w-full px-3 py-2 rounded-lg text-sm cursor-pointer text-left
                      transition-all duration-200
                      ${
                        selectedContent?.id === content.id
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-glass-bg"
                      }
                    `}
                  >
                    <div className="font-medium truncate">{content.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {content.type === "npc" && <Users className="w-3 h-3" />}
                      {content.type === "quest" && (
                        <Scroll className="w-3 h-3" />
                      )}
                      {content.type === "area" && (
                        <MapIcon className="w-3 h-3" />
                      )}
                      {content.type === "item" && <Sword className="w-3 h-3" />}
                      <span className="capitalize">{content.type}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Section */}
        <div className="p-3 border-t border-glass-border">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-colors"
          >
            <Settings className="w-5 h-5" />
            <span className="text-sm">Settings</span>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Past Generations Bar (when there are items for current tab) */}
        {filteredContent.length > 0 && (
          <div className="border-b border-glass-border bg-glass-bg/20 p-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap mr-2">
                Past {contentTabs.find((t) => t.id === activeTab)?.label}:
              </span>
              {filteredContent.slice(0, 8).map((content) => (
                <button
                  key={content.id}
                  onClick={() => handleSelectContent(content)}
                  className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap
                    transition-all duration-200 group
                    ${
                      selectedContent?.id === content.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-glass-bg border border-glass-border hover:border-primary/50"
                    }
                  `}
                >
                  <span className="truncate max-w-[120px]">{content.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteContent(content.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content Area - scrollable */}
        <div className="flex-1 overflow-auto">
          {/* Show selected content details or generator */}
          {selectedContent && selectedContent.type === activeTab ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">
                    {selectedContent.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Generated {formatTimestamp(selectedContent.timestamp)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <SpectacularButton
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedContent(null)}
                  >
                    Create New
                  </SpectacularButton>
                  <SpectacularButton
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteContent(selectedContent.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </SpectacularButton>
                </div>
              </div>

              {/* Content Preview */}
              <GlassPanel className="p-4">
                {selectedContent.type === "npc" && selectedContent.data && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold mb-2">NPC Details</h3>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            Category:
                          </span>{" "}
                          <span className="capitalize">
                            {
                              (selectedContent.data as GeneratedNPCContent)
                                .category
                            }
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Personality:
                          </span>{" "}
                          <span>
                            {
                              (selectedContent.data as GeneratedNPCContent)
                                .personality
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    {(selectedContent.data as GeneratedNPCContent)
                      .backstory && (
                      <div>
                        <h3 className="font-semibold mb-2">Backstory</h3>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {
                            (selectedContent.data as GeneratedNPCContent)
                              .backstory
                          }
                        </p>
                      </div>
                    )}

                    {(selectedContent.data as GeneratedNPCContent).dialogue && (
                      <div>
                        <h3 className="font-semibold mb-2">Dialogue Tree</h3>
                        <div className="text-sm text-muted-foreground">
                          <span>
                            {
                              (selectedContent.data as GeneratedNPCContent)
                                .dialogue.nodes.length
                            }{" "}
                            nodes
                          </span>
                          <span className="mx-2">•</span>
                          <span>
                            Entry:{" "}
                            {
                              (selectedContent.data as GeneratedNPCContent)
                                .dialogue.entryNodeId
                            }
                          </span>
                        </div>
                        <div className="mt-2 p-3 bg-glass-bg/50 rounded-lg max-h-64 overflow-y-auto">
                          {(
                            selectedContent.data as GeneratedNPCContent
                          ).dialogue.nodes.map((node) => (
                            <div key={node.id} className="mb-3 last:mb-0">
                              <div className="font-mono text-xs text-primary">
                                {node.id}
                              </div>
                              <div className="text-sm">{node.text}</div>
                              {node.responses && node.responses.length > 0 && (
                                <div className="ml-4 mt-1 space-y-1">
                                  {node.responses.map((r, i) => (
                                    <div
                                      key={i}
                                      className="text-xs text-muted-foreground"
                                    >
                                      → {r.text}{" "}
                                      <span className="text-primary/60">
                                        [{r.nextNodeId}]
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {selectedContent.type === "quest" && selectedContent.data && (
                  <div className="space-y-4">
                    <h3 className="font-semibold">
                      Quest:{" "}
                      {
                        (selectedContent.data as GeneratedQuestContent).quest
                          .name
                      }
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {
                        (selectedContent.data as GeneratedQuestContent).quest
                          .description
                      }
                    </p>
                  </div>
                )}

                {selectedContent.type === "area" && selectedContent.data && (
                  <div className="space-y-4">
                    <h3 className="font-semibold">
                      Area:{" "}
                      {(selectedContent.data as GeneratedAreaContent).area.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {
                        (selectedContent.data as GeneratedAreaContent).area
                          .description
                      }
                    </p>
                  </div>
                )}

                {selectedContent.type === "item" && selectedContent.data && (
                  <div className="space-y-4">
                    <h3 className="font-semibold">
                      Item:{" "}
                      {(selectedContent.data as GeneratedItemContent).item.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {
                        (selectedContent.data as GeneratedItemContent).item
                          .description
                      }
                    </p>
                  </div>
                )}
              </GlassPanel>
            </div>
          ) : (
            <>
              {activeTab === "npc" && (
                <NPCContentGenerator onContentGenerated={handleNPCGenerated} />
              )}

              {activeTab === "quest" && (
                <QuestGenerator onContentGenerated={handleQuestGenerated} />
              )}

              {activeTab === "area" && (
                <AreaGenerator onContentGenerated={handleAreaGenerated} />
              )}

              {activeTab === "item" && (
                <ItemGenerator onContentGenerated={handleItemGenerated} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
