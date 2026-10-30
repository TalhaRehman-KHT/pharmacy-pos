import './Table.css'

// A data table; thead/tbody/tfoot are its children. Wrapped in a bordered, scrollable box unless bare
// (the batch list nested inside a Medicines row). clickable gives rows a pointer and a focus style for
// tables whose rows open something.
export default function Table({ bare = false, compact = false, clickable = false, className, children }) {
  const classes = ['table', compact && 'table-compact', clickable && 'clickable', className]
  const table = <table className={classes.filter(Boolean).join(' ')}>{children}</table>
  return bare ? table : <div className="table-wrap">{table}</div>
}
