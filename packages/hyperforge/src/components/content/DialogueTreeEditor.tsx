"use client";

import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  Plus,
  Trash2,
  Save,
  Wand2,
  Mic,
  Play,
  Pause,
  Volume2,
  Loader2,
} from "lucide-react";
import type {
  DialogueTree,
  DialogueNode,
  DialogueResponse,
  DialogueAudio,
} from "@/types/game/dialogue-types";
import { logger } from "@/lib/utils";

const log = logger.child("DialogueTreeEditor");

interface DialogueTreeEditorProps {
  initialTree?: DialogueTree;
  npcName: string;
  npcId?: string;
  onSave: (tree: DialogueTree) => void;
  onGenerate?: () => void;
}

interface VoicePreset {
  id: string;
  voiceId: string;
  name: string;
  description: string;
}

// Custom node component for dialogue nodes
function DialogueNodeComponent({
  data,
  selected,
}: {
  data: {
    label: string;
    text: string;
    responses: DialogueResponse[];
    isEntry: boolean;
    hasAudio: boolean;
    onEdit: () => void;
  };
  selected: boolean;
}) {
  return (
    <div
      className={`
        p-3 rounded-lg border-2 min-w-[200px] max-w-[300px]
        ${selected ? "border-primary shadow-lg shadow-primary/20" : "border-glass-border"}
        ${data.isEntry ? "bg-green-900/30" : "bg-glass-bg"}
        backdrop-blur-sm
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-primary"
      />

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground">
          {data.label}
        </span>
        <div className="flex items-center gap-1">
          {data.hasAudio && (
            <span className="text-[10px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded flex items-center gap-1">
              <Volume2 className="w-3 h-3" />
            </span>
          )}
          {data.isEntry && (
            <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
              ENTRY
            </span>
          )}
        </div>
      </div>

      <p className="text-sm mb-2 text-foreground">{data.text}</p>

      {data.responses && data.responses.length > 0 && (
        <div className="space-y-1 border-t border-glass-border pt-2">
          {data.responses.map((response, index) => (
            <div
              key={index}
              className="text-xs text-muted-foreground bg-glass-bg/50 px-2 py-1 rounded"
            >
              → {response.text}
              {response.effect && (
                <span className="ml-1 text-primary">[{response.effect}]</span>
              )}
            </div>
          ))}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-primary"
      />
    </div>
  );
}

const nodeTypes = {
  dialogue: DialogueNodeComponent,
};

export function DialogueTreeEditor({
  initialTree,
  npcName: _npcName, // Reserved for future display in header
  npcId,
  onSave,
  onGenerate,
}: DialogueTreeEditorProps) {
  const { toast } = useToast();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<DialogueNode | null>(null);

  // Audio state
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [nodeAudio, setNodeAudio] = useState<Map<string, DialogueAudio>>(
    new Map(),
  );
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isGeneratingAllAudio, setIsGeneratingAllAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [, setCurrentAudioUrl] = useState<string | null>(null); // Value used by audio player
  const audioRef = useRef<globalThis.HTMLAudioElement | null>(null);

  // Load voice presets on mount
  useState(() => {
    async function loadVoicePresets() {
      try {
        const res = await fetch("/api/audio/voices?type=presets");
        if (res.ok) {
          const data = await res.json();
          setVoicePresets(data.voices || []);
          if (data.voices?.length > 0) {
            setSelectedVoice(data.voices[0].id);
          }
        }
      } catch (err) {
        log.error("Failed to load voice presets:", err);
      }
    }
    loadVoicePresets();
  });

  // Generate audio for a single node
  const generateNodeAudio = useCallback(
    async (node: DialogueNode) => {
      if (!selectedVoice || !node.text) return;

      setIsGeneratingAudio(true);
      try {
        const res = await fetch("/api/audio/voice/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: node.text,
            voicePreset: selectedVoice,
            npcId,
            dialogueNodeId: node.id,
            withTimestamps: true,
            saveToAsset: true,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to generate audio");
        }

        const data = await res.json();
        const audio: DialogueAudio = {
          url: data.asset.url,
          voiceId: data.asset.voiceId,
          duration: data.asset.duration,
          generatedAt: data.asset.generatedAt,
          timestamps: data.asset.timestamps,
        };

        setNodeAudio((prev) => new Map(prev).set(node.id, audio));

        // Update editing node
        if (editingNode?.id === node.id) {
          setEditingNode({ ...editingNode, audio });
        }

        toast({
          variant: "success",
          title: "Audio Generated",
          description: `Generated voice for "${node.id}"`,
        });

        // Play the generated audio
        setCurrentAudioUrl(data.audio);
        if (audioRef.current) {
          audioRef.current.src = data.audio;
          audioRef.current.play();
          setIsPlayingAudio(true);
        }
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Audio Generation Failed",
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setIsGeneratingAudio(false);
      }
    },
    [selectedVoice, npcId, editingNode, toast],
  );

  // Generate audio for all nodes
  const generateAllNodeAudio = useCallback(async () => {
    if (!selectedVoice || !initialTree?.nodes) return;

    setIsGeneratingAllAudio(true);
    let successCount = 0;
    let errorCount = 0;

    for (const node of initialTree.nodes) {
      try {
        const res = await fetch("/api/audio/voice/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: node.text,
            voicePreset: selectedVoice,
            npcId,
            dialogueNodeId: node.id,
            withTimestamps: true,
            saveToAsset: true,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const audio: DialogueAudio = {
            url: data.asset.url,
            voiceId: data.asset.voiceId,
            duration: data.asset.duration,
            generatedAt: data.asset.generatedAt,
            timestamps: data.asset.timestamps,
          };
          setNodeAudio((prev) => new Map(prev).set(node.id, audio));
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    toast({
      variant: successCount > 0 ? "success" : "destructive",
      title: "Audio Generation Complete",
      description: `Generated ${successCount} clips, ${errorCount} failed`,
    });

    setIsGeneratingAllAudio(false);
  }, [selectedVoice, npcId, initialTree, toast]);

  // Play node audio
  const playNodeAudio = useCallback(
    (nodeId: string) => {
      const audio = nodeAudio.get(nodeId);
      if (audio && audioRef.current) {
        setCurrentAudioUrl(audio.url);
        audioRef.current.src = audio.url;
        audioRef.current.play();
        setIsPlayingAudio(true);
      }
    },
    [nodeAudio],
  );

  // Convert dialogue tree to React Flow nodes and edges
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!initialTree) {
      return { initialNodes: [], initialEdges: [] };
    }

    const nodes: Node[] = initialTree.nodes.map((node, index) => ({
      id: node.id,
      type: "dialogue",
      position: {
        x: 100 + (index % 3) * 350,
        y: 100 + Math.floor(index / 3) * 200,
      },
      data: {
        label: node.id,
        text: node.text,
        responses: node.responses || [],
        isEntry: node.id === initialTree.entryNodeId,
        hasAudio: !!node.audio || nodeAudio.has(node.id),
        onEdit: () => setEditingNode(node),
      },
    }));

    const edges: Edge[] = [];
    for (const node of initialTree.nodes) {
      if (node.responses) {
        for (const response of node.responses) {
          if (response.nextNodeId !== "end") {
            edges.push({
              id: `${node.id}-${response.nextNodeId}`,
              source: node.id,
              target: response.nextNodeId,
              label:
                response.text.slice(0, 20) +
                (response.text.length > 20 ? "..." : ""),
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: "oklch(var(--primary))" },
              labelStyle: { fill: "oklch(var(--foreground))", fontSize: 10 },
            });
          }
        }
      }
    }

    return { initialNodes: nodes, initialEdges: edges };
  }, [initialTree, nodeAudio]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "oklch(var(--primary))" },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
      // Find the full node data
      const dialogueNode = initialTree?.nodes.find((n) => n.id === node.id);
      if (dialogueNode) {
        setEditingNode({ ...dialogueNode });
      }
    },
    [initialTree],
  );

  // Convert React Flow state back to DialogueTree
  const buildDialogueTree = useCallback((): DialogueTree => {
    const dialogueNodes: DialogueNode[] = nodes.map((node) => ({
      id: node.id,
      text: node.data.text as string,
      responses: node.data.responses as DialogueResponse[],
    }));

    // Find entry node
    const entryNode = nodes.find((n) => n.data.isEntry);
    const entryNodeId =
      entryNode?.id || (nodes.length > 0 ? nodes[0].id : "greeting");

    return {
      entryNodeId,
      nodes: dialogueNodes,
    };
  }, [nodes]);

  const handleSave = () => {
    const tree = buildDialogueTree();
    onSave(tree);
    toast({
      variant: "success",
      title: "Dialogue Saved",
      description: `Saved ${tree.nodes.length} nodes`,
    });
  };

  const handleAddNode = () => {
    const newId = `node_${Date.now()}`;
    const newNode: Node = {
      id: newId,
      type: "dialogue",
      position: { x: 250, y: 250 },
      data: {
        label: newId,
        text: "New dialogue text...",
        responses: [],
        isEntry: nodes.length === 0,
        onEdit: () => {},
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newId);
    setEditingNode({
      id: newId,
      text: "New dialogue text...",
      responses: [],
    });
  };

  const handleDeleteNode = () => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId,
      ),
    );
    setSelectedNodeId(null);
    setEditingNode(null);
  };

  const handleUpdateNode = () => {
    if (!editingNode) return;
    setNodes((nds) =>
      nds.map((node) =>
        node.id === editingNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                text: editingNode.text,
                responses: editingNode.responses || [],
              },
            }
          : node,
      ),
    );
    toast({
      variant: "success",
      title: "Node Updated",
      description: `Updated node "${editingNode.id}"`,
    });
  };

  const handleAddResponse = () => {
    if (!editingNode) return;
    setEditingNode({
      ...editingNode,
      responses: [
        ...(editingNode.responses || []),
        { text: "New response...", nextNodeId: "end" },
      ],
    });
  };

  const handleUpdateResponse = (
    index: number,
    field: keyof DialogueResponse,
    value: string,
  ) => {
    if (!editingNode || !editingNode.responses) return;
    const newResponses = [...editingNode.responses];
    newResponses[index] = { ...newResponses[index], [field]: value };
    setEditingNode({ ...editingNode, responses: newResponses });
  };

  const handleDeleteResponse = (index: number) => {
    if (!editingNode || !editingNode.responses) return;
    const newResponses = editingNode.responses.filter((_, i) => i !== index);
    setEditingNode({ ...editingNode, responses: newResponses });
  };

  return (
    <div className="flex h-full">
      {/* Hidden audio element */}
      <audio ref={audioRef} onEnded={() => setIsPlayingAudio(false)} />

      {/* Flow Canvas */}
      <div className="flex-1 h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          className="bg-background"
        >
          <Background color="oklch(var(--muted-foreground) / 0.2)" gap={20} />
          <Controls className="!bg-glass-bg !border-glass-border" />
          <MiniMap
            className="!bg-glass-bg !border-glass-border"
            nodeColor="oklch(var(--primary))"
          />
        </ReactFlow>

        {/* Toolbar */}
        <div className="absolute top-4 left-4 flex gap-2">
          <SpectacularButton size="sm" onClick={handleAddNode}>
            <Plus className="w-4 h-4 mr-1" />
            Add Node
          </SpectacularButton>
          {selectedNodeId && (
            <SpectacularButton
              size="sm"
              variant="destructive"
              onClick={handleDeleteNode}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </SpectacularButton>
          )}
          <SpectacularButton size="sm" variant="outline" onClick={handleSave}>
            <Save className="w-4 h-4 mr-1" />
            Save
          </SpectacularButton>
          {onGenerate && (
            <SpectacularButton size="sm" onClick={onGenerate}>
              <Wand2 className="w-4 h-4 mr-1" />
              Generate
            </SpectacularButton>
          )}
        </div>

        {/* Voice Controls (bottom left) */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-glass-bg/90 backdrop-blur-sm p-2 rounded-lg border border-glass-border">
          <Mic className="w-4 h-4 text-cyan-400" />
          <Select
            value={selectedVoice}
            onChange={(value) => setSelectedVoice(value)}
            options={voicePresets.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            placeholder="Voice..."
            className="w-32"
          />
          <SpectacularButton
            size="sm"
            onClick={generateAllNodeAudio}
            disabled={!selectedVoice || isGeneratingAllAudio}
          >
            {isGeneratingAllAudio ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
            <span className="ml-1">All</span>
          </SpectacularButton>
        </div>
      </div>

      {/* Node Editor Panel */}
      <GlassPanel className="w-80 h-full p-4 border-l border-glass-border overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">
          {editingNode ? `Edit: ${editingNode.id}` : "Node Editor"}
        </h3>

        {editingNode ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Node ID</Label>
              <NeonInput
                value={editingNode.id}
                disabled
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label>NPC Text</Label>
              <textarea
                value={editingNode.text}
                onChange={(e) =>
                  setEditingNode({ ...editingNode, text: e.target.value })
                }
                className="w-full h-24 p-2 bg-glass-bg border border-glass-border rounded text-sm resize-none"
                placeholder="What the NPC says..."
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Responses</Label>
                <SpectacularButton
                  size="sm"
                  variant="ghost"
                  onClick={handleAddResponse}
                >
                  <Plus className="w-3 h-3" />
                </SpectacularButton>
              </div>

              {editingNode.responses?.map((response, index) => (
                <div
                  key={index}
                  className="p-2 bg-glass-bg/50 rounded space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Response {index + 1}
                    </span>
                    <SpectacularButton
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteResponse(index)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </SpectacularButton>
                  </div>
                  <NeonInput
                    value={response.text}
                    onChange={(e) =>
                      handleUpdateResponse(index, "text", e.target.value)
                    }
                    placeholder="Player response..."
                    className="text-sm"
                  />
                  <NeonInput
                    value={response.nextNodeId}
                    onChange={(e) =>
                      handleUpdateResponse(index, "nextNodeId", e.target.value)
                    }
                    placeholder="Next node ID or 'end'"
                    className="text-sm font-mono"
                  />
                  <NeonInput
                    value={response.effect || ""}
                    onChange={(e) =>
                      handleUpdateResponse(index, "effect", e.target.value)
                    }
                    placeholder="Effect (optional)"
                    className="text-sm font-mono"
                  />
                </div>
              ))}
            </div>

            <SpectacularButton className="w-full" onClick={handleUpdateNode}>
              Update Node
            </SpectacularButton>

            {/* Audio Section */}
            <div className="border-t border-glass-border pt-4 mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-cyan-400" />
                  Voice Audio
                </Label>
                {(editingNode.audio || nodeAudio.has(editingNode.id)) && (
                  <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                    Generated
                  </span>
                )}
              </div>

              {(editingNode.audio || nodeAudio.has(editingNode.id)) && (
                <div className="flex items-center gap-2">
                  <SpectacularButton
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (isPlayingAudio) {
                        audioRef.current?.pause();
                        setIsPlayingAudio(false);
                      } else {
                        playNodeAudio(editingNode.id);
                      }
                    }}
                  >
                    {isPlayingAudio ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </SpectacularButton>
                  <span className="text-xs text-muted-foreground">
                    {(
                      editingNode.audio?.duration ||
                      nodeAudio.get(editingNode.id)?.duration ||
                      0
                    ).toFixed(1)}
                    s
                  </span>
                </div>
              )}

              <SpectacularButton
                size="sm"
                className="w-full"
                onClick={() => generateNodeAudio(editingNode)}
                disabled={!selectedVoice || isGeneratingAudio}
              >
                {isGeneratingAudio ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 mr-1" />
                    {editingNode.audio || nodeAudio.has(editingNode.id)
                      ? "Regenerate Voice"
                      : "Generate Voice"}
                  </>
                )}
              </SpectacularButton>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click a node to edit it, or use the toolbar to add new nodes.
          </p>
        )}
      </GlassPanel>
    </div>
  );
}
