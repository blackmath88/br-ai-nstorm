export function ApertureModal({
  title, help, value, setValue, primaryLabel, onPrimary, onClose, status,
}: {
  title:string
  help:string
  value:string
  setValue:(value:string)=>void
  primaryLabel:string
  onPrimary:()=>void
  onClose:()=>void
  /** Validation feedback or a copy confirmation, shown next to the action. */
  status?:string|null
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <div className="section-kicker">Clipboard aperture</div>
            <h2>{title}</h2>
          </div>
          <button className="button" onClick={onClose}>Close</button>
        </div>
        <p className="modal-help">{help}</p>
        <textarea className="json-textarea" value={value} onChange={(e)=>setValue(e.target.value)} />
        <div className="button-row">
          <button className="button primary" onClick={onPrimary}>{primaryLabel}</button>
          {status && <span className="modal-status">{status}</span>}
        </div>
      </div>
    </div>
  )
}
