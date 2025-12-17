"use client";

import { Modal } from "@/components/ui/modal";
import { getAllCategories, type AssetCategory } from "@/types/categories";
import { SpectacularButton } from "@/components/ui/spectacular-button";

interface CategorySelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (category: AssetCategory) => void;
}

export function CategorySelector({
  isOpen,
  onClose,
  onSelect,
}: CategorySelectorProps) {
  const categories = getAllCategories();

  const handleSelect = (category: AssetCategory) => {
    onSelect(category);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="What do you want to create?"
      size="large"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4">
        {categories.map((category) => (
          <SpectacularButton
            key={category.id}
            variant="ghost"
            className="h-32 flex flex-col items-center justify-center gap-2 glass-panel hover:scale-105 transition-transform"
            onClick={() => handleSelect(category.id)}
          >
            <span className="text-4xl">{category.icon}</span>
            <div className="text-center">
              <h3 className="font-semibold text-sm">{category.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {category.description}
              </p>
            </div>
          </SpectacularButton>
        ))}
      </div>
    </Modal>
  );
}
