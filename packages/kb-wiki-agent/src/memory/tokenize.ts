/**
 * tokenize.ts — shared keyword tokenizer for the memory layer.
 *
 * Derive resolve/recall keywords from free-text. Split on non-word runs,
 * lowercase, drop sub-3-char stopwords. Shared by recall and capture so the
 * resolution behaviour is identical on both the read and write paths.
 */

export function tokenize(query: string): string[] {
  return query
    .split(/\W+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2);
}
