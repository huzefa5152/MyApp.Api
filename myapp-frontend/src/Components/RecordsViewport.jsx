import './RecordsViewport.css';

/** One keyboard-accessible scrolling area; filters and actions stay in place. */
export default function RecordsViewport({children, label = 'Records', enabled = true}) {
  if(!enabled)return children;
  return <section className="records-viewport" data-records-viewport="" role="region" aria-label={label} tabIndex={0}>{children}</section>;
}
