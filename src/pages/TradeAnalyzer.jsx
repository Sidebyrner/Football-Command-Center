import Header from '../components/layout/Header'

export default function TradeAnalyzer() {
  return (
    <div className="flex flex-col h-screen">
      <Header title="Trade Analyzer" />
      <main className="flex-1 overflow-auto p-6">
        <p className="text-sm text-[var(--color-text-muted)]">
          Trade value comparison tool — coming soon.
        </p>
      </main>
    </div>
  )
}
