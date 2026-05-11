import { useId, type ChangeEvent } from "react";

interface Props {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Format the value for display next to the slider. Default: `Math.round(v * 100) + "%"`. */
  format?: (value: number) => string;
  disabled?: boolean;
}

const DEFAULT_FORMAT = (value: number) => `${Math.round(value * 100)}%`;

export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = DEFAULT_FORMAT,
  disabled,
}: Props) {
  const id = useId();
  const hintId = useId();
  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const percent = ratio * 100;
  const fill = `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${percent}%, var(--color-line) ${percent}%, var(--color-line) 100%)`;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(Number(event.target.value));
  }

  return (
    <div className="block">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-footnote font-medium text-ink">
          {label}
        </label>
        <span className="text-caption1 font-medium tabular-nums text-ink-soft">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className="slider w-full"
        style={{ background: fill }}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-caption1 leading-snug text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
