import Header from '../components/layout/Header'

export default function SitStart() {
  return (
    <div className="flex flex-col h-screen">
      <Header title="Sit / Start" />
      <main className="flex-1 overflow-auto p-6">
        <p className="text-sm text-[var(--color-text-muted)]">
          Side-by-side player comparison tool — coming soon.
        </p>
      </main>
    </div>
  )
}
