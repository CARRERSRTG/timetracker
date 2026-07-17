import { useEffect, useRef, useState } from 'react';

// Tab strip with an optional overflow group: pass `primaryIds` to keep only
// those tabs inline and tuck the rest behind a "More" dropdown (its label
// swaps to the active tab's name when the current tab lives in the overflow
// group, so the current section is never hidden). Without `primaryIds` all
// tabs render inline, unchanged.
export default function TabBar({ tabs, active, onChange, primaryIds }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const primarySet = primaryIds ? new Set(primaryIds) : null;
  const primary = primarySet ? tabs.filter((tb) => primarySet.has(tb.id)) : tabs;
  const overflow = primarySet ? tabs.filter((tb) => !primarySet.has(tb.id)) : [];
  const activeOverflow = overflow.find((tb) => tb.id === active);
  const overflowBadge = overflow.reduce((n, tb) => n + (tb.badge > 0 ? tb.badge : 0), 0);

  return (
    <div className="tabbar">
      <div className="tabs">
        {primary.map(({ id, label, badge }) => (
          <button key={id} className={active === id ? 'active' : ''} onClick={() => onChange(id)}>
            {label}
            {badge > 0 && <span className="badge">{badge}</span>}
          </button>
        ))}
      </div>
      {overflow.length > 0 && (
        <div className="tabmore" ref={menuRef}>
          <button type="button" className={activeOverflow ? 'active' : ''} onClick={() => setOpen((o) => !o)}>
            {activeOverflow ? activeOverflow.label : 'More'} ▾
            {overflowBadge > 0 && <span className="badge">{overflowBadge}</span>}
          </button>
          {open && (
            <div className="tabmore-menu">
              {overflow.map(({ id, label, badge }) => (
                <button
                  key={id}
                  className={active === id ? 'active' : ''}
                  onClick={() => { onChange(id); setOpen(false); }}
                >
                  {label}
                  {badge > 0 && <span className="badge">{badge}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
