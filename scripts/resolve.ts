import { RootFrontmatter, ProjectRegistryEntry } from "./contract.js";
import { readRoot, findProject } from "./registry.js";

export interface ResolveSignals {
  name?: string;
  keywords: string[];
}

export interface ResolveResult {
  status: "match" | "ambiguous" | "none";
  project?: ProjectRegistryEntry;
  candidates?: ProjectRegistryEntry[];
}

function scoreProject(p: ProjectRegistryEntry, keywords: string[]): number {
  const haystack = [p.name, p.description, ...p.keywords].join(" ").toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (kw && haystack.includes(kw.toLowerCase())) score++;
  }
  return score;
}

export function matchProject(root: RootFrontmatter, signals: ResolveSignals): ResolveResult {
  if (signals.name) {
    const exact = findProject(root, signals.name);
    if (exact) return { status: "match", project: exact };
  }

  const scored = root.projects
    .map((p) => ({ p, score: scoreProject(p, signals.keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "none" };
  if (scored.length === 1) return { status: "match", project: scored[0].p };
  if (scored[0].score > scored[1].score) return { status: "match", project: scored[0].p };
  return { status: "ambiguous", candidates: scored.map((s) => s.p) };
}

// CLI: resolve.ts <kbRoot> <name|""> <kw1> <kw2> ...
const [, , kbRootArg, nameArg, ...kwArgs] = process.argv;
if (kbRootArg !== undefined) {
  try {
    const root = readRoot(kbRootArg);
    const signals: ResolveSignals = { name: nameArg || undefined, keywords: kwArgs };
    console.log(JSON.stringify(matchProject(root, signals)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
