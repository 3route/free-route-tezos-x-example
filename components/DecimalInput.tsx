'use client';
import { useEffect, useRef, useState } from 'react';

// Locale-independent decimal input. <input type="number"> renders the decimal separator per the BROWSER locale
// (a comma in e.g. ru), which is inconsistent with the rest of the app; this always shows a dot. Keeps a string
// buffer for smooth typing, normalizes a typed comma to a dot, and commits the parsed number via onChange.
// Empty / partial input ("" or ".") commits 0.
export function DecimalInput({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [buf, setBuf] = useState(() => String(value));
  const focused = useRef(false);
  // reflect external (programmatic) value changes — e.g. "set all prices" / regenerate — when not actively editing
  useEffect(() => {
    if (!focused.current && Number(buf) !== value) setBuf(String(value));
  }, [value, buf]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={buf}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setBuf(String(value)); // normalize the display on blur (e.g. "0.010" -> "0.01")
      }}
      onChange={(e) => {
        const s = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d*$/.test(s)) return; // digits and a single dot only
        setBuf(s);
        onChange(s === '' || s === '.' ? 0 : Number(s));
      }}
    />
  );
}
