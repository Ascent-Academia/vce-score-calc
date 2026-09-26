import { useId, useMemo, useRef, useState } from 'react';
import type { Study } from '../lib/data';

interface Props {
  studies: Study[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  label: string;
}

/** Searchable study selector (combobox pattern). */
export function StudyPicker({ studies, value, onChange, placeholder = 'Search studies…', label }: Props) {
  const selected = studies.find((s) => s.id === value) ?? null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return studies;
    const words = q.split(/\s+/);
    return studies
      .filter((s) => words.every((w) => s.name.toLowerCase().includes(w) || s.id.toLowerCase() === w))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
  }, [query, studies]);

  const choose = (s: Study) => {
    onChange(s.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="picker">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        value={open ? query : (selected?.name ?? '')}
        placeholder={selected ? selected.name : placeholder}
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
          {matches.length === 0 && <li className="picker-empty">No matching study</li>}
          {matches.slice(0, 60).map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${s.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{s.name}</span>
              {s.group && <small>{s.group}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
