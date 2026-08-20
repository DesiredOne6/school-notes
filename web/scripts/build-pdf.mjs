/**
 * Renders ARCHITECTURE.md to a printable PDF.
 *
 * Generated from the markdown rather than hand-maintained, so the PDF cannot
 * drift from the document people actually edit.
 *
 *   node scripts/build-pdf.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

// web/scripts/ -> repo root is two levels up.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(root, 'ARCHITECTURE.md');
const outDir = join(root, 'docs');
const htmlPath = join(outDir, 'architecture.html');
const pdfPath = join(outDir, 'School-Notes-Architecture.pdf');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(CHROME)) {
  console.error('Google Chrome not found; it is used to render the PDF.');
  process.exit(1);
}

const markdown = readFileSync(source, 'utf8');

// Repo-relative links are useless in a PDF — nothing resolves them — so they
// become plain text, keeping the path visible as a pointer to the file.
const renderer = new marked.Renderer();
renderer.link = ({ href, text }) => {
  if (/^https?:/.test(href)) {
    return `<a href="${href}">${text}</a>`;
  }
  return `<code class="path">${href}</code>`;
};

const body = marked.parse(markdown, { renderer, mangle: false, headerIds: true });

// Light palette and serif body text: this is meant to be printed or read as a
// document, where the app's dark theme would waste ink and tire the eye.
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>School Notes — Working on this yourself</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }

  :root {
    --ink: #16171d;
    --muted: #5c6070;
    --rule: #d8dae2;
    --accent: #4f46e5;
    --code-bg: #f4f5f8;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Georgia, serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: var(--ink);
  }

  h1 {
    font-size: 22pt;
    line-height: 1.2;
    margin: 0 0 4pt;
    letter-spacing: -0.01em;
  }

  h2 {
    font-size: 14pt;
    margin: 22pt 0 8pt;
    padding-bottom: 4pt;
    border-bottom: 1px solid var(--rule);
    /* Never leave a heading stranded at the foot of a page. */
    break-after: avoid;
    break-inside: avoid;
  }

  h3 {
    font-size: 11.5pt;
    margin: 14pt 0 4pt;
    break-after: avoid;
  }

  p, ul, ol { margin: 0 0 9pt; }
  li { margin-bottom: 3pt; }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 9pt;
    background: var(--code-bg);
    padding: 1pt 3pt;
    border-radius: 3px;
  }

  code.path { color: var(--accent); background: none; padding: 0; }

  pre {
    background: var(--code-bg);
    border: 1px solid var(--rule);
    border-radius: 5px;
    padding: 8pt 10pt;
    overflow-x: auto;
    break-inside: avoid;
  }

  pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.45; }

  blockquote {
    margin: 0 0 9pt;
    padding-left: 10pt;
    border-left: 2px solid var(--accent);
    color: var(--muted);
  }

  hr { border: 0; border-top: 1px solid var(--rule); margin: 18pt 0; }

  strong { font-weight: 650; }

  a { color: var(--accent); text-decoration: none; }

  table { border-collapse: collapse; width: 100%; margin-bottom: 9pt; font-size: 9.5pt; }
  th, td { border: 1px solid var(--rule); padding: 4pt 6pt; text-align: left; }
  th { background: var(--code-bg); }

  .cover {
    border-bottom: 2px solid var(--ink);
    padding-bottom: 10pt;
    margin-bottom: 18pt;
  }

  .cover .sub { color: var(--muted); font-size: 10pt; margin: 4pt 0 0; }
  .cover .meta { color: var(--muted); font-size: 8.5pt; margin-top: 8pt; }

  /* The document opens with its own H1; the cover supplies the title instead. */
  body > h1:first-of-type { display: none; }
</style>
</head>
<body>
  <header class="cover">
    <h1 style="display:block">School Notes</h1>
    <p class="sub">Working on this yourself — a guide to the codebase</p>
    <p class="meta">Next.js · Supabase · TypeScript &nbsp;·&nbsp; ~14,000 lines across 96 files</p>
  </header>
  ${body}
</body>
</html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(htmlPath, html);

execFileSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ],
  { stdio: 'ignore' },
);

// The HTML is an intermediate artefact; the PDF is the deliverable.
unlinkSync(htmlPath);

const { size } = await import('node:fs').then((fs) => fs.statSync(pdfPath));
console.log(`✓ ${pdfPath} (${Math.round(size / 1024)} KB)`);
