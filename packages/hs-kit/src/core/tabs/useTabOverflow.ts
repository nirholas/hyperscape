import { useCallback, useState, useRef, useEffect } from "react";

export interface TabOverflowConfig {
  maxVisibleTabs?: number;
  scrollBehavior?: "scroll" | "dropdown";
}

export interface TabOverflowResult {
  scrollPosition: number;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollLeft: () => void;
  scrollRight: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  needsOverflow: boolean;
}

export function useTabOverflow(
  tabCount: number,
  config: TabOverflowConfig = {},
): TabOverflowResult {
  const { maxVisibleTabs = 8 } = config;
  const [scrollPosition, setScrollPosition] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const needsOverflow = tabCount > maxVisibleTabs;
  const maxScroll = Math.max(0, tabCount - maxVisibleTabs);
  const canScrollLeft = scrollPosition > 0;
  const canScrollRight = scrollPosition < maxScroll;

  const scrollLeft = useCallback(() => {
    setScrollPosition((pos) => Math.max(0, pos - 1));
  }, []);

  const scrollRight = useCallback(() => {
    setScrollPosition((pos) => Math.min(maxScroll, pos + 1));
  }, [maxScroll]);

  useEffect(() => {
    if (scrollPosition > maxScroll) {
      setScrollPosition(maxScroll);
    }
  }, [scrollPosition, maxScroll]);

  useEffect(() => {
    if (containerRef.current && needsOverflow) {
      const tabWidth = containerRef.current.scrollWidth / tabCount;
      containerRef.current.scrollLeft = scrollPosition * tabWidth;
    }
  }, [scrollPosition, tabCount, needsOverflow]);

  return {
    scrollPosition,
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
    containerRef,
    needsOverflow,
  };
}
