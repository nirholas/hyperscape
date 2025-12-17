"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NPCContentGenerator } from "@/components/content/NPCContentGenerator";
import { QuestGenerator } from "@/components/content/QuestGenerator";
import { AreaGenerator } from "@/components/content/AreaGenerator";
import { ItemGenerator } from "@/components/content/ItemGenerator";
import {
  Users,
  Scroll,
  Map,
  Sword,
  Cuboid,
  MessageSquare,
  Settings,
  Sparkles,
} from "lucide-react";
import type { GeneratedNPCContent } from "@/types/game/dialogue-types";
import type {
  GeneratedQuestContent,
  GeneratedAreaContent,
  GeneratedItemContent,
} from "@/types/game/content-types";

const mainNavItems = [
  {
    href: "/",
    label: "3D Assets",
    icon: Cuboid,
    description: "Generate 3D models",
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
};

export default function ContentGenerationPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ContentTab>("npc");
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent[]>(
    [],
  );

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
    { id: "area" as const, label: "Areas", icon: Map },
    { id: "item" as const, label: "Items", icon: Sword },
  ];

  const handleNPCGenerated = (content: GeneratedNPCContent) => {
    setGeneratedContent((prev) => [
      {
        type: "npc",
        name: content.name,
        id: content.id,
        timestamp: content.generatedAt,
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
      },
      ...prev,
    ]);
  };

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
        <div className="flex-1 p-3 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider px-3 py-2">
            Content Types
          </p>
          {contentTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                transition-all duration-200
                ${
                  activeTab === tab.id
                    ? "bg-secondary/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <tab.icon className="w-4 h-4" />
              <span className="text-sm">{tab.label}</span>
            </button>
          ))}

          {/* Generated Content History */}
          {generatedContent.length > 0 && (
            <div className="mt-6 pt-4 border-t border-glass-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider px-3 py-2">
                Recent ({generatedContent.length})
              </p>
              <div className="space-y-1">
                {generatedContent.slice(0, 8).map((content) => (
                  <button
                    key={content.id}
                    onClick={() => setActiveTab(content.type)}
                    className="w-full px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-glass-bg text-left"
                  >
                    <div className="font-medium truncate">{content.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {content.type === "npc" && <Users className="w-3 h-3" />}
                      {content.type === "quest" && (
                        <Scroll className="w-3 h-3" />
                      )}
                      {content.type === "area" && <Map className="w-3 h-3" />}
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
        {/* Header */}
        <header className="h-14 border-b border-glass-border px-6 flex items-center bg-glass-bg/20">
          <h2 className="text-lg font-semibold">
            {activeTab === "npc" && "NPC Content Generator"}
            {activeTab === "quest" && "Quest Generator"}
            {activeTab === "area" && "Area Generator"}
            {activeTab === "item" && "Item Generator"}
          </h2>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
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
        </div>
      </main>
    </div>
  );
}
