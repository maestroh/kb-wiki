import matter from "gray-matter";
import jsyaml from "js-yaml";

// Custom gray-matter stringify options: use JSON_SCHEMA so js-yaml doesn't
// re-quote YYYY-MM-DD strings as if they were date scalars.
const STRINGIFY_OPTS = {
  engines: {
    yaml: {
      parse: (str: string) => jsyaml.load(str) as object,
      stringify: (data: Record<string, any>) =>
        jsyaml.dump(data, { schema: jsyaml.JSON_SCHEMA }),
    },
  },
};

export const KB_VERSION = 1;

export interface ProjectRegistryEntry {
  name: string;
  description: string;
  keywords: string[];
  path: string; // e.g. "projects/acme-redesign"
  articles: number;
}

export interface RootFrontmatter {
  kind: "kb-root";
  version: number;
  projects: ProjectRegistryEntry[];
}

export interface ProjectFrontmatter {
  kind: "kb-project";
  name: string;
  description: string;
  keywords: string[];
  created: string; // YYYY-MM-DD
}

export interface ArticleFrontmatter {
  kind: "kb-article";
  sources: string[];
}

export interface ParsedDoc {
  data: Record<string, any>;
  body: string;
}

export function parseDoc(md: string): ParsedDoc {
  const { data, content } = matter(md);
  return { data: data as Record<string, any>, body: content.trim() };
}

// js-yaml parses bare `YYYY-MM-DD` values into Date objects; coerce them back
// to `YYYY-MM-DD` strings so round-tripping frontmatter stays byte-stable.
function coerceDates(value: any): any {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (Array.isArray(value)) return value.map(coerceDates);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, coerceDates(v)])
    );
  }
  return value;
}

export function stringifyDoc(data: Record<string, any>, body: string): string {
  // gray-matter appends a trailing newline after frontmatter; normalize the body.
  return matter.stringify(`${body.trim()}\n`, coerceDates(data), STRINGIFY_OPTS);
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['''‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidProjectName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

export function today(): string {
  return new Date().toLocaleDateString("en-CA");
}
