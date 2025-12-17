"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DialogueTreeEditor } from "@/components/content/DialogueTreeEditor";
import {
  ArrowLeft,
  Plus,
  Sparkles,
  Loader2,
  Save,
  MessageSquare,
  Settings,
} from "lucide-react";
import type { DialogueTree } from "@/types/game/dialogue-types";
import { logger } from "@/lib/utils";

const log = logger.child("DialoguePage");

interface SavedDialogue {
  id: string;
  npcName: string;
  npcId: string;
  tree: DialogueTree;
  updatedAt: string;
}

function DialogueEditorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [savedDialogues, setSavedDialogues] = useState<SavedDialogue[]>([]);
  const [selectedDialogueId, setSelectedDialogueId] = useState<string | null>(
    null,
  );
  const [currentDialogue, setCurrentDialogue] = useState<SavedDialogue | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [npcName, setNpcName] = useState("New NPC");
  const [showNewDialogueForm, setShowNewDialogueForm] = useState(false);

  // Load dialogues from local storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("hyperforge_dialogues");
      if (stored) {
        const dialogues = JSON.parse(stored) as SavedDialogue[];
        setSavedDialogues(dialogues);
      }
    } catch (err) {
      log.error("Failed to load dialogues:", err);
    }
    setIsLoading(false);
  }, []);

  // Check for NPC ID in URL
  useEffect(() => {
    const npcId = searchParams.get("npc");
    if (npcId && savedDialogues.length > 0) {
      const dialogue = savedDialogues.find((d) => d.npcId === npcId);
      if (dialogue) {
        setSelectedDialogueId(dialogue.id);
        setCurrentDialogue(dialogue);
        setNpcName(dialogue.npcName);
      }
    }
  }, [searchParams, savedDialogues]);

  // Save dialogues to local storage
  const saveToStorage = useCallback((dialogues: SavedDialogue[]) => {
    try {
      localStorage.setItem("hyperforge_dialogues", JSON.stringify(dialogues));
    } catch (err) {
      log.error("Failed to save dialogues:", err);
    }
  }, []);

  // Create new dialogue
  const handleCreateNew = useCallback(() => {
    const newId = `dialogue_${Date.now()}`;
    const newNpcId = `npc_${Date.now()}`;
    const newDialogue: SavedDialogue = {
      id: newId,
      npcName,
      npcId: newNpcId,
      tree: {
        entryNodeId: "greeting",
        nodes: [
          {
            id: "greeting",
            text: "Hello, traveler! What brings you here today?",
            responses: [
              { text: "I'm looking for work.", nextNodeId: "work" },
              { text: "Just passing through.", nextNodeId: "farewell" },
            ],
          },
          {
            id: "work",
            text: "Ah, work you say? Well, there's always something that needs doing...",
            responses: [
              { text: "Tell me more.", nextNodeId: "quest" },
              { text: "Never mind.", nextNodeId: "farewell" },
            ],
          },
          {
            id: "quest",
            text: "There's a problem in the nearby cave. Monsters have been terrorizing the village!",
            responses: [{ text: "I'll help!", nextNodeId: "accept" }],
          },
          {
            id: "accept",
            text: "Wonderful! Return when you've dealt with the threat.",
            responses: [{ text: "Farewell.", nextNodeId: "end" }],
          },
          {
            id: "farewell",
            text: "Safe travels, friend!",
            responses: [{ text: "Goodbye.", nextNodeId: "end" }],
          },
        ],
      },
      updatedAt: new Date().toISOString(),
    };

    const updated = [...savedDialogues, newDialogue];
    setSavedDialogues(updated);
    saveToStorage(updated);
    setCurrentDialogue(newDialogue);
    setSelectedDialogueId(newId);
    setShowNewDialogueForm(false);

    // Update URL with npc id
    router.push(`/content/dialogue?npc=${newNpcId}`);
  }, [npcName, savedDialogues, saveToStorage, router]);

  // Save dialogue tree
  const handleSaveTree = useCallback(
    (tree: DialogueTree) => {
      if (!currentDialogue) return;

      setIsSaving(true);
      const updated = savedDialogues.map((d) =>
        d.id === currentDialogue.id
          ? { ...d, tree, updatedAt: new Date().toISOString() }
          : d,
      );
      setSavedDialogues(updated);
      saveToStorage(updated);
      setCurrentDialogue({ ...currentDialogue, tree });
      setIsSaving(false);
    },
    [currentDialogue, savedDialogues, saveToStorage],
  );

  // Select existing dialogue
  const handleSelectDialogue = useCallback(
    (dialogue: SavedDialogue) => {
      setSelectedDialogueId(dialogue.id);
      setCurrentDialogue(dialogue);
      setNpcName(dialogue.npcName);
      router.push(`/content/dialogue?npc=${dialogue.npcId}`);
    },
    [router],
  );

  // Delete dialogue
  const handleDeleteDialogue = useCallback(
    (id: string) => {
      const updated = savedDialogues.filter((d) => d.id !== id);
      setSavedDialogues(updated);
      saveToStorage(updated);
      if (selectedDialogueId === id) {
        setSelectedDialogueId(null);
        setCurrentDialogue(null);
        router.push("/content/dialogue");
      }
    },
    [savedDialogues, saveToStorage, selectedDialogueId, router],
  );

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
              <p className="text-xs text-muted-foreground">Dialogue Editor</p>
            </div>
          </div>
        </div>

        {/* Back Link */}
        <div className="p-3 border-b border-glass-border">
          <Link
            href="/content"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back to Content</span>
          </Link>
        </div>

        {/* New Dialogue Button */}
        <div className="p-3">
          <button
            onClick={() => setShowNewDialogueForm(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">New Dialogue</span>
          </button>
        </div>

        {/* New Dialogue Form */}
        {showNewDialogueForm && (
          <div className="px-3 pb-3 space-y-2">
            <input
              type="text"
              value={npcName}
              onChange={(e) => setNpcName(e.target.value)}
              placeholder="NPC Name..."
              className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateNew}
                className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowNewDialogueForm(false)}
                className="px-3 py-1.5 rounded-lg border border-glass-border text-sm hover:bg-glass-bg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Saved Dialogues List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider px-3 py-2">
            Saved Dialogues ({savedDialogues.length})
          </p>
          {savedDialogues.map((dialogue) => (
            <div
              key={dialogue.id}
              className={`
                group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer
                ${selectedDialogueId === dialogue.id ? "bg-primary/10 border border-primary/20" : "hover:bg-glass-bg"}
              `}
            >
              <button
                onClick={() => handleSelectDialogue(dialogue)}
                className="flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {dialogue.npcName}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground ml-6">
                  {dialogue.tree.nodes.length} nodes
                </span>
              </button>
              <button
                onClick={() => handleDeleteDialogue(dialogue.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
                title="Delete"
              >
                <span className="text-xs">×</span>
              </button>
            </div>
          ))}
          {savedDialogues.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No saved dialogues yet
            </p>
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
        <header className="h-14 border-b border-glass-border px-6 flex items-center justify-between bg-glass-bg/20">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {currentDialogue
                ? currentDialogue.npcName
                : "Dialogue Tree Editor"}
            </h2>
          </div>
          {isSaving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Save className="w-4 h-4 animate-pulse" />
              Saving...
            </div>
          )}
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {currentDialogue ? (
            <DialogueTreeEditor
              initialTree={currentDialogue.tree}
              npcName={currentDialogue.npcName}
              npcId={currentDialogue.npcId}
              onSave={handleSaveTree}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-24 h-24 rounded-full bg-glass-bg flex items-center justify-center mb-4">
                <MessageSquare className="w-12 h-12 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold text-muted-foreground mb-2">
                No Dialogue Selected
              </h3>
              <p className="text-sm text-muted-foreground max-w-md mb-6">
                Create a new dialogue tree or select an existing one from the
                sidebar to start editing NPC conversations.
              </p>
              <button
                onClick={() => setShowNewDialogueForm(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create New Dialogue
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function DialogueEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <DialogueEditorContent />
    </Suspense>
  );
}
