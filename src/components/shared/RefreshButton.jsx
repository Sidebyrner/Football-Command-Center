import { RefreshCw } from 'lucide-react'
import '../../screens/tools/researchTools.css'

export default function RefreshButton({ onClick, loading = false, label = 'Refresh' }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} aria-busy={loading} className="button rt-button t-meta">
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
      {label}
    </button>
  )
}
