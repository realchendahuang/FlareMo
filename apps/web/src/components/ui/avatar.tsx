import BoringAvatar from "boring-avatars";
import { type HTMLAttributes, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type AvatarFallbackVariant =
  | "beam"
  | "pixel"
  | "bauhaus"
  | "marble"
  | "ring"
  | "initials";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  name?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  fallbackVariant?: AvatarFallbackVariant;
}

const SIZE_CLASSES = {
  xs: "size-5 text-xs",
  sm: "size-6 text-xs",
  md: "size-8 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
};

export const FLAREMO_AVATAR_PALETTE = [
  "#FF6B4A", // Flame coral
  "#FFAA5A", // Warm peach
  "#FFE194", // Soft sun cream
  "#264653", // Deep slate
  "#2A9D8F", // Sage teal
];

const PALETTES = [
  "from-amber-500 to-orange-600",
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-purple-500 to-pink-600",
  "from-rose-500 to-red-600",
  "from-cyan-500 to-sky-600",
];

function getInitial(name?: string | null): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // Handle UTF-16 surrogate pairs / code points cleanly
  const firstChar = Array.from(trimmed)[0];
  return firstChar ? firstChar.toUpperCase() : "?";
}

function getPaletteIndex(name?: string | null): number {
  if (!name) return 0;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % PALETTES.length;
}

export function Avatar({
  src,
  name,
  size = "md",
  fallbackVariant = "beam",
  className,
  ...props
}: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const showImage = Boolean(src && !imgError);
  const seed = name?.trim() || "FlareMo";
  const isInitials = fallbackVariant === "initials";
  const initial = getInitial(name);
  const palette = PALETTES[getPaletteIndex(name)];

  return (
    <div
      aria-label={name ?? "Avatar"}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium shadow-2xs transition-colors",
        SIZE_CLASSES[size],
        !showImage && isInitials && cn("bg-gradient-to-br text-white", palette),
        className,
      )}
      role="img"
      {...props}
    >
      {showImage ? (
        <img
          alt={name ?? "Avatar"}
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={src ?? undefined}
          onError={() => setImgError(true)}
        />
      ) : isInitials ? (
        <span className="leading-none">{initial}</span>
      ) : (
        <BoringAvatar
          className="size-full block"
          colors={FLAREMO_AVATAR_PALETTE}
          name={seed}
          size="100%"
          variant={fallbackVariant}
        />
      )}
    </div>
  );
}
