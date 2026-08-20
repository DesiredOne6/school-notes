export const metadata = { title: 'Offline — School Notes' };

/**
 * Shown when a navigation fails with no network. Deliberately static: it is
 * precached by the service worker, so it must not depend on any request-time
 * data.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto mt-24 max-w-sm text-center">
      <p className="text-4xl" aria-hidden>
        📡
      </p>
      <h1 className="mt-4 text-xl font-semibold">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        School Notes needs a connection to load your assignments and notes. Anything you were
        typing is still on this device — reconnect and it will save.
      </p>
      <p className="mt-4 text-xs text-[var(--color-muted)]">
        Reminders already scheduled will still arrive.
      </p>
    </div>
  );
}
