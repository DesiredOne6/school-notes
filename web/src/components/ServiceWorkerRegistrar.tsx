'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker on load.
 *
 * It used to be registered only when enabling notifications, which meant the
 * app was not installable and had no offline fallback until the user happened
 * to turn reminders on.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Registering after load avoids competing with the first paint for
    // bandwidth on a slow connection.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration fails on unsupported browsers and in private windows.
        // Nothing here is essential to using the app.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
