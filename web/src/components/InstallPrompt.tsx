'use client';

import { useEffect, useState } from 'react';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * Install control.
 *
 * Chrome and Edge fire `beforeinstallprompt`, which lets the app trigger the
 * real install dialog. Safari fires nothing and offers no API, so iOS and macOS
 * get written instructions instead — there is no way to automate it.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'mac-safari' | 'other'>('other');

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Suppress the browser's own mini-infobar so the button is the only path.
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    let cancelled = false;

    // These read browser-only APIs, so they cannot run during render — but
    // setting state synchronously in an effect body cascades renders, so the
    // detection happens in a microtask instead.
    queueMicrotask(() => {
      if (cancelled) return;

      // display-mode: standalone is true only when already launched as an app.
      if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true);

      const ua = navigator.userAgent;
      const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
      if (/iPad|iPhone|iPod/.test(ua)) setPlatform('ios');
      else if (/Macintosh/.test(ua) && isSafari) setPlatform('mac-safari');
    });

    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <p className="text-xs text-green-400">
        Installed on this device.
      </p>
    );
  }

  if (deferred) {
    return (
      <button
        onClick={async () => {
          await deferred.prompt();
          const { outcome } = await deferred.userChoice;
          if (outcome === 'accepted') setInstalled(true);
          setDeferred(null);
        }}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
      >
        Install app
      </button>
    );
  }

  const instructions =
    platform === 'ios'
      ? ['Tap the Share button in Safari', 'Choose “Add to Home Screen”', 'Open it from your Home Screen']
      : platform === 'mac-safari'
        ? ['Open the Share menu in Safari', 'Choose “Add to Dock”', 'Launch it from the Dock']
        : [
            'Open this site in Chrome or Edge',
            'Click the install icon in the address bar, or the ⋮ menu → “Install”',
          ];

  return (
    <div className="text-xs text-[var(--color-muted)]">
      <p className="mb-1.5 font-medium text-[#e9e9f0]">Install on this device</p>
      <ol className="list-decimal space-y-1 pl-4">
        {instructions.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {platform === 'ios' && (
        <p className="mt-2">
          On iPhone this is required for reminders — Safari only allows notifications for apps
          added to the Home Screen.
        </p>
      )}
    </div>
  );
}
