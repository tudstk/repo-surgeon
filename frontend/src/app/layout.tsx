import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Repo Surgeon',
  description: 'Read-only repository inspections with saved sessions.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
