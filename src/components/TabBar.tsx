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
const MAX_STRETCH = 64; // px the bar can stretch when the pill is pulled past an end
const MAX_STRETCH_Y = 14; // px the bar can stretch when the pill is pulled up or down

/** iOS-style rubber band: grows with the overshoot but never exceeds `max`. */
const rubberBand = (over: number, max: number) => (1 - 1 / ((over * 0.55) / max + 1)) * max;

/**
 * Glass tab bar whose pill can be dragged: press anywhere on the bar and slide,
 * the pill follows the pointer and snaps to the nearest tab on release.
 * A plain tap still selects a tab.
 */
export function TabBar<T extends string>({ tabs, value, onChange }: Props<T>) {
  const navRef = useRef<HTMLElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragged = useRef(false);
  const [dragX, setDragX] = useState<number | null>(null);
  // Signed overshoot past the ends while dragging: negative = left, positive = right.
  const [stretch, setStretch] = useState(0);
  // Signed vertical pull while dragging: negative = up, positive = down.
  const [stretchY, setStretchY] = useState(0);
  // Origins outlive the stretch so the spring-back stays anchored to the same edges.
  const [originX, setOriginX] = useState('center');
  const [originY, setOriginY] = useState('center');

  const index = tabs.findIndex((t) => t.id === value);
  // Measured in the bar's own (unstretched) space, so the stretch transform doesn't feed back.
  const geometry = () => {
    const nav = navRef.current!;
    const rect = nav.getBoundingClientRect();
    const inner = nav.offsetWidth - PAD * 2;
    return { rect, scale: rect.width / nav.offsetWidth, inner, w: inner / tabs.length };
  };
  const pillX = (clientX: number) => {
    const { rect, scale, inner, w } = geometry();
    const raw = (clientX - rect.left) / scale - PAD - w / 2;
    const x = Math.max(0, Math.min(inner - w, raw));
    return { x, over: raw - x };
  };
  const nearest = (x: number) => Math.round(x / geometry().w);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    if (!dragged.current) {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < DRAG_THRESHOLD) return;
      dragged.current = true;
      // Capture only once it's a real drag, so plain taps still reach the buttons.
      navRef.current!.setPointerCapture(e.pointerId);
    }
    const { x, over } = pillX(e.clientX);
    setDragX(x);
    setStretch(Math.sign(over) * rubberBand(Math.abs(over), MAX_STRETCH));
    if (over !== 0) setOriginX(over > 0 ? 'left' : 'right');
    const dy = e.clientY - start.current.y;
    setStretchY(Math.sign(dy) * rubberBand(Math.abs(dy), MAX_STRETCH_Y));
    if (dy !== 0) setOriginY(dy > 0 ? 'top' : 'bottom');
  };
  const endDrag = (e: PointerEvent<HTMLElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    start.current = null;
    if (dragged.current && dragX !== null) {
      const i = Math.max(0, Math.min(tabs.length - 1, nearest(dragX)));
      onChange(tabs[i].id);
    }
    setDragX(null);
    setStretch(0);
    setStretchY(0);
  };

  const shown = dragX !== null ? Math.max(0, Math.min(tabs.length - 1, nearest(dragX))) : index;
  const style = {
    '--tab-index': index,
    '--tab-count': tabs.length,
    ...(dragX !== null ? { '--drag-x': `${dragX}px` } : {}),
    transformOrigin: `${originX} ${originY}`,
    ...((stretch !== 0 || stretchY !== 0) && navRef.current
      ? {
          // Pulling sideways also thins the bar slightly; pulling up or down makes it taller.
          '--stretch-x': 1 + Math.abs(stretch) / navRef.current.offsetWidth,
          '--stretch-y': 1 + Math.abs(stretchY) / navRef.current.offsetHeight - Math.abs(stretch) / 600,
        }
      : {}),
  } as CSSProperties;

  return (
    <nav
      ref={navRef}
      className={`tabs glass${dragX !== null ? ' dragging' : ''}${stretch !== 0 ? ' stretching' : ''}`}
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
