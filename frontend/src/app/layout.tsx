import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Repo Surgeon',
  description: 'A local-first, human-controlled coding agent.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
