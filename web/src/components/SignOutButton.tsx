'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
      }}
      className="text-sm text-[var(--color-muted)] hover:text-white disabled:opacity-50"
    >
      {busy ? '…' : 'Sign out'}
    </button>
  );
}
