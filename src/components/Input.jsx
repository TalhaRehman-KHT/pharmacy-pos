import './Field.css'

// A text-like <input>. align="right" for amounts and quantities, size="large" for the billing cart,
// mono for codes. Every other prop, ref included, goes to the <input>.
export default function Input({ align, size, mono, invalid, className, ...props }) {
  const classes = ['input', align === 'right' && 'input-right', size === 'large' && 'input-large', mono && 'mono', className]
  return (
    <input
      aria-invalid={invalid || undefined}
      {...props}
      className={classes.filter(Boolean).join(' ')}
    />
  )
}
