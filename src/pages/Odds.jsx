import Header from '../components/layout/Header'

export default function Odds() {
  return (
    <div className="flex flex-col h-screen">
      <Header title="Odds" />
      <main className="flex-1 overflow-auto p-6">
        <p className="text-sm text-[var(--color-text-muted)]">
          NFL game lines and player props — coming soon.
        </p>
      </main>
    </div>
  )
}
