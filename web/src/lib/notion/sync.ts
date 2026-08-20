import { createHash } from 'node:crypto';
import { Client, isFullPage } from '@notionhq/client';
import { createAdminClient } from '@/lib/supabase/admin';

/** Title of the database this app creates and maintains. */
export const NOTION_DATABASE_TITLE = 'School — Assignments & Tests';

export type NotionSyncResult = {
  created: number;
  updated: number;
  skipped: number;
  archived: number;
  errors: string[];
};

export function createNotionClient(token: string): Client {
  return new Client({ auth: token });
}

/** Verifies a token and reports which workspace it belongs to. */
export async function verifyNotionToken(token: string): Promise<{ name: string; id: string }> {
  const notion = createNotionClient(token);
  const me = await notion.users.me({});

  return {
    id: me.id,
    name:
      me.type === 'bot'
        ? (me.bot?.workspace_name ?? me.name ?? 'Notion workspace')
        : (me.name ?? 'Notion workspace'),
  };
}

/**
 * Pages the integration can see, for choosing where to put the database.
 *
 * Notion only exposes what the user has explicitly shared with the
 * integration, so an empty list means they haven't shared anything yet — which
 * is the most common setup mistake.
 */
export async function listAccessiblePages(
  token: string,
): Promise<Array<{ id: string; title: string }>> {
  const notion = createNotionClient(token);
  const response = await notion.search({
    filter: { property: 'object', value: 'page' },
    page_size: 50,
  });

  const pages: Array<{ id: string; title: string }> = [];

  for (const result of response.results) {
    if (!isFullPage(result)) continue;

    // A page's title lives in whichever property has type 'title'.
    const titleProp = Object.values(result.properties).find((p) => p.type === 'title');
    const title =
      titleProp?.type === 'title'
        ? titleProp.title.map((t) => t.plain_text).join('') || 'Untitled'
        : 'Untitled';

    pages.push({ id: result.id, title });
  }

  return pages;
}

/**
 * Derived from the SDK rather than a named export, so the shape follows the
 * installed client version instead of a guess at its type names.
 */
type DataSourceProperties = NonNullable<
  NonNullable<Parameters<Client['databases']['create']>[0]['initial_data_source']>['properties']
>;

const DATABASE_PROPERTIES: DataSourceProperties = {
  Name: { title: {} },
  Due: { date: {} },
  Course: { rich_text: {} },
  Type: {
    select: {
      options: [
        { name: 'assignment', color: 'blue' },
        { name: 'quiz', color: 'yellow' },
        { name: 'exam', color: 'red' },
        { name: 'project', color: 'purple' },
        { name: 'reading', color: 'green' },
        { name: 'lab', color: 'orange' },
        { name: 'discussion', color: 'pink' },
        { name: 'other', color: 'gray' },
      ],
    },
  },
  Status: {
    select: {
      options: [
        { name: 'todo', color: 'default' },
        { name: 'in_progress', color: 'yellow' },
        { name: 'submitted', color: 'blue' },
        { name: 'graded', color: 'green' },
        { name: 'dropped', color: 'gray' },
      ],
    },
  },
  Points: { number: {} },
  Link: { url: {} },
};

/**
 * Returns the app's Notion database and its data source, creating them under
 * the chosen parent page if needed. Both ids are cached in integration config.
 *
 * Notion's 2025-09-03 API splits a database from the data source inside it:
 * properties are defined on the data source, and pages are created against it
 * rather than against the database.
 */
export async function ensureNotionDatabase(
  userId: string,
  integrationId: string,
): Promise<{ databaseId: string; dataSourceId: string }> {
  const db = createAdminClient();

  const { data: integration } = await db
    .from('integrations')
    .select('id, config')
    .eq('id', integrationId)
    .maybeSingle();

  if (!integration) throw new Error('Notion is not connected');

  const config = (integration.config ?? {}) as {
    database_id?: string;
    data_source_id?: string;
    parent_page_id?: string;
  };

  const { data: secret } = await db
    .from('integration_secrets')
    .select('access_token')
    .eq('integration_id', integrationId)
    .maybeSingle();

  const token = secret?.access_token;
  if (!token) throw new Error('Notion token is missing; reconnect the integration');

  const notion = createNotionClient(token);

  if (config.database_id) {
    try {
      const existing = await notion.databases.retrieve({ database_id: config.database_id });
      const dataSourceId =
        config.data_source_id ??
        ('data_sources' in existing ? existing.data_sources?.[0]?.id : undefined);

      if (dataSourceId) {
        // Backfill the data source id for databases created before it was tracked.
        if (!config.data_source_id) {
          await db
            .from('integrations')
            .update({ config: { ...config, data_source_id: dataSourceId } })
            .eq('id', integrationId);
        }
        return { databaseId: config.database_id, dataSourceId };
      }
    } catch {
      // Deleted or unshared; fall through and recreate.
    }
  }

  if (!config.parent_page_id) {
    throw new Error('Choose a Notion page to hold the database first');
  }

  const created = await notion.databases.create({
    parent: { type: 'page_id', page_id: config.parent_page_id },
    title: [{ type: 'text', text: { content: NOTION_DATABASE_TITLE } }],
    initial_data_source: { properties: DATABASE_PROPERTIES },
  });

  const dataSourceId =
    'data_sources' in created ? created.data_sources?.[0]?.id : undefined;
  if (!dataSourceId) throw new Error('Notion created the database without a data source');

  await db
    .from('integrations')
    .update({
      config: { ...config, database_id: created.id, data_source_id: dataSourceId },
    })
    .eq('id', integrationId);

  return { databaseId: created.id, dataSourceId };
}

type SyncableAssignment = {
  id: string;
  title: string;
  kind: string;
  status: string;
  due_at: string | null;
  due_is_all_day: boolean;
  points: number | null;
  url: string | null;
  archived_at: string | null;
  courses: { code: string | null; title: string } | null;
};

function pageProperties(a: SyncableAssignment) {
  const courseLabel = a.courses?.code ?? a.courses?.title ?? '';

  return {
    Name: { title: [{ type: 'text' as const, text: { content: a.title.slice(0, 2000) } }] },
    Due: a.due_at
      ? {
          date: {
            // A date-only value tells Notion not to imply a time that the
            // source never specified.
            start: a.due_is_all_day ? a.due_at.slice(0, 10) : a.due_at,
          },
        }
      : { date: null },
    Course: {
      rich_text: courseLabel
        ? [{ type: 'text' as const, text: { content: courseLabel.slice(0, 2000) } }]
        : [],
    },
    Type: { select: { name: a.kind } },
    Status: { select: { name: a.status } },
    Points: { number: a.points ?? null },
    Link: { url: a.url || null },
  };
}

/**
 * Pushes assignments into the Notion database.
 *
 * One page per assignment, tracked in notion_page_links, so repeated syncs
 * update rather than duplicate. Finished or archived work has its page
 * archived in Notion, which is Notion's equivalent of deleting.
 */
export async function syncAssignmentsToNotion(
  userId: string,
  options: { pastDays?: number; futureDays?: number } = {},
): Promise<NotionSyncResult> {
  const { pastDays = 30, futureDays = 180 } = options;
  const db = createAdminClient();
  const result: NotionSyncResult = { created: 0, updated: 0, skipped: 0, archived: 0, errors: [] };

  const { data: integration } = await db
    .from('integrations')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'notion')
    .neq('status', 'disconnected')
    .maybeSingle();

  if (!integration) throw new Error('Notion is not connected');

  const { data: secret } = await db
    .from('integration_secrets')
    .select('access_token')
    .eq('integration_id', integration.id)
    .maybeSingle();

  const token = secret?.access_token;
  if (!token) throw new Error('Notion token is missing; reconnect the integration');

  const { databaseId, dataSourceId } = await ensureNotionDatabase(userId, integration.id);
  const notion = createNotionClient(token);

  const { data: run } = await db
    .from('sync_runs')
    .insert({ user_id: userId, provider: 'notion', direction: 'push' })
    .select('id')
    .single();

  try {
    const windowStart = new Date(Date.now() - pastDays * 86_400_000).toISOString();
    const windowEnd = new Date(Date.now() + futureDays * 86_400_000).toISOString();

    const { data: assignments, error } = await db
      .from('assignments')
      .select(
        'id, title, kind, status, due_at, due_is_all_day, points, url, archived_at,' +
          ' courses(code, title)',
      )
      .eq('user_id', userId)
      .or(`due_at.is.null,and(due_at.gte.${windowStart},due_at.lte.${windowEnd})`);

    if (error) throw new Error(`loading assignments: ${error.message}`);

    const { data: links } = await db
      .from('notion_page_links')
      .select('assignment_id, page_id, content_hash')
      .eq('user_id', userId)
      .eq('integration_id', integration.id);

    const linkByAssignment = new Map((links ?? []).map((l) => [l.assignment_id, l]));

    for (const a of (assignments ?? []) as unknown as SyncableAssignment[]) {
      const link = linkByAssignment.get(a.id);
      const properties = pageProperties(a);
      const hash = createHash('sha256')
        .update(JSON.stringify(properties))
        .digest('hex')
        .slice(0, 32);

      const finished = a.archived_at !== null || a.status === 'dropped';

      if (finished) {
        if (link) {
          try {
            await notion.pages.update({ page_id: link.page_id, archived: true });
          } catch {
            // Already gone on Notion's side.
          }
          await db
            .from('notion_page_links')
            .delete()
            .eq('assignment_id', a.id)
            .eq('integration_id', integration.id);
          result.archived += 1;
        }
        continue;
      }

      if (link?.content_hash === hash) {
        result.skipped += 1;
        continue;
      }

      try {
        if (link) {
          await notion.pages.update({ page_id: link.page_id, properties });
          await db
            .from('notion_page_links')
            .update({ content_hash: hash, synced_at: new Date().toISOString() })
            .eq('assignment_id', a.id)
            .eq('integration_id', integration.id);
          result.updated += 1;
        } else {
          const page = await notion.pages.create({
            // Pages belong to a data source, not the database, in the current API.
            parent: { type: 'data_source_id', data_source_id: dataSourceId },
            properties,
          });

          await db.from('notion_page_links').insert({
            user_id: userId,
            assignment_id: a.id,
            integration_id: integration.id,
            database_id: databaseId,
            page_id: page.id,
            content_hash: hash,
          });

          result.created += 1;
        }
      } catch (err) {
        result.errors.push(`${a.title}: ${(err as Error).message}`);
      }
    }

    await db
      .from('integrations')
      .update({
        last_synced_at: new Date().toISOString(),
        status: 'connected',
        last_error: result.errors.length ? result.errors.slice(0, 3).join('; ') : null,
      })
      .eq('id', integration.id);

    if (run) {
      await db
        .from('sync_runs')
        .update({
          status: result.errors.length ? 'error' : 'success',
          finished_at: new Date().toISOString(),
          items_created: result.created,
          items_updated: result.updated,
          items_skipped: result.skipped,
          error: result.errors.length ? result.errors.join('; ').slice(0, 2000) : null,
        })
        .eq('id', run.id);
    }

    return result;
  } catch (err) {
    const message = (err as Error).message;

    await db
      .from('integrations')
      .update({ status: 'error', last_error: message })
      .eq('id', integration.id);

    if (run) {
      await db
        .from('sync_runs')
        .update({ status: 'error', finished_at: new Date().toISOString(), error: message })
        .eq('id', run.id);
    }

    throw err;
  }
}
