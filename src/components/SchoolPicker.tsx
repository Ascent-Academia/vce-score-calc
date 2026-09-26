import { useId, useMemo, useRef, useState } from 'react';
import { SCHOOLS, SCHOOL_PRESETS, schoolKey } from '../lib/moderation';

interface Props {
  value: string | null;
  onChange: (key: string) => void;
}

interface Item {
  key: string;
  label: string;
  sub: string;
}

const PRESET_ITEMS: Item[] = SCHOOL_PRESETS.map((p) => ({ key: p.id, label: p.label, sub: 'School not listed' }));
const SCHOOL_ITEMS: Item[] = SCHOOLS.map((s) => ({ key: schoolKey(s), label: s.name, sub: s.locality.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) }));

export function labelForSchool(key: string | null): string {
  if (!key) return '';
  return [...SCHOOL_ITEMS, ...PRESET_ITEMS].find((i) => i.key === key)?.label ?? '';
}

/** Searchable school selector (combobox pattern) over VCAA's school list plus rough presets. */
export function SchoolPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...PRESET_ITEMS, ...SCHOOL_ITEMS];
    const words = q.split(/\s+/);
    const hit = (i: Item) => words.every((w) => `${i.label} ${i.sub}`.toLowerCase().includes(w));
    // Schools whose name matches rank above ones that only match on suburb.
    const nameHit = (i: Item) => words.every((w) => i.label.toLowerCase().includes(w));
    const schools = SCHOOL_ITEMS.filter(hit).sort((a, b) => Number(nameHit(b)) - Number(nameHit(a)));
    const presets = PRESET_ITEMS.filter(hit);
    // Offer the rough levels when the school isn't found.
    return [...schools, ...(presets.length ? presets : schools.length ? [] : PRESET_ITEMS)];
  }, [query]);

  const choose = (i: Item) => {
    onChange(i.key);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="picker">
      <input
        ref={inputRef}
        role="combobox"
        aria-label="School"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={open ? query : labelForSchool(value)}
        placeholder={value ? labelForSchool(value) : 'Search your school…'}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(matches.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && matches[active]) {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {open && (
        <ul className="picker-list" id={listId} role="listbox">
          {matches.slice(0, 60).map((item, i) => (
            <li
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{item.label}</span>
              <small>{item.sub}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
