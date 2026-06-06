export interface ArticleEntry {
  slug: string;
  summary: string;
}

const NONE = "_None._";

// Returns the text between `## <heading>` and the next `## ` (or end of body).
export function getSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").replace(/^\n+|\n+$/g, "");
}

export function replaceSection(body: string, heading: string, newContent: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  const block = ["", newContent.trim(), ""];
  return [...before, ...block, ...after].join("\n").replace(/\n{3,}/g, "\n\n");
}

function bulletPaths(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.match(/^- (\S+)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1])
    .filter((p) => p !== NONE);
}

// Returns the full "- ..." bullet lines of a section (excluding the _None._ placeholder).
function bulletLines(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
}

// Extract the path token from a bullet line: "- raw/notes/a.md — added ..." -> "raw/notes/a.md"
function bulletLinePath(line: string): string {
  const m = line.match(/^- (\S+)/);
  return m ? m[1] : "";
}

export function listPending(body: string): string[] {
  return bulletPaths(getSection(body, "Raw Sources (pending)"));
}

export function addPending(body: string, relPath: string, date: string): string {
  const existing = bulletLines(getSection(body, "Raw Sources (pending)"));
  const lines = [...existing, `- ${relPath} — added ${date}, not yet compiled`];
  return replaceSection(body, "Raw Sources (pending)", lines.join("\n"));
}

export function moveToCompiled(body: string, paths: string[], date: string): string {
  const pendingLines = bulletLines(getSection(body, "Raw Sources (pending)"));
  const remaining = pendingLines.filter((l) => !paths.includes(bulletLinePath(l)));
  const pendingContent = remaining.length ? remaining.join("\n") : NONE;

  const compiledExisting = bulletLines(getSection(body, "Raw Sources (compiled)"));
  const newlyCompiled = paths.map((p) => `- ${p} — compiled ${date}`);
  const compiledAll = [...compiledExisting, ...newlyCompiled];
  const compiledContent = compiledAll.length ? compiledAll.join("\n") : NONE;

  let out = replaceSection(body, "Raw Sources (pending)", pendingContent);
  out = replaceSection(out, "Raw Sources (compiled)", compiledContent);
  return out;
}

export function moveToArchived(body: string, paths: string[], date: string): string {
  const pendingLines = bulletLines(getSection(body, "Raw Sources (pending)"));
  const remaining = pendingLines.filter((l) => !paths.includes(bulletLinePath(l)));
  const pendingContent = remaining.length ? remaining.join("\n") : NONE;

  const archivedExisting = bulletLines(getSection(body, "Raw Sources (archived)"));
  const newlyArchived = paths.map((p) => `- ${p} — archived ${date}, no durable content`);
  const archivedAll = [...archivedExisting, ...newlyArchived];
  const archivedContent = archivedAll.length ? archivedAll.join("\n") : NONE;

  let out = replaceSection(body, "Raw Sources (pending)", pendingContent);
  out = replaceSection(out, "Raw Sources (archived)", archivedContent);
  return out;
}

export function listArticles(body: string): ArticleEntry[] {
  return getSection(body, "Articles")
    .split("\n")
    .map((l) => l.match(/^- \[\[([^\]]+)\]\] — (.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ slug: m[1], summary: m[2].trim() }));
}

export function upsertArticleEntries(
  existing: ArticleEntry[],
  ops: ArticleEntry[]
): ArticleEntry[] {
  const merged = existing.map((e) => ({ ...e }));
  for (const op of ops) {
    const i = merged.findIndex((e) => e.slug === op.slug);
    if (i >= 0) merged[i] = op;
    else merged.push(op);
  }
  return merged;
}

export function setArticles(body: string, entries: ArticleEntry[]): string {
  const content = entries.length
    ? entries.map((e) => `- [[${e.slug}]] — ${e.summary}`).join("\n")
    : "_No articles yet._";
  return replaceSection(body, "Articles", content);
}
