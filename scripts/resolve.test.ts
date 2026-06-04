import { describe, it, expect } from "vitest";
import { matchProject, ResolveSignals } from "./resolve.js";
import { RootFrontmatter } from "./contract.js";

const root: RootFrontmatter = {
  kind: "kb-root",
  version: 1,
  projects: [
    { name: "acme-redesign", description: "ACME customer portal redesign", keywords: ["acme", "portal", "ui"], path: "projects/acme-redesign", articles: 5 },
    { name: "blog", description: "personal blog drafts", keywords: ["writing", "blog"], path: "projects/blog", articles: 2 },
    { name: "acme-infra", description: "ACME infrastructure notes", keywords: ["acme", "infra", "k8s"], path: "projects/acme-infra", articles: 1 },
  ],
};

describe("matchProject", () => {
  it("returns match on exact name", () => {
    const r = matchProject(root, { name: "blog", keywords: [] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("blog");
  });

  it("returns match on a single clear keyword winner", () => {
    const r = matchProject(root, { keywords: ["writing"] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("blog");
  });

  it("returns ambiguous when multiple projects tie on keywords", () => {
    const r = matchProject(root, { keywords: ["acme"] });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates?.map((c) => c.name).sort()).toEqual(["acme-infra", "acme-redesign"]);
  });

  it("picks the stronger scorer over a weaker one", () => {
    const r = matchProject(root, { keywords: ["acme", "portal", "ui"] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("acme-redesign");
  });

  it("returns none when nothing matches", () => {
    const r = matchProject(root, { keywords: ["gardening"] });
    expect(r.status).toBe("none");
  });

  it("prefers an explicit name even when keywords point elsewhere", () => {
    const r = matchProject(root, { name: "acme-infra", keywords: ["portal"] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("acme-infra");
  });
});
