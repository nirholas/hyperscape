"use client";

import { forwardRef, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// Card
// ============================================================================
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "hover" | "interactive";
  selected?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    { className, variant = "default", selected = false, children, ...props },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-glass-bg border border-glass-border rounded-lg transition-all duration-200",
          variant === "hover" && "hover:border-accent/50 hover:bg-foreground/5",
          variant === "interactive" &&
            "cursor-pointer hover:border-accent/50 hover:bg-foreground/5 active:scale-[0.99]",
          selected && "border-accent ring-2 ring-accent/20 bg-accent/5",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = "Card";

// ============================================================================
// CardHeader
// ============================================================================
export type CardHeaderProps = HTMLAttributes<HTMLDivElement>;

const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("px-4 py-3 border-b border-glass-border", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

// ============================================================================
// CardTitle
// ============================================================================
export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as = "h3", ...props }, ref) => {
    const Component = as;
    return (
      <Component
        ref={ref}
        className={cn(
          "text-base font-semibold text-foreground tracking-wide",
          className,
        )}
        {...props}
      />
    );
  },
);
CardTitle.displayName = "CardTitle";

// ============================================================================
// CardDescription
// ============================================================================
export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-sm text-muted mt-1", className)}
      {...props}
    />
  ),
);
CardDescription.displayName = "CardDescription";

// ============================================================================
// CardContent
// ============================================================================
export type CardContentProps = HTMLAttributes<HTMLDivElement>;

const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

// ============================================================================
// CardFooter
// ============================================================================
export type CardFooterProps = HTMLAttributes<HTMLDivElement>;

const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "px-4 py-3 border-t border-glass-border bg-foreground/5 rounded-b-lg",
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
