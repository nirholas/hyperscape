/**
 * DialogText Component
 *
 * Typewriter text display with skip functionality.
 * Provides animated text reveal for dialog sequences.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useState,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
} from "react";
import { useTheme } from "../stores/themeStore";

// ============================================================================
// Types
// ============================================================================

/** Props for DialogText component */
export interface DialogTextProps {
  /** Full text to display */
  text: string;
  /** Whether typewriter animation is active */
  animate?: boolean;
  /** Characters per second */
  speed?: number;
  /** Speed multiplier (applies to base speed) */
  speedMultiplier?: number;
  /** Callback when typing starts */
  onTypingStart?: () => void;
  /** Callback when typing completes */
  onTypingComplete?: () => void;
  /** Callback on each character typed */
  onCharacterTyped?: (char: string, index: number) => void;
  /** Whether to show cursor */
  showCursor?: boolean;
  /** Cursor character */
  cursorChar?: string;
  /** Whether to pause on punctuation */
  pauseOnPunctuation?: boolean;
  /** Pause duration multiplier for punctuation (1.0 = normal typing speed) */
  punctuationPause?: number;
  /** Click handler (typically for skip) */
  onClick?: () => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/** Return type for useTypewriter hook */
export interface UseTypewriterResult {
  /** Currently displayed text */
  displayedText: string;
  /** Whether typing is complete */
  isComplete: boolean;
  /** Skip to end */
  skip: () => void;
  /** Reset and restart */
  reset: () => void;
  /** Pause typing */
  pause: () => void;
  /** Resume typing */
  resume: () => void;
  /** Whether typing is paused */
  isPaused: boolean;
}

// ============================================================================
// Typewriter Hook
// ============================================================================

/**
 * Hook for typewriter text animation
 *
 * @example
 * ```tsx
 * function TypewriterDemo() {
 *   const typewriter = useTypewriter({
 *     text: "Hello, adventurer! Welcome to the guild.",
 *     speed: 50,
 *     onComplete: () => console.log("Done typing!")
 *   });
 *
 *   return (
 *     <p onClick={typewriter.skip}>
 *       {typewriter.displayedText}
 *       {!typewriter.isComplete && <span className="cursor">|</span>}
 *     </p>
 *   );
 * }
 * ```
 */
export function useTypewriter(options: {
  text: string;
  speed?: number;
  speedMultiplier?: number;
  pauseOnPunctuation?: boolean;
  punctuationPause?: number;
  onStart?: () => void;
  onComplete?: () => void;
  onCharacter?: (char: string, index: number) => void;
  autoStart?: boolean;
}): UseTypewriterResult {
  const {
    text,
    speed = 40,
    speedMultiplier = 1,
    pauseOnPunctuation = true,
    punctuationPause = 3,
    onStart,
    onComplete,
    onCharacter,
    autoStart = true,
  } = options;

  const [displayedText, setDisplayedText] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const indexRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);

  // Calculate actual speed
  const actualSpeed = speed * speedMultiplier;
  const msPerChar = 1000 / actualSpeed;

  // Check if character should cause a pause
  const getPauseMultiplier = useCallback(
    (char: string): number => {
      if (!pauseOnPunctuation) return 1;
      if (char === "." || char === "!" || char === "?") return punctuationPause;
      if (char === "," || char === ";" || char === ":")
        return punctuationPause * 0.5;
      return 1;
    },
    [pauseOnPunctuation, punctuationPause],
  );

  // Type next character
  const typeNextChar = useCallback(() => {
    if (indexRef.current >= text.length) {
      setIsComplete(true);
      onComplete?.();
      return;
    }

    const nextIndex = indexRef.current + 1;
    const char = text[indexRef.current];
    const newText = text.slice(0, nextIndex);

    setDisplayedText(newText);
    onCharacter?.(char, indexRef.current);
    indexRef.current = nextIndex;

    // Schedule next character
    const pauseMultiplier = getPauseMultiplier(char);
    const delay = msPerChar * pauseMultiplier;

    timerRef.current = window.setTimeout(typeNextChar, delay);
  }, [text, msPerChar, getPauseMultiplier, onCharacter, onComplete]);

  // Start typing
  const start = useCallback(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    onStart?.();
    typeNextChar();
  }, [typeNextChar, onStart]);

  // Skip to end
  const skip = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDisplayedText(text);
    setIsComplete(true);
    indexRef.current = text.length;
    onComplete?.();
  }, [text, onComplete]);

  // Reset and restart
  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDisplayedText("");
    setIsComplete(false);
    setIsPaused(false);
    indexRef.current = 0;
    hasStartedRef.current = false;

    if (autoStart) {
      // Small delay to allow state update
      setTimeout(start, 10);
    }
  }, [autoStart, start]);

  // Pause typing
  const pause = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPaused(true);
  }, []);

  // Resume typing
  const resume = useCallback(() => {
    setIsPaused(false);
    if (!isComplete) {
      typeNextChar();
    }
  }, [isComplete, typeNextChar]);

  // Auto-start on mount
  useEffect(() => {
    if (autoStart && !hasStartedRef.current) {
      start();
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [autoStart, start]);

  // Reset when text changes
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDisplayedText("");
    setIsComplete(false);
    setIsPaused(false);
    indexRef.current = 0;
    hasStartedRef.current = false;

    if (autoStart) {
      setTimeout(start, 10);
    }
  }, [text, autoStart, start]);

  return {
    displayedText,
    isComplete,
    skip,
    reset,
    pause,
    resume,
    isPaused,
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog text component with typewriter animation
 *
 * @example
 * ```tsx
 * // Basic usage
 * <DialogText
 *   text="Welcome to Varrock! The greatest city in Gielinor."
 *   speed={50}
 *   onTypingComplete={() => setCanContinue(true)}
 *   onClick={handleSkip}
 * />
 *
 * // Without animation
 * <DialogText
 *   text="This text appears instantly"
 *   animate={false}
 * />
 * ```
 */
export const DialogText = memo(function DialogText({
  text,
  animate = true,
  speed = 40,
  speedMultiplier = 1,
  onTypingStart,
  onTypingComplete,
  onCharacterTyped,
  showCursor = true,
  cursorChar = "|",
  pauseOnPunctuation = true,
  punctuationPause = 3,
  onClick,
  className,
  style,
}: DialogTextProps): React.ReactElement {
  const theme = useTheme();

  const typewriter = useTypewriter({
    text,
    speed,
    speedMultiplier,
    pauseOnPunctuation,
    punctuationPause,
    onStart: onTypingStart,
    onComplete: onTypingComplete,
    onCharacter: onCharacterTyped,
    autoStart: animate,
  });

  // If not animating, show full text immediately
  const displayText = animate ? typewriter.displayedText : text;
  const isTyping = animate && !typewriter.isComplete;

  // Handle click (skip or custom handler)
  const handleClick = useCallback(() => {
    if (isTyping) {
      typewriter.skip();
    }
    onClick?.();
  }, [isTyping, typewriter, onClick]);

  // Text container style
  const containerStyle: CSSProperties = {
    fontFamily: theme.typography.fontFamily.body,
    fontSize: theme.typography.fontSize.base,
    lineHeight: theme.typography.lineHeight.relaxed,
    color: theme.colors.text.primary,
    cursor: onClick || isTyping ? "pointer" : "default",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    ...style,
  };

  // Cursor style
  const cursorStyle: CSSProperties = {
    display: "inline-block",
    animation: "blink-cursor 1s step-end infinite",
    color: theme.colors.text.primary,
    marginLeft: 1,
  };

  return (
    <div className={className} style={containerStyle} onClick={handleClick}>
      <style>{`
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
      {displayText}
      {showCursor && isTyping && <span style={cursorStyle}>{cursorChar}</span>}
    </div>
  );
});

// ============================================================================
// Styled Text Variants
// ============================================================================

/** Props for styled text variant */
export interface StyledTextProps {
  /** Text content */
  children: string;
  /** Text variant */
  variant?: "npc" | "player" | "system" | "action" | "important";
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Pre-styled text for different dialog contexts
 *
 * @example
 * ```tsx
 * <StyledDialogText variant="npc">Hello, adventurer!</StyledDialogText>
 * <StyledDialogText variant="player">I'd like to buy something.</StyledDialogText>
 * <StyledDialogText variant="system">Quest started: The Restless Ghost</StyledDialogText>
 * <StyledDialogText variant="important">WARNING: This cannot be undone!</StyledDialogText>
 * ```
 */
export const StyledDialogText = memo(function StyledDialogText({
  children,
  variant = "npc",
  className,
  style,
}: StyledTextProps): React.ReactElement {
  const theme = useTheme();

  const variantStyles: Record<string, CSSProperties> = {
    npc: {
      color: theme.colors.text.primary,
    },
    player: {
      color: theme.colors.accent.secondary,
      fontStyle: "italic",
    },
    system: {
      color: theme.colors.text.muted,
      fontSize: theme.typography.fontSize.sm,
    },
    action: {
      color: theme.colors.state.info,
      fontStyle: "italic",
    },
    important: {
      color: theme.colors.state.warning,
      fontWeight: theme.typography.fontWeight.semibold,
    },
  };

  const textStyle: CSSProperties = {
    fontFamily: theme.typography.fontFamily.body,
    fontSize: theme.typography.fontSize.base,
    lineHeight: theme.typography.lineHeight.relaxed,
    ...variantStyles[variant],
    ...style,
  };

  return (
    <span className={className} style={textStyle}>
      {children}
    </span>
  );
});

export default DialogText;
