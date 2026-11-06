'use client';

import { useState } from 'react';
import type { SafeProfile } from '@/lib/auth-api';

export function Avatar({ user, className }: { user: SafeProfile; className: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (user.github_avatar_url && user.github_avatar_url !== failedUrl) {
    // Render the safe GitHub profile projection directly, without an image proxy.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={className}
        src={user.github_avatar_url}
        alt=""
        onError={() => setFailedUrl(user.github_avatar_url)}
      />
    );
  }
  return (
    <span className={`${className} avatar-fallback`} aria-hidden="true">
      {(user.display_name || user.github_login).slice(0, 1).toUpperCase()}
    </span>
  );
}
