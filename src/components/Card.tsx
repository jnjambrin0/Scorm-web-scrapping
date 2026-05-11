import type { HTMLAttributes, ReactNode } from "react";

export type CardTone = "neutral" | "success" | "warning" | "danger" | "info";
export type CardElevation = 0 | 1 | 2;
export type CardPadding = "sm" | "md" | "lg" | "xl";

interface Props extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  elevation?: CardElevation;
  padding?: CardPadding;
  as?: "section" | "div" | "article" | "aside";
  /** Trigger mount-in animation (200ms). Default true; honors prefers-reduced-motion. */
  enter?: boolean;
  children: ReactNode;
}

const PADDING: Record<CardPadding, string> = {
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
  xl: "p-7 sm:p-10",
};

function surfaceClass(tone: CardTone, elevation: CardElevation): string {
  if (tone !== "neutral") {
    return `surface-tint-${tone}`;
  }
  if (elevation === 0) return "surface-quiet";
  if (elevation === 2) return "surface-elevated";
  return "surface";
}

export function Card({
  tone = "neutral",
  elevation = 1,
  padding = "md",
  as = "section",
  enter = true,
  className = "",
  children,
  ...rest
}: Props) {
  const Tag = as;
  const isHero = tone === "neutral" && elevation === 2;
  const radius = isHero ? "rounded-2xl" : "rounded-xl";
  return (
    <Tag
      {...rest}
      data-enter={enter ? "card" : undefined}
      className={[
        surfaceClass(tone, elevation),
        radius,
        PADDING[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Tag>
  );
}
