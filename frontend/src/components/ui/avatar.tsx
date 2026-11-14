'use client';

import { useState } from 'react';

export function Avatar({
  name,
  url,
  className,
}: {
  name: string;
  url: string | null;
  className: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && url !== failedUrl) {
    // Render the safe GitHub avatar directly, without an image proxy.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        referrerPolicy="no-referrer"
        className={className}
        src={url}
        alt=""
        onError={() => setFailedUrl(url)}
      />
    );
  }
  return (
    <span className={`${className} avatar-fallback`} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
