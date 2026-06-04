---
name: kb-lint
description: Health check the knowledge base. Finds inconsistencies, gaps, stale content, and suggests improvements.
---

# Lint the Knowledge Base

Run health checks on the wiki and produce a report. Never auto-fixes — reports and recommends.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

- `/kb-lint <project>` — Lint a specific project
- `/kb-lint` — Lint all projects (from the root registry `projects:`)

## Behavior

Run four checks, then write a report. When linting all projects, read the project list from the root `_index.md` registry frontmatter (`projects:`) rather than scanning the filesystem.

### Check 1: Consistency

For each project being linted:
1. Read all wiki articles in the project
2. Look for contradictory claims between articles (e.g., article A says "X uses approach Y" while article B says "X uses approach Z")
3. When a contradiction is found, check the raw sources cited by each article to determine which is correct
4. Report each contradiction with:
   - The two conflicting statements and their article sources
   - Which raw source supports which claim
   - Suggested resolution

### Check 2: Completeness

1. Scan all wiki articles for `[[wikilinks]]` that point to articles that don't exist (broken links)
2. Check if any raw sources in `raw/` (excluding `_archive/`) are not listed in the project's `wiki/_index.md` at all (orphaned sources)
3. Identify articles that are very short (under 100 words) or cite only a single source — these may need more depth
4. Report:
   - Broken wikilinks and what article they should point to
   - Orphaned raw sources that need to be compiled or removed
   - Thin articles that could benefit from more sources

### Check 3: Connections

1. Read articles across ALL projects (not just the one being linted)
2. Look for concepts that appear in multiple projects but aren't cross-linked
3. Suggest new `[[projects/<other>/wiki/<article>]]` cross-links where projects share related concepts
4. Suggest potential new bridging articles that could connect projects
5. Report:
   - Missing cross-links with specific article pairs
   - Suggested new articles with proposed titles and brief rationale

### Check 4: Staleness

1. For each compiled raw source in the project's `wiki/_index.md`, check if the file's modification date is newer than the compiled date listed in the index
2. Flag articles whose underlying sources have changed since last compile
3. Look for raw sources that are contradicted by newer sources — these are candidates for `_archive/`
4. Report:
   - Sources needing recompilation (with file paths and dates)
   - Archive candidates with explanation of why they appear outdated

## Writing the Report

Write the report to `$KNOWLEDGE_BASE/_health.md` (or `$KNOWLEDGE_BASE/projects/<project>/_health.md` if linting a single project):

```markdown
# Health Report — <YYYY-MM-DD>

## Critical (action needed)

Items that affect wiki accuracy or indicate broken content.

- **Contradiction:** [[article-a]] says "X" but [[article-b]] says "Y". Raw source `raw/docs/paper.md` supports "X". **Suggested fix:** Update [[article-b]].
- **Broken link:** [[nonexistent-article]] referenced in [[some-article]] — article does not exist.

## Warnings

Items that indicate potential quality issues.

- **Thin article:** [[some-concept]] has only 45 words and cites 1 source. Consider enriching with additional sources.
- **Stale:** `raw/documents/old-report.md` was modified on 2026-04-01 but was last compiled on 2026-03-15. Run `/kb-compile` to update.

## Suggestions

Opportunities to improve the knowledge base.

- **Cross-link:** [[projects/agent-design/wiki/tool-use-patterns]] and [[projects/coding-project/wiki/api-design]] both discuss API abstraction patterns — consider cross-linking.
- **New article candidate:** "Prompt Engineering Techniques" appears across 3 projects but has no dedicated article.
- **Archive candidate:** `raw/documents/draft-v1.md` appears to be superseded by `raw/documents/draft-v2.md`.
```

## After the Report

Tell the user:
- Summary of findings (e.g., "Found 2 critical issues, 3 warnings, and 4 suggestions")
- Suggest specific actions: "Run `/kb-compile <project>` to fix stale articles" or "Review archive candidates and confirm with me"
- Ask if they'd like to act on any of the findings

## Principles

- Never auto-fix. The user decides what to act on.
- Be specific — cite exact articles, exact raw sources, exact wikilinks
- Prioritize correctly — contradictions are critical, missing cross-links are suggestions
- When suggesting archives, explain why the source appears outdated
