import { InboxIcon } from './icons.jsx'
import './EmptyState.css'

// What a list shows when it has nothing in it. compact drops the icon and padding, for small spots such as
// the batch list inside a medicine row.
export default function EmptyState({ compact = false, children }) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`}>
      {!compact && <InboxIcon size={28} />}
      <p>{children}</p>
    </div>
  )
}
