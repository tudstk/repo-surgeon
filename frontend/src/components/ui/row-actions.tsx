'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icons';

export function RowActions({
  name,
  disabled,
  onRemove,
  onRename,
}: {
  name: string;
  disabled: boolean;
  onRemove: () => void;
  onRename?: () => void;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const focusLast = useRef(false);
  const close = () => {
    setPosition(null);
    trigger.current?.focus();
  };
  const open = (last = false) => {
    focusLast.current = last;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(8, Math.min(rect.right - 144, window.innerWidth - 152)),
      top:
        rect.bottom + (onRename ? 108 : 64) > window.innerHeight
          ? rect.top - (onRename ? 104 : 60)
          : rect.bottom + 4,
    });
  };

  useEffect(() => {
    if (!position) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[focusLast.current ? items.length - 1 : 0]?.focus();
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
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-controls={position ? id : undefined}
        disabled={disabled}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open(event.key === 'ArrowUp');
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
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
              );
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === 'Tab') close();
          }}
        >
          {onRename ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => {
                close();
                onRename();
              }}
            >
              <Icon name="edit" />
              Rename
            </button>
          ) : null}
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
