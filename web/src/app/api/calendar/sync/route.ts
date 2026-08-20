import { NextResponse } from 'next/server';
import { syncAssignmentsToGoogle } from '@/lib/google/calendar';
import { requireUser, errorResponse } from '@/lib/api/guards';

export const maxDuration = 60;

export async function POST() {
  const { user, response } = await requireUser();
  if (!user) return response;

  try {
    return NextResponse.json(await syncAssignmentsToGoogle(user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
