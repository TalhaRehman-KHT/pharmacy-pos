import './Card.css'

// A bordered panel. as="form" | "section" | "button" etc. picks the element; other props, ref included,
// go to it. padding="none" for a card whose content brings its own.
export default function Card({ as: Tag = 'div', padding, className, children, ...props }) {
  const classes = ['card', padding === 'none' && 'card-flush', className]
  return (
    <Tag {...props} className={classes.filter(Boolean).join(' ')}>
      {children}
    </Tag>
  )
}
