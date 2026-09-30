/** Shared document shell; typography is local/system-only with no runtime font requests. */
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sales bot · WareOnGo',
  description: 'WhatsApp sales bot administration',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
