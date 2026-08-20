/**
 * Obsidian-style [[wiki links]].
 *
 * Supported forms:
 *   [[Note title]]           -> link, labelled with the title
 *   [[Note title|shown]]     -> link, labelled "shown"
 *
 * Links are resolved against note titles rather than ids, so a link can be
 * written before its target exists. Unresolved links render distinctly and
 * offer to create the missing note.
 */

export type WikiLink = {
  /** The note title being referenced, trimmed. */
  target: string;
  /** What to display; the target unless an alias was given. */
  label: string;
  /** The full original match, e.g. "[[Lecture 3|notes]]". */
  raw: string;
};

// Non-greedy so two links on one line don't merge into one match.
const WIKI_LINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export function extractWikiLinks(body: string): WikiLink[] {
  const links: WikiLink[] = [];

  for (const match of body.matchAll(WIKI_LINK)) {
    const target = match[1].trim();
    if (!target) continue;

    links.push({
      target,
      label: (match[2] ?? match[1]).trim(),
      raw: match[0],
    });
  }

  return links;
}

/** Distinct targets, case-insensitively, preserving first-seen spelling. */
export function uniqueTargets(body: string): string[] {
  const seen = new Map<string, string>();

  for (const link of extractWikiLinks(body)) {
    const key = normalizeTitle(link.target);
    if (!seen.has(key)) seen.set(key, link.target);
  }

  return [...seen.values()];
}

/**
 * Matching key for titles. Case- and whitespace-insensitive so "Lecture 3" and
 * "lecture  3" refer to the same note.
 */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Rewrites wiki links into markdown links so the standard renderer handles
 * them. Unresolved targets become a "new note" link instead, which is what
 * makes writing a link before its note exists useful rather than broken.
 */
export function wikiLinksToMarkdown(
  body: string,
  resolve: (target: string) => string | null,
): string {
  return body.replace(WIKI_LINK, (raw, rawTarget: string, rawAlias?: string) => {
    const target = rawTarget.trim();
    if (!target) return raw;

    // The pattern excludes ']' from both target and alias, so a label can never
    // contain the character that would terminate the markdown link early.
    const label = (rawAlias ?? rawTarget).trim();
    const id = resolve(target);

    return id
      ? `[${label}](/notes/${id})`
      : `[${label}](/notes/new?title=${encodeURIComponent(target)} "Note not created yet")`;
  });
}

/**
 * Strips markdown down to readable text for list previews. Deliberately rough:
 * it only needs to be legible, not a faithful renderer.
 */
export function toPlainPreview(body: string, maxLength = 160): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, t, a) => (a ?? t))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
