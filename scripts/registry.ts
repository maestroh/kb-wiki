import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDoc,
  stringifyDoc,
  RootFrontmatter,
  ProjectRegistryEntry,
  KB_VERSION,
} from "./contract.js";

function rootIndexPath(kbRoot: string): string {
  return join(kbRoot, "_index.md");
}

export function readRoot(kbRoot: string): RootFrontmatter {
  const { data } = parseDoc(readFileSync(rootIndexPath(kbRoot), "utf-8"));
  return {
    kind: "kb-root",
    version: typeof data.version === "number" ? data.version : KB_VERSION,
    projects: Array.isArray(data.projects) ? (data.projects as ProjectRegistryEntry[]) : [],
  };
}

export function writeRoot(kbRoot: string, root: RootFrontmatter): void {
  const path = rootIndexPath(kbRoot);
  const { body } = parseDoc(readFileSync(path, "utf-8"));
  writeFileSync(path, stringifyDoc({ ...root }, body));
}

export function findProject(
  root: RootFrontmatter,
  name: string
): ProjectRegistryEntry | undefined {
  return root.projects.find((p) => p.name === name);
}

export function upsertProject(
  root: RootFrontmatter,
  entry: ProjectRegistryEntry
): RootFrontmatter {
  const projects = root.projects.filter((p) => p.name !== entry.name);
  projects.push(entry);
  return { ...root, projects };
}

export function setArticleCount(
  root: RootFrontmatter,
  name: string,
  count: number
): RootFrontmatter {
  return {
    ...root,
    projects: root.projects.map((p) =>
      p.name === name ? { ...p, articles: count } : p
    ),
  };
}
