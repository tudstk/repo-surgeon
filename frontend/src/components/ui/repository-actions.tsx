'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icons';

export function RepositoryActions({
  name,
  disabled,
  onRemove,
}: {
  name: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => {
    setPosition(null);
    trigger.current?.focus();
  };
  const open = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(8, Math.min(rect.right - 144, window.innerWidth - 152)),
      top: rect.bottom + 64 > window.innerHeight ? rect.top - 60 : rect.bottom + 4,
    });
  };

  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setPosition(null);
    };
    const dismiss = () => setPosition(null);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [position]);

  return (
    <div
      ref={root}
      className="repository-actions"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPosition(null);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="icon-button repository-actions-trigger"
        aria-label={`Actions for ${name}`}
        title="Repository actions"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-controls={position ? id : undefined}
        disabled={disabled}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
          }
        }}
      >
        <Icon name="more" />
      </button>
      {position ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={`Actions for ${name}`}
          className="repository-actions-menu"
          style={position}
          onKeyDown={(event) => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === 'Tab') close();
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => {
              close();
              onRemove();
            }}
          >
            <Icon name="close" />
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}
