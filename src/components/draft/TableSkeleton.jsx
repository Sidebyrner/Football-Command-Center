export default function TableSkeleton({ rows = 20 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-[var(--color-border)]">
          {/* Player name */}
          <td className="px-3 py-2.5">
            <div className="h-3.5 w-32 rounded bg-[var(--color-surface-2)] animate-pulse" />
          </td>
          {/* Pos */}
          <td className="px-3 py-2.5">
            <div className="h-5 w-8 rounded bg-[var(--color-surface-2)] animate-pulse" />
          </td>
          {/* Team */}
          <td className="px-3 py-2.5">
            <div className="h-3.5 w-10 rounded bg-[var(--color-surface-2)] animate-pulse" />
          </td>
          {/* Rank */}
          <td className="px-3 py-2.5 text-right">
            <div className="h-3.5 w-8 rounded bg-[var(--color-surface-2)] animate-pulse ml-auto" />
          </td>
          {/* Bye */}
          <td className="px-3 py-2.5 text-right">
            <div className="h-3.5 w-6 rounded bg-[var(--color-surface-2)] animate-pulse ml-auto" />
          </td>
          {/* Injury */}
          <td className="px-3 py-2.5">
            <div className="h-3.5 w-16 rounded bg-[var(--color-surface-2)] animate-pulse" />
          </td>
          {/* Trending */}
          <td className="px-3 py-2.5">
            <div className="h-5 w-14 rounded bg-[var(--color-surface-2)] animate-pulse" />
          </td>
          {/* Watchlist */}
          <td className="px-3 py-2.5 text-center">
            <div className="h-4 w-4 rounded bg-[var(--color-surface-2)] animate-pulse mx-auto" />
          </td>
        </tr>
      ))}
    </>
  )
}
