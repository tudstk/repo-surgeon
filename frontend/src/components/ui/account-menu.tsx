'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { SafeProfile } from '@/lib/auth-api';
import { Avatar } from './avatar';
import { Icon } from './icons';

export function AccountMenu({
  user,
  active,
}: {
  user: SafeProfile;
  active?: 'workspace' | 'profile' | 'settings';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const id = useId();
  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const links = Array.from(
      menu.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? [],
    );
    links.at(initialFocus.current === 'last' ? -1 : 0)?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return (
    <div className="account-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-label={`Account menu for @${user.github_login}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-describedby={open ? undefined : `${id}-tooltip`}
        onClick={() => {
          initialFocus.current = 'first';
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
            if (open)
              items()
                .at(initialFocus.current === 'last' ? -1 : 0)
                ?.focus();
            else setOpen(true);
          } else if (event.key === 'Escape' && open) close();
        }}
      >
        <Avatar user={user} className="account-avatar" />
      </button>
      {!open ? (
        <span role="tooltip" id={`${id}-tooltip`} className="account-tooltip">
          @{user.github_login}
        </span>
      ) : null}
      {open ? (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label="Account"
          className="account-dropdown"
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          onKeyDown={(event) => {
            const links = items();
            const index = links.indexOf(document.activeElement as HTMLAnchorElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? links.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
              links[next]?.focus();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === 'Tab') close();
          }}
        >
          <Link
            role="menuitem"
            tabIndex={-1}
            href="/profile"
            aria-current={active === 'profile' ? 'page' : undefined}
            onClick={close}
          >
            <Icon name="user" />
            Profile
          </Link>
          <Link
            role="menuitem"
            tabIndex={-1}
            href="/settings"
            aria-current={active === 'settings' ? 'page' : undefined}
            onClick={close}
          >
            <Icon name="settings" />
            Settings
          </Link>
        </div>
      ) : null}
    </div>
  );
}
