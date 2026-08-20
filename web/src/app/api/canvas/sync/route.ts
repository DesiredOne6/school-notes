import { NextResponse } from 'next/server';
import { syncCanvasForUser } from '@/lib/canvas/sync';
import { requireUser, errorResponse } from '@/lib/api/guards';

export const maxDuration = 60;

/** Manual "sync now" from the UI. */
export async function POST() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    return NextResponse.json(await syncCanvasForUser(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
