"use client";

import { useState, useRef, useEffect } from "react";
import { GlassPanel } from "./glass-panel";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion as _motion } from "framer-motion";

interface Option {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  label?: string;
  openUp?: boolean; // Open dropdown upward instead of downward
  className?: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select option...",
  label,
  openUp = false,
  className,
  disabled = false,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div
      className={cn("w-full flex flex-col gap-1.5", className)}
      ref={containerRef}
    >
      {label && (
        <label className="text-xs text-muted uppercase tracking-wider font-semibold ml-1">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            "flex items-center justify-between w-full h-10 px-3 py-2 rounded-md border border-input bg-glass-bg/50 text-sm text-left transition-all",
            "focus:outline-none focus:border-neon-blue focus:ring-1 focus:ring-neon-blue/50",
            isOpen && "border-neon-blue ring-1 ring-neon-blue/50",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          <span
            className={
              !selectedOption ? "text-muted-foreground" : "text-foreground"
            }
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted transition-transform",
              isOpen && "transform rotate-180",
            )}
          />
        </button>

        <AnimatePresence>
          {isOpen && (
            <div
              className={cn(
                "absolute z-50 w-full",
                openUp ? "bottom-full mb-1" : "top-full mt-1",
              )}
            >
              <GlassPanel
                intensity="high"
                className="py-1 max-h-60 overflow-auto custom-scrollbar"
              >
                {options.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between w-full px-3 py-2 text-sm text-left hover:bg-foreground/10 transition-colors",
                      option.value === value
                        ? "text-neon-blue bg-neon-blue/5"
                        : "text-muted",
                    )}
                  >
                    {option.label}
                    {option.value === value && (
                      <Check className="w-4 h-4 text-neon-blue" />
                    )}
                  </button>
                ))}
              </GlassPanel>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
