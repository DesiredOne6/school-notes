import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'School Notes',
  description: 'Notes, assignments, and course info in one place.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#0d0d12',
  width: 'device-width',
  initialScale: 1,
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/courses', label: 'Courses' },
  { href: '/settings', label: 'Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning covers attributes injected into <html> by
    // browser extensions (Dark Reader, Grammarly, password managers) before
    // React hydrates. It only applies to this element's own attributes, not to
    // the tree beneath it, so real hydration bugs in the app still surface.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-6">
          <header className="mb-8 flex items-center justify-between border-b border-[var(--color-border)] pb-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              School<span className="text-[var(--color-accent)]">Notes</span>
            </Link>
            <nav className="flex gap-5 text-sm text-[var(--color-muted)]">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-white">
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
