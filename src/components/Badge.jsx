import './Badge.css'

// A small uppercase label next to a name: role, Inactive, You, a sale's status.
// tone: 'neutral' | 'warning' | 'danger' | 'success'
export default function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
