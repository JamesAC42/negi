import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { createPortal } from "react-dom";

function themedPortalRoot(source?: Element | null): Element {
  return source?.closest(".appShell") ?? document.querySelector(".appShell") ?? document.body;
}

type StyledSelectOption<T extends string> = { value: T; label: string };

function SelectChevronIcon(): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 16 16">
      <path d="m4.5 6.5 3.5 3 3.5-3" />
    </svg>
  );
}

export function StyledSelect<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  options,
  title,
  value,
  onChange
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: Array<StyledSelectOption<T>>;
  title?: string;
  value: T;
  onChange(value: T): void;
}): ReactElement {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }
    const syncMenuPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setMenuStyle({
        left: rect.left,
        width: rect.width,
        maxWidth: Math.max(0, window.innerWidth - rect.left - 16),
        top: rect.bottom + 4,
        maxHeight: Math.max(120, window.innerHeight - rect.bottom - 16)
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    syncMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", syncMenuPosition);
    window.addEventListener("scroll", syncMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", syncMenuPosition);
      window.removeEventListener("scroll", syncMenuPosition, true);
    };
  }, [open]);

  return (
    <div className={className ? `styledSelect ${className}` : "styledSelect"} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        className="styledSelectButton"
        disabled={disabled}
        title={title}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedOption?.label ?? ""}</span>
        <SelectChevronIcon />
      </button>
      {open
        ? createPortal(
        <div className="styledSelectMenu" id={id} ref={menuRef} role="listbox" aria-label={ariaLabel} style={menuStyle}>
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? "styledSelectOption active" : "styledSelectOption"}
              key={option.value}
              role="option"
              title={option.label}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        themedPortalRoot(rootRef.current)
          )
        : null}
    </div>
  );
}
