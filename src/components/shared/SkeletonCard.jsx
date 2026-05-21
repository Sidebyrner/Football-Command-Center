export default function SkeletonCard({ rows = 3, className = '' }) {
  return (
    <div className={`bg-[var(--color-surface)] rounded-lg p-4 shadow-card animate-pulse ${className}`}>
      <div className="h-4 bg-[var(--color-surface-2)] rounded w-1/3 mb-4" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 bg-[var(--color-surface-2)] rounded mb-2" style={{ width: `${75 - i * 10}%` }} />
      ))}
    </div>
  )
}
