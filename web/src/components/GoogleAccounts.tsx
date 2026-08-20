'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPrimaryCalendarAccount, disconnectIntegration, setCalendarVisibility } from '@/app/actions/calendars';

export type CalendarRow = {
  id: string;
  name: string;
  color: string | null;
  is_visible: boolean;
  is_app_managed: boolean;
};

export type AccountRow = {
  id: string;
  account_label: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  isPrimary: boolean;
  calendars: CalendarRow[];
};

export function GoogleAccounts({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {accounts.length === 0 && (
        <p className="text-xs text-[var(--color-muted)]">No Google account connected yet.</p>
      )}

      {accounts.map((account) => (
        <div
          key={account.id}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {account.account_label ?? 'Google account'}
                {account.isPrimary && (
                  <span className="ml-2 rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-accent)]">
                    Assignments
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {account.last_synced_at
                  ? `Last synced ${new Date(account.last_synced_at).toLocaleString()}`
                  : 'Not synced yet'}
              </p>
            </div>

            <div className="flex gap-2">
              {!account.isPrimary && (
                <button
                  disabled={pending}
                  onClick={async () => {
                    await setPrimaryCalendarAccount(account.id);
                    startTransition(() => router.refresh());
                  }}
                  className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-accent)] disabled:opacity-50"
                >
                  Write assignments here
                </button>
              )}
              <button
                disabled={pending}
                onClick={async () => {
                  await disconnectIntegration(account.id);
                  startTransition(() => router.refresh());
                }}
                className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:border-red-400 hover:text-red-400 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>

          {account.last_error && (
            <p className="mt-2 text-xs text-red-400">{account.last_error}</p>
          )}

          {account.calendars.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs text-[var(--color-muted)]">
                Show on the calendar view:
              </p>
              <ul className="space-y-1">
                {account.calendars
                  .filter((c) => !c.is_app_managed)
                  .map((cal) => (
                    <li key={cal.id} className="flex items-center gap-2">
                      <input
                        id={`cal-${cal.id}`}
                        type="checkbox"
                        checked={cal.is_visible}
                        disabled={pending}
                        onChange={async (e) => {
                          await setCalendarVisibility(cal.id, e.target.checked);
                          startTransition(() => router.refresh());
                        }}
                        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                      />
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: cal.color ?? '#64748b' }}
                      />
                      <label htmlFor={`cal-${cal.id}`} className="truncate text-xs">
                        {cal.name}
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      <a
        href="/api/google/start"
        className="inline-block rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
      >
        {accounts.length === 0 ? 'Connect Google Calendar' : '+ Add another Google account'}
      </a>
    </div>
  );
}
