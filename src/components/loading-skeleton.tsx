/** Reserves the shape of real content during initial reads; decorative bars stay out of the accessibility tree. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ContentSkeleton({ kind }: { kind: 'conversations' | 'messages' | 'activity' }) {
  const label = `Loading ${kind}`;
  return (
    <div className={`loading-skeleton loading-${kind}`} role="status" aria-label={label}>
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true">
        {Array.from({ length: kind === 'conversations' ? 5 : 4 }, (_, index) => (
          <div className="skeleton-row" key={index}>
            {kind !== 'messages' && <Skeleton className="skeleton-avatar" />}
            <div className="skeleton-copy">
              <Skeleton className="skeleton-title" />
              <Skeleton className="skeleton-line" />
              {kind !== 'activity' && <Skeleton className="skeleton-caption" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
