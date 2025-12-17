"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { RetextureOptions } from "./RetextureOptions";
import { RegenerateOptions } from "./RegenerateOptions";
import {
  MetadataEditor,
  type AssetMetadata,
} from "../generation/MetadataEditor";
import type { AssetData } from "@/types/asset";
import { logger } from "@/lib/utils";

const log = logger.child("EnhancementPanel");

interface EnhancementPanelProps {
  asset: AssetData | null;
  onClose: () => void;
  /** Hide header when used inside a wrapper that provides its own header */
  hideHeader?: boolean;
}

export function EnhancementPanel({
  asset,
  onClose,
  hideHeader = false,
}: EnhancementPanelProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("retexture");

  if (!asset) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select an asset to enhance
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {!hideHeader && (
        <div className="p-4 border-b border-glass-border">
          <h2 className="text-lg font-semibold">Enhance Asset</h2>
          <p className="text-sm text-muted-foreground">{asset.name}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="p-4 border-b border-glass-border">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="retexture">Retexture</TabsTrigger>
              <TabsTrigger value="regenerate">Regenerate</TabsTrigger>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="retexture" className="mt-0">
            <RetextureOptions asset={asset} />
          </TabsContent>

          <TabsContent value="regenerate" className="mt-0">
            <RegenerateOptions asset={asset} />
          </TabsContent>

          <TabsContent value="metadata" className="mt-0">
            <MetadataEditor
              category={asset.category}
              initialMetadata={asset as unknown as AssetMetadata}
              onSave={(metadata) => {
                log.info({ metadata }, "Save metadata");
                // TODO: Save metadata to API
                toast({
                  variant: "success",
                  title: "Metadata Updated",
                  description: "Asset metadata has been saved successfully",
                  duration: 3000,
                });
              }}
              onCancel={onClose}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
