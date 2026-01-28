import React, { useRef, useEffect, useState, useCallback } from "react";

interface GameWindowProps {
  title: string;
  windowId: string;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
  fitContent?: boolean;
  defaultX?: number;
  defaultY?: number;
  children: React.ReactNode;
}

/**
 * GameWindow - Draggable window container for game UI panels
 */
export function GameWindow({
  title,
  windowId,
  onClose,
  zIndex = 1000,
  onFocus,
  fitContent = false,
  defaultX = 100,
  defaultY = 100,
  children,
}: GameWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: defaultX, y: defaultY });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (headerRef.current?.contains(e.target as Node)) {
        setIsDragging(true);
        dragOffset.current = {
          x: e.clientX - position.x,
          y: e.clientY - position.y,
        };
        onFocus?.();
      }
    },
    [position, onFocus],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={windowRef}
      data-window-id={windowId}
      className="fixed pointer-events-auto"
      style={{
        left: position.x,
        top: position.y,
        zIndex,
        minWidth: fitContent ? "auto" : 280,
        maxWidth: fitContent ? "auto" : 400,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="bg-gray-900/95 border border-gray-700 rounded-lg shadow-2xl overflow-hidden backdrop-blur-sm">
        {/* Header */}
        <div
          ref={headerRef}
          className="flex items-center justify-between px-3 py-2 bg-gray-800/80 border-b border-gray-700 cursor-move select-none"
        >
          <span className="text-sm font-medium text-gray-200">{title}</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          >
            ✕
          </button>
        </div>
        {/* Content */}
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}
