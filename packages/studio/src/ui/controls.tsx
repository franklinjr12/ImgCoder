/** Hand-written form controls for the inspectors (no UI library). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseColor, toHex } from '@game-artisan/core';
import { Icon } from './icons';

export function Section({ title, children, actions, defaultOpen = true, badge }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header className="section-head" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span className="section-title">{title}</span>
        {badge}
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </header>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}

export function Row({ label, children, hint, wide }: { label?: ReactNode; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <div className={`row ${wide ? 'wide' : ''}`}>
      {label != null ? <label className="row-label">{label}</label> : null}
      <div className="row-control">{children}</div>
      {hint ? <div className="row-hint">{hint}</div> : null}
    </div>
  );
}

const fmt = (v: number, precision = 2) => {
  if (!Number.isFinite(v)) return '';
  const p = Math.pow(10, precision);
  return String(Math.round(v * p) / p);
};

/** Number input with scrub-on-label, arrow keys (Shift ×10) and expression-free parsing. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision = 2,
  suffix,
  label,
  disabled,
  title,
  mixed,
}: {
  value: number | undefined;
  onChange: (v: number, coalesce?: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  label?: string;
  disabled?: boolean;
  title?: string;
  mixed?: boolean;
}) {
  const [text, setText] = useState(mixed ? '' : fmt(value ?? 0, precision));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(mixed ? '' : fmt(value ?? 0, precision));
  }, [value, focused, precision, mixed]);
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const commit = (t: string) => {
    let v = Number(t.replace(',', '.'));
    if (/^[\d.\s+\-*/()]+$/.test(t) && !Number.isFinite(v)) {
      try {
        // simple arithmetic: "100/2", "20+4"
        // eslint-disable-next-line no-new-func
        v = Function(`"use strict";return (${t})`)();
      } catch {
        /* ignore */
      }
    }
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(fmt(value ?? 0, precision));
  };
  const scrub = useRef<{ x: number; v: number } | null>(null);
  return (
    <div className={`num ${disabled ? 'disabled' : ''}`} title={title}>
      {label ? (
        <span
          className="num-label"
          onPointerDown={(e) => {
            if (disabled) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            scrub.current = { x: e.clientX, v: value ?? 0 };
          }}
          onPointerMove={(e) => {
            if (!scrub.current) return;
            const dx = e.clientX - scrub.current.x;
            const s = step * (e.shiftKey ? 10 : 1);
            onChange(clamp(scrub.current.v + Math.round(dx / 2) * s), true);
          }}
          onPointerUp={() => (scrub.current = null)}
        >
          {label}
        </span>
      ) : null}
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        placeholder={mixed ? 'Mixed' : undefined}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={(e) => {
          setFocused(false);
          if (e.target.value !== fmt(value ?? 0, precision)) commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(fmt(value ?? 0, precision));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clamp((value ?? 0) + d);
            setText(fmt(v, precision));
            onChange(v, true);
          }
          e.stopPropagation();
        }}
      />
      {suffix ? <span className="num-suffix">{suffix}</span> : null}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, precision = 2, suffix }: { value: number; onChange: (v: number, coalesce?: boolean) => void; min: number; max: number; step?: number; precision?: number; suffix?: string }) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} style={{ ['--pct' as any]: `${Math.max(0, Math.min(100, pct))}%` }} onChange={(e) => onChange(Number(e.target.value), true)} />
      <NumberField value={value} onChange={onChange} min={min} max={max} step={step} precision={precision} suffix={suffix} />
    </div>
  );
}

export function TextField({ value, onChange, placeholder, multiline, rows = 3, live = true, mono, autoFocus, inputRef }: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number; live?: boolean; mono?: boolean; autoFocus?: boolean; inputRef?: React.Ref<any> }) {
  const [text, setText] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value ?? '');
  }, [value, focused]);
  const props = {
    value: text,
    placeholder,
    autoFocus,
    ref: inputRef,
    className: mono ? 'mono' : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (text !== value) onChange(text);
    },
    onChange: (e: any) => {
      setText(e.target.value);
      if (live) onChange(e.target.value);
    },
    onKeyDown: (e: any) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) (e.target as HTMLElement).blur();
    },
  };
  return multiline ? <textarea rows={rows} {...props} /> : <input type="text" {...props} />;
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={value} className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label ? <span className="toggle-label">{label}</span> : null}
    </button>
  );
}

export function Select<T extends string | number>({ value, options, onChange, title }: { value: T | undefined; options: { value: T; label: string }[] | T[]; onChange: (v: T) => void; title?: string }) {
  const opts = (options as any[]).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })) as { value: T; label: string }[];
  const idx = opts.findIndex((o) => o.value === value);
  return (
    <div className="select" title={title}>
      <select value={idx < 0 ? '' : String(idx)} onChange={(e) => onChange(opts[Number(e.target.value)].value)}>
        {idx < 0 ? <option value="">{value == null ? '—' : String(value)}</option> : null}
        {opts.map((o, i) => (
          <option key={i} value={String(i)}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={12} />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Colour swatch + native picker + hex/CSS text input (keeps alpha from rgba/8-digit hex). */
export function ColorField({ value, onChange }: { value: string; onChange: (v: string, coalesce?: boolean) => void }) {
  let hex = '#000000';
  let alpha = 1;
  const c = parseColor(value || '#000');
  if (c) {
    hex = toHex(c).slice(0, 7);
    alpha = c.a ?? 1;
  }
  const withAlpha = (h: string, a: number) => (a >= 1 ? h : `${h}${Math.round(a * 255).toString(16).padStart(2, '0')}`);
  return (
    <div className="color-field">
      <label className="swatch" style={{ ['--c' as any]: value || 'transparent' }}>
        <input type="color" value={hex} onChange={(e) => onChange(withAlpha(e.target.value, alpha), true)} />
      </label>
      <TextField value={value} onChange={(v) => onChange(v)} live={false} mono />
      <input
        className="alpha"
        type="number"
        min={0}
        max={100}
        title="Opacity %"
        value={Math.round(alpha * 100)}
        onChange={(e) => onChange(withAlpha(hex, Math.max(0, Math.min(100, Number(e.target.value))) / 100), true)}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function IconButton({ icon, title, onClick, active, disabled, size = 16, className, children }: { icon: string; title: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; disabled?: boolean; size?: number; className?: string; children?: ReactNode }) {
  return (
    <button type="button" className={`icon-btn ${active ? 'active' : ''} ${className ?? ''}`} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={size} />
      {children}
    </button>
  );
}

export function Menu({ trigger, children, align = 'left' }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <div onClick={() => setOpen(!open)}>{trigger(open)}</div>
      {open ? <div className={`menu ${align}`}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

export function MenuItem({ icon, label, shortcut, onClick, disabled, danger }: { icon?: string; label: ReactNode; shortcut?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick}>
      {icon ? <Icon name={icon} size={14} /> : <span className="menu-icon-spacer" />}
      <span className="menu-label">{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl+';
