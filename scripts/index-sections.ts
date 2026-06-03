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

export function listPending(body: string): string[] {
  return bulletPaths(getSection(body, "Raw Sources (pending)"));
}

export function addPending(body: string, relPath: string, date: string): string {
  const current = listPending(body);
  const lines = [...current, relPath].map(
    (p) => `- ${p} — added ${date}, not yet compiled`
  );
  return replaceSection(body, "Raw Sources (pending)", lines.join("\n"));
}

export function moveToCompiled(body: string, paths: string[], date: string): string {
  const remaining = listPending(body).filter((p) => !paths.includes(p));
  const pendingContent = remaining.length
    ? remaining.map((p) => `- ${p} — added ${date}, not yet compiled`).join("\n")
    : NONE;

  const compiledExisting = bulletPaths(getSection(body, "Raw Sources (compiled)"));
  const compiledAll = [...compiledExisting, ...paths];
  const compiledContent = compiledAll.length
    ? compiledAll.map((p) => `- ${p} — compiled ${date}`).join("\n")
    : NONE;

  let out = replaceSection(body, "Raw Sources (pending)", pendingContent);
  out = replaceSection(out, "Raw Sources (compiled)", compiledContent);
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
