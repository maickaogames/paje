import { cn } from "@/lib/utils";
import { initials } from "@/lib/media";

export function Avatar({
  src,
  name,
  size = 32,
  speaking = false,
  className,
}: {
  src: string | null | undefined;
  name: string;
  size?: number;
  speaking?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-secondary text-secondary-foreground grid place-items-center font-display font-semibold select-none",
        speaking ? "ring-speaking" : "ring-idle",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span>{initials(name) || "?"}</span>
      )}
    </div>
  );
}
