'use client';

import { useEffect, useState } from 'react';

/**
 * Converts a base64url VAPID key into the binary form the Push API expects.
 * Returns a plain ArrayBuffer: a Uint8Array over ArrayBufferLike isn't
 * assignable to BufferSource under current lib.dom types.
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);

  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);

  return buffer;
}

export function NotificationToggle() {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    // Feature detection and the subscription lookup both run inside this async
    // callback rather than the effect body, so no state is set synchronously
    // during the effect.
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setSupported(false);
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelled) setEnabled(Boolean(subscription));
      } catch {
        if (!cancelled) setSupported(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setMessage('');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was denied');

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error('VAPID public key is not configured');

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(key),
      });

      const json = subscription.toJSON();

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          deviceLabel: navigator.userAgent.slice(0, 80),
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not save subscription');

      setEnabled(true);
      setMessage('Reminders enabled on this device.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setEnabled(false);
      setMessage('Reminders turned off for this device.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        This browser doesn&apos;t support web push. On iPhone/iPad you must first add the app to
        your Home Screen.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={enabled ? disable : enable}
        disabled={busy}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {busy ? 'Working…' : enabled ? 'Turn off reminders' : 'Enable reminders'}
      </button>
      {message && <p className="text-xs text-[var(--color-muted)]">{message}</p>}
    </div>
  );
}
