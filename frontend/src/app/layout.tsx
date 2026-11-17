import type { Metadata } from 'next';
import { appearanceScript } from '@/lib/appearance';

import './globals.css';

export const metadata: Metadata = {
  title: 'Repo Surgeon',
  description: 'Read-only repository inspections with saved sessions.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
        {children}
      </body>
    </html>
  );
}
