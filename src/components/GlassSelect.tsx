import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}

interface Press {
  x: number;
  y: number;
  t: number;
  moved: boolean;
  /** Where the press started: the button, or an option in the open menu. */
  from: 'button' | 'menu';
  /** Menu was already open when the button was pressed (so a plain click closes it). */
  wasOpen: boolean;
}

/** Further than this (px) counts as a drag rather than a click. */
const DRAG_SLOP = 4;
/** Holding the button this long (ms) and releasing on an option picks it, even without moving. */
const HOLD_MS = 300;

/**
 * Glass dropdown (listbox pattern) that matches the header instead of the OS-styled native select.
 *
 * Pointer gestures work like a native menu:
 *  - click the button to open, click an option to pick it;
 *  - press the button, drag onto an option and release to pick it in one gesture;
 *  - with the menu open, press anywhere in it, slide between options and release on one.
 * Options are picked on release, never on press, so sliding always lands where you let go.
 */
export function GlassSelect<T extends string | number>({ label, value, options, onChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  // Latest values for the document-level gesture listeners, which outlive a render.
  const latest = useRef({ options, onChange });
  latest.current = { options, onChange };
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    const { options: opts, onChange: change } = latest.current;
    change(opts[i].value);
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };

  const optionAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[role="option"]');
    if (!el || !menuRef.current?.contains(el)) return null;
    return Number(el.dataset.index);
  };
  const overButton = (x: number, y: number) => !!buttonRef.current?.contains(document.elementFromPoint(x, y));

  /** Tracks one press until release. Listeners attach synchronously so a quick flick isn't missed. */
  const startPress = (e: ReactPointerEvent, from: Press['from'], wasOpen: boolean) => {
    // Touch and pen capture the pointer to the pressed element; release it so moves hit-test the menu.
    const target = e.currentTarget as Element;
    if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId);
    cleanup.current?.();
    const press: Press = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, from, wasOpen };
    const pointerId = e.pointerId;
    setDragging(true);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > DRAG_SLOP) press.moved = true;
      const i = optionAt(ev.clientX, ev.clientY);
      if (i !== null) setActive(i);
      if (press.moved) ev.preventDefault();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      end();
      const i = optionAt(ev.clientX, ev.clientY);
      const held = press.moved || performance.now() - press.t > HOLD_MS;
      if (i !== null) {
        // From the button, a quick click that happens to end on the menu shouldn't pick anything.
        if (press.from === 'menu' || held) choose(i);
      } else if (overButton(ev.clientX, ev.clientY)) {
        // A plain click on the button toggles; a drag that comes back to it leaves the menu as it was.
        if (press.from === 'button' && press.wasOpen && !press.moved) setOpen(false);
      } else if (press.moved) {
        setOpen(false);
      }
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', end);
      cleanup.current = null;
      setDragging(false);
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', end);
    cleanup.current = end;
  };

  return (
    <div className="gselect" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="glass-btn gselect-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${current.label}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); // no text selection while dragging
          buttonRef.current?.focus({ preventScroll: true });
          const wasOpen = open;
          if (!open) openMenu();
          startPress(e, 'button', wasOpen);
        }}
        onClick={(e) => {
          // Pointer clicks are handled by the press; only keyboard activation (detail 0) toggles here.
          if (e.detail !== 0) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openMenu();
          } else if (open && e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (open && e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (open && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        <span className="gselect-label">{label}</span>
        <span className="gselect-value">{current.label}</span>
        <svg className="gselect-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul ref={menuRef} className={`gselect-menu glass${dragging ? ' dragging' : ''}`} role="listbox" id={listId} aria-label={label}>
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              role="option"
              data-index={i}
              aria-selected={o.value === value}
              className={`${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                setActive(i);
                startPress(e, 'menu', true);
              }}
            >
              <span>{o.label}</span>
              {o.hint && <small>{o.hint}</small>}
              {o.value === value && (
                <svg viewBox="0 0 12 12" aria-hidden="true" className="gselect-check">
                  <path d="M2.5 6.5l2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
