import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

interface TabDef<T extends string> {
  id: T;
  label: string;
  short: string;
}

interface Props<T extends string> {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
}

const PAD = 5; // inner padding of the tab bar (matches CSS)
const DRAG_THRESHOLD = 4;

/**
 * Glass tab bar whose pill can be dragged: press anywhere on the bar and slide,
 * the pill follows the pointer and snaps to the nearest tab on release.
 * A plain tap still selects a tab.
 */
export function TabBar<T extends string>({ tabs, value, onChange }: Props<T>) {
  const navRef = useRef<HTMLElement>(null);
  const start = useRef<{ x: number; id: number } | null>(null);
  const dragged = useRef(false);
  const [dragX, setDragX] = useState<number | null>(null);

  const index = tabs.findIndex((t) => t.id === value);
  const geometry = () => {
    const rect = navRef.current!.getBoundingClientRect();
    const inner = rect.width - PAD * 2;
    return { rect, inner, w: inner / tabs.length };
  };
  const pillX = (clientX: number) => {
    const { rect, inner, w } = geometry();
    return Math.max(0, Math.min(inner - w, clientX - rect.left - PAD - w / 2));
  };
  const nearest = (x: number) => Math.round(x / geometry().w);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, id: e.pointerId };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    if (!dragged.current) {
      if (Math.abs(e.clientX - start.current.x) < DRAG_THRESHOLD) return;
      dragged.current = true;
      // Capture only once it's a real drag, so plain taps still reach the buttons.
      navRef.current!.setPointerCapture(e.pointerId);
    }
    setDragX(pillX(e.clientX));
  };
  const endDrag = (e: PointerEvent<HTMLElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    start.current = null;
    if (dragged.current && dragX !== null) {
      const i = Math.max(0, Math.min(tabs.length - 1, nearest(dragX)));
      onChange(tabs[i].id);
    }
    setDragX(null);
  };

  const shown = dragX !== null ? Math.max(0, Math.min(tabs.length - 1, nearest(dragX))) : index;
  const style = {
    '--tab-index': index,
    '--tab-count': tabs.length,
    ...(dragX !== null ? { '--drag-x': `${dragX}px` } : {}),
  } as CSSProperties;

  return (
    <nav
      ref={navRef}
      className={`tabs glass${dragX !== null ? ' dragging' : ''}`}
      role="tablist"
      aria-label="Calculator sections"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="tab-pill" aria-hidden="true" />
      {tabs.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={i === shown ? 'active' : ''}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            onChange(t.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
              onChange(tabs[next].id);
              (e.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement | undefined)?.focus();
            }
          }}
        >
          <span className="tab-long">{t.label}</span>
          <span className="tab-short" aria-hidden="true">
            {t.short}
          </span>
        </button>
      ))}
    </nav>
  );
}
