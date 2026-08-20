/**
 * Minimal Canvas LMS API client.
 *
 * Canvas paginates everything via RFC 5988 Link headers and throttles with a
 * cost-based bucket, so both are handled here rather than at each call site.
 */

export type CanvasCourse = {
  id: number;
  name: string;
  course_code: string | null;
  enrollment_term_id: number | null;
  term?: { id: number; name: string; start_at: string | null; end_at: string | null };
  teachers?: Array<{ id: number; display_name: string }>;
  concluded?: boolean;
  access_restricted_by_date?: boolean;
};

export type CanvasAssignment = {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  unlock_at: string | null;
  lock_at: string | null;
  points_possible: number | null;
  html_url: string | null;
  submission_types: string[];
  quiz_id?: number | null;
  is_quiz_assignment?: boolean;
  published?: boolean;
  submission?: {
    submitted_at: string | null;
    score: number | null;
    workflow_state: string;
  };
};

export type CanvasQuiz = {
  id: number;
  title: string;
  description: string | null;
  due_at: string | null;
  unlock_at: string | null;
  lock_at: string | null;
  points_possible: number | null;
  html_url: string | null;
  quiz_type: string;
  assignment_id: number | null;
  published?: boolean;
};

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'CanvasError';
  }
}

export class CanvasClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    // Accept "school.instructure.com" or a full URL with or without a slash.
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    this.baseUrl = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  private async request(path: string, attempt = 0): Promise<Response> {
    const url = path.startsWith('http')
      ? path
      : `${this.baseUrl}/api/v1${path.startsWith('/') ? path : `/${path}`}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
      // These calls run server-side in sync jobs; never cache them.
      cache: 'no-store',
    });

    // 403 with a throttle body means the API cost bucket is drained, not that
    // we lack permission. Back off and retry a few times.
    if ((res.status === 403 || res.status === 429) && attempt < 4) {
      const body = await res.clone().text();
      if (res.status === 429 || body.includes('throttle')) {
        const waitMs = 2 ** attempt * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        return this.request(path, attempt + 1);
      }
    }

    if (!res.ok) {
      throw new CanvasError(
        `Canvas ${res.status} on ${path}`,
        res.status,
        await res.text().catch(() => undefined),
      );
    }

    return res;
  }

  /** Follows Link-header pagination until exhausted. */
  private async getAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    let pages = 0;

    while (next && pages < 50) {
      const res = await this.request(next);
      out.push(...((await res.json()) as T[]));
      next = parseNextLink(res.headers.get('link'));
      pages += 1;
    }

    return out;
  }

  /** Verifies the token and returns the account it belongs to. */
  async whoami(): Promise<{ id: number; name: string; primary_email?: string }> {
    const res = await this.request('/users/self/profile');
    return res.json();
  }

  async activeCourses(): Promise<CanvasCourse[]> {
    const courses = await this.getAll<CanvasCourse>(
      '/courses?enrollment_state=active&per_page=100' +
        '&include[]=term&include[]=teachers&state[]=available',
    );
    // Courses restricted by date return a stub with no name; skip them.
    return courses.filter((c) => !c.access_restricted_by_date && Boolean(c.name));
  }

  async courseAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.getAll<CanvasAssignment>(
      `/courses/${courseId}/assignments?per_page=100&include[]=submission`,
    );
  }

  async courseQuizzes(courseId: number): Promise<CanvasQuiz[]> {
    try {
      return await this.getAll<CanvasQuiz>(`/courses/${courseId}/quizzes?per_page=100`);
    } catch (err) {
      // Quizzes are commonly disabled per-course; that isn't a sync failure.
      if (err instanceof CanvasError && (err.status === 403 || err.status === 404)) {
        return [];
      }
      throw err;
    }
  }
}

/** Extracts the rel="next" URL from a Canvas Link header. */
export function parseNextLink(header: string | null): string | null {
  if (!header) return null;

  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) return match[1];
  }

  return null;
}
