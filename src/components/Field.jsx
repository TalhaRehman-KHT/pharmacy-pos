import './Field.css'

// A labelled form field: the label, the control passed as children, then the error or else the hint.
// Rendered as a <label> so clicking the text focuses the control; pass as="div" when the children
// hold more than one control (Stock Entry's medicine picker).
export default function Field({ label, error, hint, required, wide, as: Tag = 'label', className, children }) {
  const classes = ['field', wide && 'wide', error && 'has-error', className]
  return (
    <Tag className={classes.filter(Boolean).join(' ')}>
      <span className="field-label">
        {label}
        {required && <span className="required"> *</span>}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </Tag>
  )
}
