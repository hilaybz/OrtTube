import { cn } from "./cn";
import { Icon } from "./Icon";

export function QuizThumb({
  youtubeVideoId,
  playAffordance,
  children,
}: {
  youtubeVideoId: string;
  playAffordance?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-[var(--neutral-tertiary)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg`}
        alt=""
        className="h-full w-full object-cover transition-transform duration-300 ease-out group-focus-within:scale-[1.04] group-hover:scale-[1.04]"
      />
      {playAffordance && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-11 w-11 scale-90 items-center justify-center rounded-full bg-white/85 text-[var(--fg-brand-strong)] opacity-0 shadow-[var(--shadow-xs)] backdrop-blur-sm transition duration-200 ease-out group-focus-within:scale-100 group-focus-within:opacity-100 group-hover:scale-100 group-hover:opacity-100">
            <Icon name="play" size={18} />
          </span>
        </span>
      )}
      {children}
    </div>
  );
}

export function ThumbChip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "absolute inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm",
        className
      )}
    >
      {children}
    </span>
  );
}
