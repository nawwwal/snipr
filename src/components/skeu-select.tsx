"use client";

import { useEffect, useId, useRef, useState } from "react";

export type SkeuSelectOption = {
  value: string;
  label: string;
  /** e.g. HLS / adaptive row — warm accent */
  accent?: "adaptive";
};

type SkeuSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SkeuSelectOption[];
  className?: string;
  "aria-label"?: string;
};

export function SkeuSelect({ id, value, onChange, options, className, "aria-label": ariaLabel }: SkeuSelectProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const listId = `${triggerId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? options[0];
  const label = selected?.label ?? "";

  useEffect(() => {
    if (!open) {
      return;
    }

    const onDoc = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        id={triggerId}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="skeu-select-trigger"
      >
        <span className="min-w-0 truncate text-left">{label}</span>
        <span
          className={`skeu-select-trigger__chev shrink-0${open ? " skeu-select-trigger__chev--open" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          className="skeu-select-menu skeu-scroll"
          id={listId}
          role="listbox"
          aria-activedescendant={`${triggerId}-opt-${value}`}
        >
          {options.map((opt) => {
            const isCurrent = opt.value === value;
            const adaptive = opt.accent === "adaptive";

            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isCurrent}
                id={`${triggerId}-opt-${opt.value}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`skeu-select-option${isCurrent ? " skeu-select-option--current" : ""}${adaptive ? " skeu-select-option--adaptive" : ""}`}
              >
                <span className="skeu-select-option__mark" aria-hidden>
                  {isCurrent ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1 break-words text-left">{opt.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
