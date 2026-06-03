import matter from "gray-matter";

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

export function stringifyDoc(data: Record<string, any>, body: string): string {
  // gray-matter appends a trailing newline after frontmatter; normalize the body.
  return matter.stringify(`${body.trim()}\n`, data);
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidProjectName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

export function today(): string {
  return new Date().toISOString().split("T")[0];
}
