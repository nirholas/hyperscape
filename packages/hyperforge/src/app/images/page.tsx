"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Image as ImageIcon,
  Palette,
  Grid3X3,
  Layers,
  Download,
  Trash2,
  Loader2,
  Search,
  RefreshCw,
  Plus,
  X,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { cn } from "@/lib/utils";

interface GeneratedImage {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string;
  type: "concept-art" | "sprite" | "texture" | "icon" | "other";
  prompt?: string;
  createdAt: string;
  width?: number;
  height?: number;
  size?: number;
}

type ImageType = "all" | "concept-art" | "sprite" | "texture" | "icon";

export default function ImageLibraryPage() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<ImageType>("all");
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Fetch images
  const fetchImages = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/images");
      if (response.ok) {
        const data = await response.json();
        setImages(data.images || []);
      }
    } catch (error) {
      console.error("Failed to fetch images:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  // Filter images
  const filteredImages = images.filter((img) => {
    const matchesSearch =
      !searchQuery ||
      img.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      img.prompt?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || img.type === filterType;
    return matchesSearch && matchesType;
  });

  // Delete image
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this image?")) return;

    setIsDeleting(id);
    try {
      const response = await fetch(`/api/images/${id}`, { method: "DELETE" });
      if (response.ok) {
        setImages((prev) => prev.filter((img) => img.id !== id));
        if (selectedImage?.id === id) setSelectedImage(null);
      }
    } catch (error) {
      console.error("Failed to delete image:", error);
    } finally {
      setIsDeleting(null);
    }
  };

  // Download image
  const handleDownload = async (image: GeneratedImage) => {
    try {
      const response = await fetch(image.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = image.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download image:", error);
    }
  };

  const typeIcons: Record<string, typeof ImageIcon> = {
    "concept-art": Palette,
    sprite: Grid3X3,
    texture: Layers,
    icon: ImageIcon,
    other: ImageIcon,
  };

  const typeColors: Record<string, string> = {
    "concept-art": "text-purple-400",
    sprite: "text-cyan-400",
    texture: "text-green-400",
    icon: "text-orange-400",
    other: "text-muted-foreground",
  };

  return (
    <StudioPageLayout
      title="Image Library"
      description="Browse and manage your generated images"
      showVault={false}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-glass-border bg-glass-bg/30">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-3xl font-bold mb-2">Image Library</h1>
                <p className="text-muted-foreground">
                  Browse and manage your generated concept art, sprites, and
                  textures.
                </p>
              </div>
              <SpectacularButton
                variant="outline"
                size="sm"
                onClick={fetchImages}
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")}
                />
                Refresh
              </SpectacularButton>
            </div>

            {/* Quick Generate Buttons */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Link href="/images/concept-art" className="block">
                <div className="p-4 rounded-xl border border-glass-border bg-glass-bg/30 hover:border-purple-500/50 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                      <Palette className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">Concept Art</div>
                      <div className="text-xs text-muted-foreground">
                        AI artwork
                      </div>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/images/sprites" className="block">
                <div className="p-4 rounded-xl border border-glass-border bg-glass-bg/30 hover:border-cyan-500/50 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center group-hover:bg-cyan-500/30 transition-colors">
                      <Grid3X3 className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">Sprites</div>
                      <div className="text-xs text-muted-foreground">
                        2D assets
                      </div>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/images/textures" className="block">
                <div className="p-4 rounded-xl border border-glass-border bg-glass-bg/30 hover:border-green-500/50 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center group-hover:bg-green-500/30 transition-colors">
                      <Layers className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">Textures</div>
                      <div className="text-xs text-muted-foreground">
                        Seamless
                      </div>
                    </div>
                  </div>
                </div>
              </Link>

              <div className="p-4 rounded-xl border border-dashed border-glass-border bg-glass-bg/30 opacity-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-glass-bg flex items-center justify-center">
                    <Plus className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">More Coming</div>
                    <div className="text-xs text-muted-foreground">
                      Icons, UI...
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Search and Filter */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search images..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pink-500/50"
                />
              </div>

              <div className="flex gap-2">
                {(
                  ["all", "concept-art", "sprite", "texture"] as ImageType[]
                ).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={cn(
                      "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      filterType === type
                        ? "bg-pink-500/20 text-pink-400 border border-pink-500/30"
                        : "bg-glass-bg border border-glass-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {type === "all" ? "All" : type.replace("-", " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-pink-400" />
              </div>
            ) : filteredImages.length === 0 ? (
              <div className="p-12 text-center rounded-xl border border-glass-border bg-glass-bg/30">
                <ImageIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No images found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || filterType !== "all"
                    ? "Try adjusting your search or filter"
                    : "Start generating images to see them here"}
                </p>
                <Link href="/images/concept-art">
                  <SpectacularButton>
                    <Plus className="w-4 h-4 mr-2" />
                    Generate Concept Art
                  </SpectacularButton>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredImages.map((image) => {
                  const TypeIcon = typeIcons[image.type] || ImageIcon;
                  return (
                    <div
                      key={image.id}
                      className="group relative aspect-square rounded-lg overflow-hidden border border-glass-border bg-glass-bg hover:border-pink-500/50 transition-all cursor-pointer"
                      onClick={() => setSelectedImage(image)}
                    >
                      <img
                        src={image.thumbnailUrl || image.url}
                        alt={image.filename}
                        className="w-full h-full object-cover"
                      />

                      {/* Overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="absolute bottom-0 left-0 right-0 p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <TypeIcon
                              className={cn("w-3 h-3", typeColors[image.type])}
                            />
                            <span className="text-xs text-white/80 capitalize">
                              {image.type.replace("-", " ")}
                            </span>
                          </div>
                          <div className="text-xs text-white truncate">
                            {image.filename}
                          </div>
                        </div>
                      </div>

                      {/* Quick Actions */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(image);
                          }}
                          className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white transition-colors"
                          title="Download"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(image.id);
                          }}
                          className="p-1.5 rounded bg-red-500/60 hover:bg-red-500/80 text-white transition-colors"
                          title="Delete"
                          disabled={isDeleting === image.id}
                        >
                          {isDeleting === image.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Preview Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-glass-bg border border-glass-border rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              <button
                onClick={() => handleDownload(selectedImage)}
                className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={() => setSelectedImage(null)}
                className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <img
              src={selectedImage.url}
              alt={selectedImage.filename}
              className="max-w-full max-h-[70vh] object-contain"
            />

            <div className="p-4 border-t border-glass-border">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{selectedImage.filename}</h3>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium capitalize",
                    selectedImage.type === "concept-art" &&
                      "bg-purple-500/20 text-purple-400",
                    selectedImage.type === "sprite" &&
                      "bg-cyan-500/20 text-cyan-400",
                    selectedImage.type === "texture" &&
                      "bg-green-500/20 text-green-400",
                  )}
                >
                  {selectedImage.type.replace("-", " ")}
                </span>
              </div>
              {selectedImage.prompt && (
                <p className="text-sm text-muted-foreground mb-2">
                  {selectedImage.prompt}
                </p>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                {selectedImage.width && selectedImage.height && (
                  <span>
                    {selectedImage.width} × {selectedImage.height}
                  </span>
                )}
                {selectedImage.size && (
                  <span>{(selectedImage.size / 1024).toFixed(1)} KB</span>
                )}
                <span>
                  {new Date(selectedImage.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </StudioPageLayout>
  );
}
