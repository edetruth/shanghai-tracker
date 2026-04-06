interface SkeletonProps {
  className?: string
}

function SkeletonBar({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`bg-sand animate-shimmer rounded ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
      }}
    />
  )
}

/** Card-shaped skeleton used as placeholder while data loads. */
export function SkeletonCard() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <SkeletonBar className="w-8 h-8 rounded-full shrink-0" />
        <SkeletonBar className="h-4 w-32" />
        <SkeletonBar className="h-4 w-16 ml-auto" />
      </div>
      <SkeletonBar className="h-3 w-full" />
      <SkeletonBar className="h-3 w-3/4" />
    </div>
  )
}

/** List skeleton: stacks multiple SkeletonCards. */
export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3 py-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

/** Stats page skeleton with rank rows. */
export function SkeletonStats() {
  return (
    <div className="space-y-3 py-4">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="card p-3 flex items-center gap-3">
          <SkeletonBar className="w-6 h-6 rounded-full shrink-0" />
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="h-3 w-16 ml-auto" />
        </div>
      ))}
    </div>
  )
}

/** Profile modal skeleton. */
export function SkeletonProfile() {
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center gap-3">
        <SkeletonBar className="w-12 h-12 rounded-full shrink-0" />
        <div className="space-y-2 flex-1">
          <SkeletonBar className="h-5 w-32" />
          <SkeletonBar className="h-3 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBar key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
