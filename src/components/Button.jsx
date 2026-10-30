import { AlertIcon } from './icons.jsx'
import './Button.css'

// variant: 'primary' | 'secondary' | 'danger' | 'danger-solid'.
// Destructive actions never use primary or secondary: 'danger' (red outline with a warning icon) opens or
// starts one, 'danger-solid' is the final click inside its confirmation dialog.
// loading disables the button and shows a spinner; the caller keeps choosing the label, e.g. 'Saving…'.
// Defaults to type="button" so a button inside a form only submits when asked to. Other props, ref
// included, go to the <button>.
export default function Button({
  variant = 'secondary',
  size,
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}) {
  const classes = ['btn', `btn-${variant}`, size === 'small' && 'btn-small', loading && 'is-loading', className]
  return (
    <button
      {...props}
      type={type}
      className={classes.filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <span className="btn-spinner" aria-hidden="true" />
      ) : (
        variant.startsWith('danger') && <AlertIcon size={size === 'small' ? 14 : 16} />
      )}
      {children}
    </button>
  )
}
