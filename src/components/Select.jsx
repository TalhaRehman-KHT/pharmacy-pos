import './Field.css'

// A <select>; the options are its children. Every other prop, ref included, goes to the <select>.
export default function Select({ className, children, ...props }) {
  return (
    <select {...props} className={['select', className].filter(Boolean).join(' ')}>
      {children}
    </select>
  )
}
