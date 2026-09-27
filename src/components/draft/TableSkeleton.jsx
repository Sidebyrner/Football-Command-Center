// Placeholder rows shaped like the board's columns while players load.
const WIDTHS = [128, 34, 40, 28, 28, 28, 24, 64, 56, 0, 16]
const ALIGN_RIGHT = new Set([3, 4, 5, 6])

export default function TableSkeleton({ rows = 20 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="dd-skel-row" aria-hidden="true">
          {WIDTHS.map((w, c) => (
            <td key={c}>
              {w > 0 && (
                <div
                  className="dd-skel"
                  style={{ width: w, marginLeft: ALIGN_RIGHT.has(c) || c === 10 ? 'auto' : undefined, marginRight: c === 10 ? 'auto' : undefined }}
                />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
