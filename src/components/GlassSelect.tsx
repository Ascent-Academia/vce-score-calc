import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

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
/** Length of the close animation (ms), matching .gselect-menu.closing in CSS. */
const CLOSE_MS = 170;
/** How far (px) the highlight can be pulled past the first or last option. */
const MAX_OVERSHOOT = 10;

/** iOS-style rubber band, as in the tab bar: grows with the overshoot but never exceeds `max`. */
const rubberBand = (over: number, max: number) => (1 - 1 / ((over * 0.55) / max + 1)) * max;

/**
 * Glass dropdown (listbox pattern) that matches the header instead of the OS-styled native select.
 *
 * A highlight pill slides between options like the tab bar's pill: it springs to the
 * hovered option, follows the pointer while you drag, and settles on the one you release on.
 *  - click the button to open, click an option to pick it;
 *  - press the button, drag onto an option and release to pick it in one gesture;
 *  - with the menu open, press anywhere in it, slide between options and release on one.
 * Options are picked on release, never on press, so sliding always lands where you let go.
 */
export function GlassSelect<T extends string | number>({ label, value, options, onChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** Highlight position while it follows the pointer (px from the menu's top), else null. */
  const [dragY, setDragY] = useState<number | null>(null);
  const [rows, setRows] = useState<{ top: number; height: number }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  const isOpen = open && !closing;

  // Latest values for the document-level gesture listeners, which outlive a render.
  const latest = useRef({ options, onChange, rows });
  latest.current = { options, onChange, rows };
  const cleanup = useRef<(() => void) | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      cleanup.current?.();
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // Measure the options once the menu is in the DOM, before paint, so the pill starts in place.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const lis = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="option"]'));
    setRows(lis.map((li) => ({ top: li.offsetTop, height: li.offsetHeight })));
  }, [open, options.length]);

  const closeMenu = () => {
    window.clearTimeout(closeTimer.current);
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setDragY(null);
    }, CLOSE_MS);
  };

  useEffect(() => {
    if (!isOpen) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const openMenu = () => {
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setDragY(null);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    const { options: opts, onChange: change } = latest.current;
    setActive(i);
    setDragY(null); // the pill springs onto the chosen option as the menu fades
    change(opts[i].value);
    buttonRef.current?.focus({ preventScroll: true });
    closeMenu();
  };

  /** Index of the option nearest to a y position inside the menu. */
  const nearestRow = (y: number) => {
    const r = latest.current.rows;
    let best = 0;
    for (let i = 1; i < r.length; i++) {
      if (Math.abs(r[i].top + r[i].height / 2 - y) < Math.abs(r[best].top + r[best].height / 2 - y)) best = i;
    }
    return best;
  };
  /** Pointer y relative to the menu's top, or null when the pointer is outside the menu. */
  const inMenu = (x: number, y: number) => {
    const m = menuRef.current?.getBoundingClientRect();
    if (!m || x < m.left || x > m.right || y < m.top - 4 || y > m.bottom + 4) return null;
    return y - m.top;
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

    // The pill tracks the pointer continuously (not row by row), with a rubber band past the ends.
    const follow = (x: number, y: number) => {
      const r = latest.current.rows;
      const rel = inMenu(x, y);
      if (rel === null || r.length === 0) {
        setDragY(null);
        return;
      }
      const h = r[0].height;
      const min = r[0].top;
      const max = r[r.length - 1].top;
      const raw = rel - h / 2;
      const clamped = Math.max(min, Math.min(max, raw));
      const over = raw - clamped;
      setDragY(clamped + Math.sign(over) * rubberBand(Math.abs(over), MAX_OVERSHOOT));
      setActive(nearestRow(rel));
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > DRAG_SLOP) press.moved = true;
      if (press.moved || press.from === 'menu') follow(ev.clientX, ev.clientY);
      if (press.moved) ev.preventDefault();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      end();
      const rel = inMenu(ev.clientX, ev.clientY);
      const held = press.moved || performance.now() - press.t > HOLD_MS;
      if (rel !== null) {
        // From the button, a quick click that happens to end on the menu shouldn't pick anything.
        if (press.from === 'menu' || held) choose(nearestRow(rel));
        else setDragY(null);
        return;
      }
      setDragY(null);
      if (overButton(ev.clientX, ev.clientY)) {
        // A plain click on the button toggles; a drag that comes back to it leaves the menu as it was.
        if (press.from === 'button' && press.wasOpen && !press.moved) closeMenu();
      } else if (press.moved) {
        closeMenu();
      }
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      cleanup.current = null;
      setDragging(false);
    };
    const cancel = () => {
      end();
      setDragY(null);
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    cleanup.current = end;
  };

  const row = rows[active];
  const pillStyle = {
    '--pill-y': `${dragY ?? row?.top ?? 0}px`,
    '--pill-h': `${row?.height ?? 0}px`,
  } as CSSProperties;

  return (
    <div className="gselect" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="glass-btn gselect-button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-label={`${label}: ${current.label}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); // no text selection while dragging
          buttonRef.current?.focus({ preventScroll: true });
          const wasOpen = isOpen;
          if (!wasOpen) openMenu();
          startPress(e, 'button', wasOpen);
        }}
        onClick={(e) => {
          // Pointer clicks are handled by the press; only keyboard activation (detail 0) toggles here.
          if (e.detail !== 0) return;
          if (isOpen) closeMenu();
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openMenu();
          } else if (isOpen && e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (isOpen && e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (isOpen && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            choose(active);
          } else if (isOpen && e.key === 'Escape') {
            closeMenu();
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
        <ul
          ref={menuRef}
          className={`gselect-menu glass${dragging ? ' dragging' : ''}${dragY !== null ? ' following' : ''}${closing ? ' closing' : ''}`}
          role="listbox"
          id={listId}
          aria-label={label}
          style={pillStyle}
        >
          {rows.length > 0 && <span className="gselect-pill" aria-hidden="true" />}
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              role="option"
              data-index={i}
              aria-selected={o.value === value}
              className={`${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
              onPointerEnter={() => {
                if (!dragging) setActive(i);
              }}
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
