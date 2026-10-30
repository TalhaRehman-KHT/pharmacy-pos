import { useEffect, useId, useRef, useState } from 'react'
import { medicines as api } from '../lib/api.js'
import Toast from './Toast.jsx'
import './MedicineSearch.css'

const RECENT_COUNT = 8
const MAX_RESULTS = 50

// Search field with an always-visible result list below it. Shared by Stock Entry and Billing.
// Keyboard: arrows move, Enter picks, Escape clears. A barcode scanner (types the code, then Enter)
// works because an exact barcode match ranks first and an Enter that beats the results is held until they land.
// renderNoMatch(term) renders an action when nothing matches (term is '' when there are no medicines at all).
// renderResultExtra(medicine) renders extra content at the end of each result row (Billing shows stock there).
export default function MedicineSearch({
  onSelect,
  renderNoMatch,
  renderResultExtra,
  autoFocus = false,
  placeholder = 'Search name, generic, company or scan a barcode',
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  // The term the current results belong to; differs from term while a lookup is in flight
  const [resultsTerm, setResultsTerm] = useState(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const pendingEnterRef = useRef(false)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()

  const term = query.trim()
  const stale = resultsTerm !== term

  function select(medicine) {
    pendingEnterRef.current = false
    setQuery('')
    onSelect(medicine)
    inputRef.current?.focus()
  }

  useEffect(() => {
    let cancelled = false
    api
      .list({ search: term, activeOnly: true })
      .then((rows) => {
        if (cancelled) return
        const ordered = term ? rankResults(rows, term) : [...rows].sort(byNewest)
        const shown = ordered.slice(0, term ? MAX_RESULTS : RECENT_COUNT)
        setResults(shown)
        setTotal(ordered.length)
        setResultsTerm(term)
        setActive(0)
        setError('')
        if (pendingEnterRef.current) {
          pendingEnterRef.current = false
          if (shown.length) select(shown[0])
        }
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
    // Only term drives the lookup; select is deliberately left out of the deps
  }, [term])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function handleKeyDown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        // Always prevent: the field usually sits inside a form that Enter would submit
        e.preventDefault()
        if (stale) {
          if (term) pendingEnterRef.current = true
        } else if (results[active]) {
          select(results[active])
        }
        break
      case 'Escape':
        if (query) {
          e.preventDefault()
          setQuery('')
        }
        break
    }
  }

  const activeItem = !stale ? results[active] : undefined
  const showNoMatch = !stale && !error && results.length === 0

  return (
    <div className="medicine-search">
      <input
        ref={inputRef}
        type="search"
        className="medicine-search-input"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="medicine-search-caption">
        {term
          ? stale
            ? 'Searching...'
            : `${total} match${total === 1 ? '' : 'es'}${total > results.length ? `, showing first ${results.length}` : ''}`
          : 'Recently added'}
      </div>

      {error && <Toast tone="error">{error}</Toast>}

      {results.length > 0 && (
        <ul id={listId} ref={listRef} role="listbox" className="medicine-search-list">
          {results.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${m.id}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              className={`medicine-search-option${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              // Keep focus in the input so the keyboard flow continues after a click
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(m)}
            >
              <span className="ms-name">{m.name}</span>
              <span className="ms-meta">{[m.generic_name, m.company].filter(Boolean).join(' · ')}</span>
              {m.barcode && <span className="ms-barcode mono">{m.barcode}</span>}
              {renderResultExtra?.(m)}
            </li>
          ))}
        </ul>
      )}

      {showNoMatch && (
        <div className="medicine-search-empty">
          <span>{term ? `No medicines match "${term}".` : 'No medicines yet.'}</span>
          {renderNoMatch?.(term)}
        </div>
      )}
    </div>
  )
}

function byNewest(a, b) {
  return b.created_at.localeCompare(a.created_at) || b.id - a.id
}

// Server results arrive sorted by name; float the most likely picks to the top (sort is stable)
function rankResults(rows, term) {
  const needle = term.toLowerCase()
  const score = (m) => {
    if (m.barcode && m.barcode.toLowerCase() === needle) return 0
    const name = m.name.toLowerCase()
    if (name.startsWith(needle)) return 1
    if (name.includes(` ${needle}`)) return 2
    if (m.generic_name?.toLowerCase().startsWith(needle)) return 3
    return 4
  }
  return rows
    .map((m) => ({ m, s: score(m) }))
    .sort((a, b) => a.s - b.s)
    .map(({ m }) => m)
}
