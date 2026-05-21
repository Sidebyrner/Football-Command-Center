import Header from '../components/layout/Header'
import SkeletonCard from '../components/shared/SkeletonCard'

export default function Dashboard() {
  return (
    <div className="flex flex-col h-screen">
      <Header title="Dashboard" />
      <main className="flex-1 overflow-auto p-6">
        <p className="text-sm text-[var(--color-text-muted)] mb-6">
          Roster, matchup, and waiver data will appear here.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <SkeletonCard rows={4} />
          <SkeletonCard rows={4} />
          <SkeletonCard rows={4} />
        </div>
      </main>
    </div>
  )
}
