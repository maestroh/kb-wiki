# LLM Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that fully manages an LLM-powered personal knowledge base — from initialization through ingestion, compilation, querying, and health checks.

**Architecture:** A single plugin repo (`claude-knowledge-plugin`) contains six skills and three TypeScript preprocessing scripts. The plugin creates and manages the knowledge base (a pure-data Obsidian vault) at whatever path `$KNOWLEDGE_BASE` points to. All KB setup, structure, and content is driven by the plugin — the user never manually touches the KB.

**Tech Stack:** Claude Code plugin system, TypeScript (tsx), pdf-parse, mammoth, @mozilla/readability, linkedom, turndown, ffmpeg (external), whisper (external)

**Spec:** `docs/superpowers/specs/2026-04-04-llm-knowledge-base-design.md` (in the knowledge repo)

**All work happens in:** `/Users/nael/Projects/claude-knowledge-plugin`

---

### Task 1: Scaffold Plugin Repo

**Files:**
- Create: `package.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Create plugin directory and initialize git**

```bash
mkdir -p /Users/nael/Projects/claude-knowledge-plugin
cd /Users/nael/Projects/claude-knowledge-plugin
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "claude-knowledge-plugin",
  "version": "0.1.0",
  "type": "module",
  "description": "Claude Code plugin for managing LLM-maintained personal knowledge bases",
  "author": "nael",
  "license": "MIT",
  "keywords": ["knowledge-base", "wiki", "obsidian", "skills"]
}
```

- [ ] **Step 3: Create .claude-plugin/plugin.json**

```json
{
  "name": "claude-knowledge-plugin",
  "description": "Skills for ingesting, compiling, querying, and maintaining an LLM-powered personal knowledge base",
  "version": "0.1.0",
  "author": {
    "name": "nael"
  },
  "license": "MIT",
  "skills": "./skills/"
}
```

- [ ] **Step 4: Create .claude-plugin/marketplace.json**

```json
{
  "name": "claude-knowledge-plugin",
  "description": "LLM-maintained personal knowledge base",
  "owner": {
    "name": "nael"
  },
  "plugins": [
    {
      "name": "claude-knowledge-plugin",
      "description": "Skills for ingesting, compiling, querying, and maintaining an LLM-powered personal knowledge base",
      "version": "0.1.0",
      "source": "./"
    }
  ]
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 6: Create README.md**

```markdown
# Claude Knowledge Plugin

A Claude Code plugin for managing LLM-maintained personal knowledge bases.

## Setup

1. Install this plugin in Claude Code
2. Set the `KNOWLEDGE_BASE` environment variable in your shell profile:

```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

3. Run `/init` to create your knowledge base
4. Open `$KNOWLEDGE_BASE` as an Obsidian vault

## Skills

- `/init [path]` — Initialize a new knowledge base
- `/topic create <name>` — Create a new topic namespace
- `/ingest <topic> <file|url|text>` — Add source material to a topic
- `/compile [topic]` — Compile raw sources into wiki articles
- `/ask <question>` — Query the knowledge base
- `/lint [topic]` — Health check the knowledge base

## Requirements

- `KNOWLEDGE_BASE` environment variable set to your desired KB path
- For document preprocessing: Node.js 18+
- For video preprocessing: ffmpeg, whisper (openai-whisper)
- For PPTX conversion: pandoc (optional)
```

- [ ] **Step 7: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add package.json .claude-plugin/ .gitignore README.md
git commit -m "feat: scaffold Claude Code plugin structure"
```

---

### Task 2: `/init` Skill

**Files:**
- Create: `skills/init/SKILL.md`

The first skill to build — it creates the entire knowledge base structure that all other skills depend on.

- [ ] **Step 1: Create skills/init/SKILL.md**

```markdown
---
name: init
description: Initialize a new knowledge base. Creates directory structure, CLAUDE.md, indexes, Obsidian config, and git repo. Run once to set up.
---

# Initialize Knowledge Base

Create a new knowledge base at the specified path or at `$KNOWLEDGE_BASE`.

## Environment

The knowledge base path is determined by:
1. An explicit path argument: `/init /path/to/kb`
2. The `$KNOWLEDGE_BASE` environment variable
3. If neither is set, ask the user where they want to create the knowledge base

## Usage

- `/init` — Initialize at `$KNOWLEDGE_BASE`
- `/init /path/to/my-kb` — Initialize at a specific path

## Behavior

### 1. Validate

- Determine the target path (argument > `$KNOWLEDGE_BASE` > ask user)
- If the directory already contains a `CLAUDE.md` and `_index.md`, warn that a knowledge base already exists here and exit without overwriting
- Create the target directory if it doesn't exist

### 2. Create Directory Structure

Create the following empty directory tree:

```
<path>/
├── topics/
├── .obsidian/
└── docs/
```

The `topics/` directory starts empty — topics are created via `/topic create <name>`.

### 3. Create CLAUDE.md

Write `<path>/CLAUDE.md`:

```markdown
# Knowledge Base

This is an LLM-maintained personal knowledge base. The LLM writes and maintains all wiki content — you rarely edit it directly.

## Directory Structure

topics/<topic-name>/
  raw/          — Original + preprocessed source materials
    notes/      — Handwritten notes (.md)
    documents/  — PDFs, PPTs, DOCs + their .md conversions
    videos/     — Video files + transcript .md files
    links/      — Web clippings saved as .md
    images/     — Referenced images
    _archive/   — Outdated sources excluded from compilation
  wiki/         — LLM-compiled articles
    _index.md   — Topic index with article summaries
    *.md        — Individual concept articles
_index.md       — Master index across all topics
_health.md      — Latest lint report

## Rules

- Never edit files in raw/ — they are source-of-truth originals
- Never delete raw sources — move outdated ones to raw/_archive/
- Wiki articles are synthesized from multiple sources, not 1:1 copies
- Always update _index.md files after any wiki change
- Use [[wikilinks]] for same-topic links
- Use [[topic-name/article]] for cross-topic links
- Each wiki article must have a "Sources" section listing contributing raw files

## Index Navigation

When answering questions or compiling:
1. Read root _index.md first to find relevant topics
2. Read topic wiki/_index.md to find specific articles
3. Read articles as needed
4. Go deeper into raw/ sources only if articles lack sufficient detail

## Wiki Article Format

Each wiki article should follow this structure:
- Clear title as H1
- One-line summary in italics below the title
- Core content with [[wikilinks]] to related articles
- ## Sources section at the bottom listing raw files that contributed
```

### 4. Create Root _index.md

Write `<path>/_index.md`:

```markdown
# Knowledge Base Index

## Topics

_No topics yet. Use `/topic create <name>` to create one._

## Cross-Topic Connections

_None yet._
```

### 5. Create .obsidian Config

Write `<path>/.obsidian/app.json`:

```json
{
  "useMarkdownLinks": false,
  "showUnsupportedFiles": false,
  "userIgnoreFilters": ["docs/"]
}
```

Write `<path>/.obsidian/graph.json`:

```json
{
  "collapse-filter": false,
  "search": "",
  "showTags": false,
  "showAttachments": true,
  "hideUnresolved": false,
  "showOrphans": true,
  "collapse-color-groups": false,
  "colorGroups": [],
  "collapse-display": false,
  "lineSizeMultiplier": 1,
  "nodeSizeMultiplier": 1,
  "textFadeMultiplier": 0,
  "collapse-forces": false,
  "centerStrength": 0.518713248970312,
  "repelStrength": 10,
  "linkStrength": 1,
  "linkDistance": 250,
  "scale": 1,
  "close": false
}
```

### 6. Create .gitignore

Write `<path>/.gitignore`:

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
```

### 7. Initialize Git

Run `git init` in the target directory, then stage and commit all files:

```bash
cd <path>
git init
git add -A
git commit -m "feat: initialize knowledge base"
```

### 8. Guide the User

Tell the user:

1. Knowledge base created at `<path>`
2. If `$KNOWLEDGE_BASE` is not set, tell them to add it to their shell profile:
   ```bash
   export KNOWLEDGE_BASE="<path>"
   ```
3. Open `<path>` as an Obsidian vault to browse the wiki
4. Next step: run `/topic create <name>` to create your first topic
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add skills/init/SKILL.md
git commit -m "feat: add /init skill for creating knowledge bases"
```

---

### Task 3: `/topic` Skill

**Files:**
- Create: `skills/topic/SKILL.md`

Creates a new topic namespace with the correct directory structure inside an existing KB.

- [ ] **Step 1: Create skills/topic/SKILL.md**

```markdown
---
name: topic
description: Create a new topic namespace in the knowledge base. Use when starting research on a new subject.
---

# Topic Management

Create and manage topic namespaces in the knowledge base.

## Environment

The knowledge base root is at the path specified by the `KNOWLEDGE_BASE` environment variable. If this variable is not set, tell the user to set it in their shell profile:

```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

`/topic create <name>`

The `<name>` argument is the topic name. Use kebab-case (e.g., `agent-design`, `client-acme`, `project-x`).

## Behavior

When the user runs `/topic create <name>`:

1. **Validate** — Check that `$KNOWLEDGE_BASE` is set and the directory exists. Check that `$KNOWLEDGE_BASE/_index.md` exists (KB has been initialized). Check that `topics/<name>` does not already exist.

2. **Create directory structure** — Create all of these directories:
   - `$KNOWLEDGE_BASE/topics/<name>/raw/notes/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/documents/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/videos/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/links/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/images/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/_archive/`
   - `$KNOWLEDGE_BASE/topics/<name>/wiki/`

3. **Create topic index** — Write `$KNOWLEDGE_BASE/topics/<name>/wiki/_index.md`:

```markdown
# <Name (title case)>

## Articles

_No articles yet. Use `/compile <name>` after adding raw sources._

## Raw Sources (compiled)

_None._

## Raw Sources (pending)

_None._

## Raw Sources (archived)

_None._
```

4. **Update root index** — Read `$KNOWLEDGE_BASE/_index.md` and add the new topic to the `## Topics` section. If the placeholder text "_No topics yet..." exists, replace it. Add the entry as:
   ```
   - [[<name>]] — <brief description based on the name> (0 articles)
   ```

5. **Confirm** — Tell the user the topic was created and suggest next steps:
   - Drop files into `topics/<name>/raw/` or use `/ingest <name> <file>`
   - Run `/compile <name>` when ready to build wiki articles
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add skills/topic/SKILL.md
git commit -m "feat: add /topic skill for creating topic namespaces"
```

---

### Task 4: `/ingest` Skill

**Files:**
- Create: `skills/ingest/SKILL.md`

Handles adding raw source material to a topic. Detects input type and runs preprocessors when available.

- [ ] **Step 1: Create skills/ingest/SKILL.md**

```markdown
---
name: ingest
description: Add source material (files, URLs, or notes) to a knowledge base topic. Preprocesses documents into markdown.
---

# Ingest Source Material

Add raw source material to a topic's `raw/` directory, optionally preprocessing it into markdown.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

The plugin root is at `$CLAUDE_PLUGIN_ROOT` (set automatically by Claude Code).

## Usage

`/ingest <topic> <source>`

Where `<source>` is one of:
- A file path (absolute or relative to current directory)
- A URL (starts with `http://` or `https://`)
- Inline text (anything else — saved as a timestamped note)

## Behavior

### 1. Validate

- Check `$KNOWLEDGE_BASE` is set and exists
- Check `topics/<topic>` exists. If not, ask the user if they want to create it (run the `/topic` skill logic)

### 2. Determine Input Type and Process

**If source is a file path:**

Detect the file type by extension and process accordingly:

| Extension | Destination | Preprocessing |
|-----------|-------------|---------------|
| `.md` | `raw/notes/` | None — copy as-is |
| `.txt` | `raw/notes/` | None — copy as-is |
| `.pdf` | `raw/documents/` | Run: `npx tsx "$CLAUDE_PLUGIN_ROOT/scripts/preprocess-pdf.ts" <file> <output-dir>` |
| `.docx` | `raw/documents/` | Run: `npx tsx "$CLAUDE_PLUGIN_ROOT/scripts/preprocess-pdf.ts" <file> <output-dir>` |
| `.pptx` | `raw/documents/` | Run: `npx tsx "$CLAUDE_PLUGIN_ROOT/scripts/preprocess-pdf.ts" <file> <output-dir>` |
| `.mp4`, `.mov`, `.webm`, `.mkv` | `raw/videos/` | Run: `npx tsx "$CLAUDE_PLUGIN_ROOT/scripts/preprocess-video.ts" <file> <output-dir>` |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp` | `raw/images/` | None — copy as-is |
| Other | `raw/` (root) | None — copy as-is, flag as "unprocessed" |

Copy the original file to the destination directory. If a preprocessor is available and succeeds, the generated `.md` file will be placed alongside the original. If the preprocessor fails or is not installed, copy the file anyway and note it as "unprocessed" in the index.

**If source is a URL:**

Run: `npx tsx "$CLAUDE_PLUGIN_ROOT/scripts/preprocess-url.ts" <url> "$KNOWLEDGE_BASE/topics/<topic>/raw/links/" "$KNOWLEDGE_BASE/topics/<topic>/raw/images/"`

This creates a `.md` file in `raw/links/` with the article content and downloads referenced images to `raw/images/`.

If the URL preprocessor is not available, use the WebFetch tool to fetch the URL content, convert to markdown manually, and save to `raw/links/<slugified-title>.md` with frontmatter:

```markdown
---
source_url: <url>
fetched: <YYYY-MM-DD>
---

<content>
```

**If source is inline text:**

Save to `raw/notes/<YYYY-MM-DD-HH-MM>-note.md`:

```markdown
---
created: <YYYY-MM-DDTHH:MM:SS>
---

<the user's text>
```

### 3. Update Topic Index

Read `$KNOWLEDGE_BASE/topics/<topic>/wiki/_index.md` and add the new file to the `## Raw Sources (pending)` section:

```
- raw/<subdir>/<filename> — added <YYYY-MM-DD>, not yet compiled
```

If the placeholder text "_None._" exists under that section, replace it.

Does NOT compile into wiki articles — that's `/compile`'s job.

### 4. Confirm

Tell the user:
- What was ingested and where it was stored
- Whether preprocessing succeeded, failed, or was skipped
- Suggest running `/compile <topic>` to incorporate into the wiki
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add skills/ingest/SKILL.md
git commit -m "feat: add /ingest skill for adding source material to topics"
```

---

### Task 5: Preprocessing Scripts Setup

**Files:**
- Create: `scripts/package.json`
- Create: `scripts/tsconfig.json`

- [ ] **Step 1: Create scripts/package.json**

```json
{
  "name": "knowledge-preprocessors",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "preprocess:pdf": "tsx preprocess-pdf.ts",
    "preprocess:video": "tsx preprocess-video.ts",
    "preprocess:url": "tsx preprocess-url.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "linkedom": "^0.18.0",
    "mammoth": "^1.8.0",
    "pdf-parse": "^1.1.1",
    "turndown": "^7.2.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0",
    "@types/turndown": "^5.0.5"
  }
}
```

- [ ] **Step 2: Create scripts/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin/scripts
npm install
```

- [ ] **Step 4: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add scripts/package.json scripts/tsconfig.json scripts/package-lock.json
git commit -m "feat: set up TypeScript project for preprocessing scripts"
```

---

### Task 6: URL Preprocessor

**Files:**
- Create: `scripts/preprocess-url.ts`
- Create: `scripts/preprocess-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/preprocess-url.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { htmlToMarkdown, slugifyTitle, buildFrontmatter } from "./preprocess-url.js";

describe("htmlToMarkdown", () => {
  it("converts simple HTML to markdown", () => {
    const html = "<h1>Test Title</h1><p>Hello <strong>world</strong></p>";
    const result = htmlToMarkdown(html);
    expect(result).toContain("# Test Title");
    expect(result).toContain("**world**");
  });

  it("converts links to markdown format", () => {
    const html = '<p>Visit <a href="https://example.com">Example</a></p>';
    const result = htmlToMarkdown(html);
    expect(result).toContain("[Example](https://example.com)");
  });

  it("converts images to markdown format", () => {
    const html = '<img src="image.png" alt="test image">';
    const result = htmlToMarkdown(html);
    expect(result).toContain("![test image](image.png)");
  });
});

describe("slugifyTitle", () => {
  it("converts title to kebab-case filename", () => {
    expect(slugifyTitle("Hello World: A Test")).toBe("hello-world-a-test");
  });

  it("removes special characters", () => {
    expect(slugifyTitle("What's New? (2024)")).toBe("whats-new-2024");
  });

  it("collapses multiple dashes", () => {
    expect(slugifyTitle("foo   bar---baz")).toBe("foo-bar-baz");
  });
});

describe("buildFrontmatter", () => {
  it("builds YAML frontmatter with source URL and date", () => {
    const result = buildFrontmatter("https://example.com/article", "Test Article");
    expect(result).toContain("source_url: https://example.com/article");
    expect(result).toContain("title: Test Article");
    expect(result).toMatch(/fetched: \d{4}-\d{2}-\d{2}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nael/Projects/claude-knowledge-plugin/scripts && npx vitest run preprocess-url.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `scripts/preprocess-url.ts`:

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import TurndownService from "turndown";
import { parseHTML } from "linkedom";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildFrontmatter(url: string, title: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `---\nsource_url: ${url}\ntitle: ${title}\nfetched: ${date}\n---`;
}

function extractArticleContent(html: string): { title: string; content: string } {
  const { document } = parseHTML(html);

  const article =
    document.querySelector("article") ||
    document.querySelector('[role="main"]') ||
    document.querySelector("main") ||
    document.querySelector(".post-content") ||
    document.querySelector(".entry-content") ||
    document.body;

  const titleEl =
    document.querySelector("h1") ||
    document.querySelector("title");
  const title = titleEl?.textContent?.trim() || "Untitled";

  const removeSelectors = ["script", "style", "nav", "footer", "header", "aside", ".sidebar", ".comments"];
  for (const selector of removeSelectors) {
    for (const el of article!.querySelectorAll(selector)) {
      el.remove();
    }
  }

  const content = article?.innerHTML || "";
  return { title, content };
}

async function downloadImage(url: string, outputDir: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = basename(new URL(url).pathname) || "image.png";
    const outputPath = join(outputDir, filename);
    writeFileSync(outputPath, buffer);
    return filename;
  } catch {
    return null;
  }
}

export async function preprocessUrl(
  url: string,
  outputDir: string,
  imagesDir?: string
): Promise<{ markdownPath: string; title: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();

  const { title, content } = extractArticleContent(html);
  let markdown = htmlToMarkdown(content);

  if (imagesDir) {
    mkdirSync(imagesDir, { recursive: true });
    const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    const matches = [...markdown.matchAll(imageRegex)];
    for (const match of matches) {
      const [fullMatch, alt, imageUrl] = match;
      const localFilename = await downloadImage(imageUrl, imagesDir);
      if (localFilename) {
        markdown = markdown.replace(fullMatch, `![${alt}](../images/${localFilename})`);
      }
    }
  }

  const frontmatter = buildFrontmatter(url, title);
  const fullContent = `${frontmatter}\n\n${markdown}\n`;
  const filename = `${slugifyTitle(title)}.md`;
  const outputPath = join(outputDir, filename);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, fullContent);

  return { markdownPath: outputPath, title };
}

// CLI entry point
const [, , urlArg, outputDirArg, imagesDirArg] = process.argv;
if (urlArg && outputDirArg) {
  preprocessUrl(urlArg, outputDirArg, imagesDirArg)
    .then(({ markdownPath, title }) => {
      console.log(JSON.stringify({ markdownPath, title }));
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nael/Projects/claude-knowledge-plugin/scripts && npx vitest run preprocess-url.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add scripts/preprocess-url.ts scripts/preprocess-url.test.ts
git commit -m "feat: add URL preprocessor — fetches pages, extracts content, converts to markdown"
```

---

### Task 7: PDF/Document Preprocessor

**Files:**
- Create: `scripts/preprocess-pdf.ts`
- Create: `scripts/preprocess-pdf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/preprocess-pdf.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectDocType, buildDocFrontmatter } from "./preprocess-pdf.js";

describe("detectDocType", () => {
  it("detects PDF files", () => {
    expect(detectDocType("report.pdf")).toBe("pdf");
  });

  it("detects DOCX files", () => {
    expect(detectDocType("notes.docx")).toBe("docx");
  });

  it("detects PPTX files", () => {
    expect(detectDocType("slides.pptx")).toBe("pptx");
  });

  it("returns unknown for unsupported types", () => {
    expect(detectDocType("data.csv")).toBe("unknown");
  });
});

describe("buildDocFrontmatter", () => {
  it("builds frontmatter with source file and type", () => {
    const result = buildDocFrontmatter("/path/to/report.pdf", "pdf");
    expect(result).toContain("source_file: /path/to/report.pdf");
    expect(result).toContain("doc_type: pdf");
    expect(result).toMatch(/converted: \d{4}-\d{2}-\d{2}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nael/Projects/claude-knowledge-plugin/scripts && npx vitest run preprocess-pdf.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `scripts/preprocess-pdf.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
// @ts-expect-error pdf-parse has no type declarations
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

type DocType = "pdf" | "docx" | "pptx" | "unknown";

export function detectDocType(filename: string): DocType {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case ".pdf": return "pdf";
    case ".docx": return "docx";
    case ".pptx": return "pptx";
    default: return "unknown";
  }
}

export function buildDocFrontmatter(sourcePath: string, docType: DocType): string {
  const date = new Date().toISOString().split("T")[0];
  return `---\nsource_file: ${sourcePath}\ndoc_type: ${docType}\nconverted: ${date}\n---`;
}

async function convertPdf(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text.trim();
}

async function convertDocx(filePath: string): Promise<string> {
  const result = await mammoth.convertToMarkdown({ path: filePath });
  return result.value.trim();
}

async function convertPptx(filePath: string): Promise<string> {
  const { execSync } = await import("node:child_process");
  try {
    const output = execSync(`pandoc "${filePath}" -t markdown --wrap=none`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    return output.trim();
  } catch {
    return `_PPTX conversion requires pandoc. Install it with: brew install pandoc (macOS) or apt install pandoc (Linux)_\n\n_Original file: ${basename(filePath)}_`;
  }
}

export async function preprocessDocument(
  filePath: string,
  outputDir: string
): Promise<{ markdownPath: string; docType: DocType }> {
  const docType = detectDocType(filePath);
  if (docType === "unknown") {
    throw new Error(`Unsupported document type: ${extname(filePath)}`);
  }

  let content: string;
  switch (docType) {
    case "pdf":
      content = await convertPdf(filePath);
      break;
    case "docx":
      content = await convertDocx(filePath);
      break;
    case "pptx":
      content = await convertPptx(filePath);
      break;
  }

  const frontmatter = buildDocFrontmatter(filePath, docType);
  const fullContent = `${frontmatter}\n\n${content}\n`;
  const mdFilename = basename(filePath, extname(filePath)) + ".md";
  const outputPath = join(outputDir, mdFilename);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, fullContent);

  return { markdownPath: outputPath, docType };
}

// CLI entry point
const [, , fileArg, outputDirArg] = process.argv;
if (fileArg && outputDirArg) {
  preprocessDocument(fileArg, outputDirArg)
    .then(({ markdownPath, docType }) => {
      console.log(JSON.stringify({ markdownPath, docType }));
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nael/Projects/claude-knowledge-plugin/scripts && npx vitest run preprocess-pdf.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add scripts/preprocess-pdf.ts scripts/preprocess-pdf.test.ts
git commit -m "feat: add document preprocessor for PDF, DOCX, PPTX to markdown conversion"
```

---

### Task 8: Video Preprocessor

**Files:**
- Create: `scripts/preprocess-video.ts`
- Create: `scripts/preprocess-video.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/preprocess-video.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildTranscriptMarkdown,
  buildVideoFrontmatter,
  formatTimestamp,
} from "./preprocess-video.js";

describe("formatTimestamp", () => {
  it("formats seconds into HH:MM:SS", () => {
    expect(formatTimestamp(0)).toBe("00:00:00");
    expect(formatTimestamp(65)).toBe("00:01:05");
    expect(formatTimestamp(3661)).toBe("01:01:01");
  });
});

describe("buildVideoFrontmatter", () => {
  it("builds frontmatter with source file", () => {
    const result = buildVideoFrontmatter("/path/to/video.mp4");
    expect(result).toContain("source_file: /path/to/video.mp4");
    expect(result).toContain("media_type: video");
    expect(result).toMatch(/converted: \d{4}-\d{2}-\d{2}/);
  });
});

describe("buildTranscriptMarkdown", () => {
  it("interlaces screenshots with transcript segments", () => {
    const segments = [
      { start: 0, end: 30, text: "Hello everyone" },
      { start: 30, end: 60, text: "Welcome to the talk" },
    ];
    const frames = ["frame_000.png", "frame_030.png"];
    const result = buildTranscriptMarkdown(segments, frames, "frames");

    expect(result).toContain("![00:00:00](frames/frame_000.png)");
    expect(result).toContain("Hello everyone");
    expect(result).toContain("![00:00:30](frames/frame_030.png)");
    expect(result).toContain("Welcome to the talk");
  });

  it("handles more segments than frames", () => {
    const segments = [
      { start: 0, end: 30, text: "Part one" },
      { start: 30, end: 60, text: "Part two" },
      { start: 60, end: 90, text: "Part three" },
    ];
    const frames = ["frame_000.png"];
    const result = buildTranscriptMarkdown(segments, frames, "frames");

    expect(result).toContain("![00:00:00](frames/frame_000.png)");
    expect(result).toContain("Part one");
    expect(result).toContain("Part two");
    expect(result).toContain("Part three");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nael/Projects/claude-knowledge-plugin/scripts && npx vitest run preprocess-video.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `scripts/preprocess-video.ts`:

```typescript
import { writeFileSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { execSync } from "node:child_process";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function buildVideoFrontmatter(sourcePath: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `---\nsource_file: ${sourcePath}\nmedia_type: video\nconverted: ${date}\n---`;
}

export function buildTranscriptMarkdown(
  segments: TranscriptSegment[],
  frames: string[],
  framesDir: string
): string {
  const lines: string[] = [];
  let frameIndex = 0;

  for (const segment of segments) {
    if (frameIndex < frames.length) {
      const frameName = frames[frameIndex];
      const frameTimeMatch = frameName.match(/frame_(\d+)/);
      const frameTime = frameTimeMatch ? parseInt(frameTimeMatch[1]) : -1;

      if (frameTime <= segment.start) {
        lines.push(`![${formatTimestamp(frameTime)}](${framesDir}/${frameName})`);
        lines.push("");
        frameIndex++;
      }
    }

    lines.push(`**[${formatTimestamp(segment.start)}]** ${segment.text}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function extractFrames(videoPath: string, outputDir: string, intervalSeconds: number = 30): string[] {
  mkdirSync(outputDir, { recursive: true });

  try {
    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/${intervalSeconds}" -q:v 2 "${join(outputDir, "frame_%03d.png")}" -y`,
      { encoding: "utf-8", stdio: "pipe", timeout: 300000 }
    );
  } catch (err) {
    throw new Error(
      `ffmpeg failed. Ensure ffmpeg is installed: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Error: ${err}`
    );
  }

  const rawFrames = readdirSync(outputDir).filter((f) => f.startsWith("frame_")).sort();
  const renamedFrames: string[] = [];
  for (let i = 0; i < rawFrames.length; i++) {
    const timeSeconds = i * intervalSeconds;
    const newName = `frame_${String(timeSeconds).padStart(3, "0")}.png`;
    renameSync(join(outputDir, rawFrames[i]), join(outputDir, newName));
    renamedFrames.push(newName);
  }
  return renamedFrames;
}

function transcribeAudio(videoPath: string, outputDir: string): TranscriptSegment[] {
  const audioPath = join(outputDir, "audio.wav");

  try {
    execSync(`ffmpeg -i "${videoPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}" -y`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 300000,
    });

    execSync(
      `whisper "${audioPath}" --output_format json --output_dir "${outputDir}" --model base`,
      { encoding: "utf-8", stdio: "pipe", timeout: 600000 }
    );

    const { readFileSync } = require("node:fs");
    const jsonPath = join(outputDir, "audio.json");
    const whisperOutput = JSON.parse(readFileSync(jsonPath, "utf-8"));
    return whisperOutput.segments.map((s: { start: number; end: number; text: string }) => ({
      start: Math.floor(s.start),
      end: Math.floor(s.end),
      text: s.text.trim(),
    }));
  } catch (err) {
    throw new Error(
      `Transcription failed. Ensure whisper is installed: pip install openai-whisper. Error: ${err}`
    );
  }
}

export async function preprocessVideo(
  videoPath: string,
  outputDir: string,
  frameInterval: number = 30
): Promise<{ markdownPath: string }> {
  const name = basename(videoPath, extname(videoPath));
  const framesDir = join(outputDir, `${name}_frames`);

  const frames = extractFrames(videoPath, framesDir, frameInterval);
  const segments = transcribeAudio(videoPath, outputDir);

  const frontmatter = buildVideoFrontmatter(videoPath);
  const transcript = buildTranscriptMarkdown(segments, frames, `${name}_frames`);
  const fullContent = `${frontmatter}\n\n# ${name}\n\n${transcript}\n`;

  const mdPath = join(outputDir, `${name}.md`);
  writeFileSync(mdPath, fullContent);

  return { markdownPath: mdPath };
}

// CLI entry point
const [, , videoArg, outputDirArg] = process.argv;
if (videoArg && outputDirArg) {
  preprocessVideo(videoArg, outputDirArg)
    .then(({ markdownPath }) => {
      console.log(JSON.stringify({ markdownPath }));
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nael/Projects/claude-knowledge-plugin/scripts && npx vitest run preprocess-video.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add scripts/preprocess-video.ts scripts/preprocess-video.test.ts
git commit -m "feat: add video preprocessor — transcript + keyframe screenshots via ffmpeg/whisper"
```

---

### Task 9: `/compile` Skill

**Files:**
- Create: `skills/compile/SKILL.md`

The core skill — reads raw sources and synthesizes wiki articles.

- [ ] **Step 1: Create skills/compile/SKILL.md**

```markdown
---
name: compile
description: Compile raw source materials into wiki articles. Synthesizes concepts, creates interlinked articles, and maintains indexes.
---

# Compile Wiki

Read new and changed raw materials in a topic and compile them into synthesized wiki articles.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

- `/compile <topic>` — Compile a specific topic
- `/compile` — Compile all topics with pending changes
- `/compile --full <topic>` — Full recompile (ignore previous compilation state)

## Behavior

### 1. Identify What Needs Compilation

Read `$KNOWLEDGE_BASE/topics/<topic>/wiki/_index.md`. Look at the `## Raw Sources (pending)` section for new uncompiled sources. If `--full` flag is used, treat ALL non-archived sources as pending.

If no pending sources exist, tell the user and exit.

### 2. Read and Analyze Raw Sources

For each pending raw source:
1. Read the full content of the file
2. Extract key concepts, facts, claims, and relationships
3. Note what topics/concepts this source is about

### 3. Match Against Existing Wiki

Read the existing wiki articles listed in `_index.md`. For each concept found in the raw sources:
- Does an existing article already cover this concept? → Update it
- Is this a new concept? → Create a new article

### 4. Create/Update Wiki Articles

For each wiki article to create or update:

**Article format:**

```markdown
# <Concept Title>

*<One-line summary of the concept>*

<Main content — synthesized from all contributing sources. Do NOT copy verbatim. Write a clear, informative article that weaves together information from multiple sources. Use your own structure and organization.>

<Include [[wikilinks]] to other articles in this topic where concepts are related.>

<For cross-topic connections, use [[topic-name/article-name]] format.>

## Sources

- `raw/documents/paper-on-agents.md` — primary source for agent loop description
- `raw/notes/2026-04-03-thoughts.md` — additional context on planning strategies
```

**Key principles:**
- Articles are SYNTHESIZED, not copied. Multiple sources contribute to one article. One source may spawn multiple articles.
- Use clear, concise language. The wiki is a reference, not a transcript.
- Link generously using [[wikilinks]] — connections are the wiki's power.
- Every article MUST have a Sources section.

### 5. Check for Cross-Topic Connections

After updating this topic's articles, read the root `_index.md` to see other topics. If any concepts in the newly compiled articles relate to other topics:
- Add [[other-topic/article]] wikilinks in the article body
- Update the root `_index.md` `## Cross-Topic Connections` section

### 6. Update Indexes

**Topic index** (`wiki/_index.md`):
- Move compiled sources from `## Raw Sources (pending)` to `## Raw Sources (compiled)` with today's date
- Update the `## Articles` section with any new or removed articles and their one-line summaries

**Root index** (`_index.md`):
- Update the article count for this topic
- Update the topic's one-line description if it has evolved
- Update cross-topic connections

### 7. Report

Tell the user:
- How many raw sources were compiled
- How many new articles were created
- How many existing articles were updated
- Any cross-topic connections found
- Suggest running `/lint <topic>` to check quality

## Handling Large Topics

If a topic has many pending sources (more than ~10), process them in batches:
1. Read all pending sources first to get a full picture of concepts
2. Plan which articles to create/update
3. Write articles in batches of 3-5
4. Update indexes after each batch

This prevents context overflow and ensures each article gets proper attention.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add skills/compile/SKILL.md
git commit -m "feat: add /compile skill for synthesizing raw sources into wiki articles"
```

---

### Task 10: `/ask` Skill

**Files:**
- Create: `skills/ask/SKILL.md`

- [ ] **Step 1: Create skills/ask/SKILL.md**

```markdown
---
name: ask
description: Query the knowledge base. Navigates indexes to find relevant articles and synthesizes an answer with optional mermaid diagrams.
---

# Ask the Knowledge Base

Answer questions by researching the wiki using index-based navigation.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

`/ask <question>`

The question can be anything — factual, analytical, comparative, exploratory.

## Behavior

### 1. Navigate to Relevant Content (Two-Hop Strategy)

**Hop 1:** Read `$KNOWLEDGE_BASE/_index.md`. Identify which topics are relevant to the question based on topic names and descriptions.

**Hop 2:** For each relevant topic, read `$KNOWLEDGE_BASE/topics/<topic>/wiki/_index.md`. Identify which specific articles are likely to contain the answer based on article titles and summaries.

**Read:** Read the relevant wiki articles. If the question requires depth beyond what the articles provide, go deeper into the `raw/` sources cited in the articles' Sources sections.

### 2. Synthesize the Answer

Answer the question conversationally in the terminal. Include:
- The direct answer to the question
- `[[article]]` citations so the user can read further in Obsidian
- Relevant context from multiple articles/topics if applicable

### 3. Generate Diagrams (When Appropriate)

If the answer involves architecture, flows, relationships, processes, or hierarchies that would be clearer as a visual:

1. Generate a mermaid diagram
2. Save it as a `.md` file in the relevant topic's `wiki/` directory with a descriptive name (e.g., `diagram-agent-loop-flow.md`):

```markdown
# <Diagram Title>

*Generated from `/ask` query: "<original question>"*

```mermaid
<diagram content>
```​

## Sources
- [[article-1]] — <what it contributed to the diagram>
- [[article-2]] — <what it contributed>
```

3. Reference the diagram in your terminal answer: "I've also generated a diagram at `wiki/diagram-<name>.md` that you can view in Obsidian."

Only generate diagrams when they genuinely add clarity. Simple factual questions don't need diagrams.

### 4. Handle Missing Information

If the wiki doesn't contain enough information to answer the question:
- Say what you did find and where the gaps are
- Suggest what raw sources might help (e.g., "Adding a paper on X to the `agent-design` topic would help answer this")
- Offer to search the web for supplementary information

## Principles

- Always start from the indexes — don't scan the filesystem
- Cite your sources with [[wikilinks]]
- Cross-reference across topics when relevant
- Be honest about gaps in the knowledge base
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add skills/ask/SKILL.md
git commit -m "feat: add /ask skill for querying the knowledge base"
```

---

### Task 11: `/lint` Skill

**Files:**
- Create: `skills/lint/SKILL.md`

- [ ] **Step 1: Create skills/lint/SKILL.md**

```markdown
---
name: lint
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

- `/lint <topic>` — Lint a specific topic
- `/lint` — Lint all topics

## Behavior

Run four checks, then write a report.

### Check 1: Consistency

For each topic being linted:
1. Read all wiki articles in the topic
2. Look for contradictory claims between articles (e.g., article A says "X uses approach Y" while article B says "X uses approach Z")
3. When a contradiction is found, check the raw sources cited by each article to determine which is correct
4. Report each contradiction with:
   - The two conflicting statements and their article sources
   - Which raw source supports which claim
   - Suggested resolution

### Check 2: Completeness

1. Scan all wiki articles for `[[wikilinks]]` that point to articles that don't exist (broken links)
2. Check if any raw sources in `raw/` (excluding `_archive/`) are not listed in `_index.md` at all (orphaned sources)
3. Identify articles that are very short (under 100 words) or cite only a single source — these may need more depth
4. Report:
   - Broken wikilinks and what article they should point to
   - Orphaned raw sources that need to be compiled or removed
   - Thin articles that could benefit from more sources

### Check 3: Connections

1. Read articles across ALL topics (not just the one being linted)
2. Look for concepts that appear in multiple topics but aren't cross-linked
3. Suggest new `[[topic/article]]` cross-links where topics share related concepts
4. Suggest potential new bridging articles that could connect topics
5. Report:
   - Missing cross-links with specific article pairs
   - Suggested new articles with proposed titles and brief rationale

### Check 4: Staleness

1. For each compiled raw source in `_index.md`, check if the file's modification date is newer than the compiled date listed in the index
2. Flag articles whose underlying sources have changed since last compile
3. Look for raw sources that are contradicted by newer sources — these are candidates for `_archive/`
4. Report:
   - Sources needing recompilation (with file paths and dates)
   - Archive candidates with explanation of why they appear outdated

## Writing the Report

Write the report to `$KNOWLEDGE_BASE/_health.md` (or `$KNOWLEDGE_BASE/topics/<topic>/_health.md` if linting a single topic):

```markdown
# Health Report — <YYYY-MM-DD>

## Critical (action needed)

Items that affect wiki accuracy or indicate broken content.

- **Contradiction:** [[article-a]] says "X" but [[article-b]] says "Y". Raw source `raw/docs/paper.md` supports "X". **Suggested fix:** Update [[article-b]].
- **Broken link:** [[nonexistent-article]] referenced in [[some-article]] — article does not exist.

## Warnings

Items that indicate potential quality issues.

- **Thin article:** [[some-concept]] has only 45 words and cites 1 source. Consider enriching with additional sources.
- **Stale:** `raw/documents/old-report.md` was modified on 2026-04-01 but was last compiled on 2026-03-15. Run `/compile` to update.

## Suggestions

Opportunities to improve the knowledge base.

- **Cross-link:** [[agent-design/tool-use-patterns]] and [[coding-project/api-design]] both discuss API abstraction patterns — consider cross-linking.
- **New article candidate:** "Prompt Engineering Techniques" appears across 3 topics but has no dedicated article.
- **Archive candidate:** `raw/documents/draft-v1.md` appears to be superseded by `raw/documents/draft-v2.md`.
```

## After the Report

Tell the user:
- Summary of findings (e.g., "Found 2 critical issues, 3 warnings, and 4 suggestions")
- Suggest specific actions: "Run `/compile <topic>` to fix stale articles" or "Review archive candidates and confirm with me"
- Ask if they'd like to act on any of the findings

## Principles

- Never auto-fix. The user decides what to act on.
- Be specific — cite exact articles, exact raw sources, exact wikilinks
- Prioritize correctly — contradictions are critical, missing cross-links are suggestions
- When suggesting archives, explain why the source appears outdated
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nael/Projects/claude-knowledge-plugin
git add skills/lint/SKILL.md
git commit -m "feat: add /lint skill for knowledge base health checks"
```

---

### Task 12: Integration Test — Full Workflow

This task validates the entire system end-to-end. All commands run in Claude Code with the plugin installed.

- [ ] **Step 1: Set environment variable**

```bash
export KNOWLEDGE_BASE="/Users/nael/Projects/knowledge"
```

- [ ] **Step 2: Initialize the knowledge base**

Run: `/init`
Verify: `$KNOWLEDGE_BASE` has CLAUDE.md, _index.md, .obsidian/, .gitignore, and is a git repo

- [ ] **Step 3: Create a topic**

Run: `/topic create agent-design`
Verify: Directory structure exists at `topics/agent-design/`, root `_index.md` updated

- [ ] **Step 4: Ingest a few sources**

Run the following in Claude Code:
1. `/ingest agent-design "Agents use a loop of observe-think-act to accomplish tasks. The key insight is that tool use enables grounding."`
2. `/ingest agent-design "ReAct combines reasoning and acting in LLMs. The agent generates reasoning traces AND task-specific actions in an interleaved manner."`
3. `/ingest agent-design "Planning is critical for complex tasks. Tree-of-thought prompting explores multiple reasoning paths before committing to one."`

Verify: Three `.md` files in `topics/agent-design/raw/notes/`, all listed as pending in `wiki/_index.md`

- [ ] **Step 5: Compile**

Run: `/compile agent-design`
Verify:
- Wiki articles created in `topics/agent-design/wiki/`
- Articles contain wikilinks and Sources sections
- `wiki/_index.md` shows sources as compiled, articles listed

- [ ] **Step 6: Ask a question**

Run: `/ask "How do agent loops relate to planning strategies?"`
Verify: Answer references specific wiki articles, draws connections

- [ ] **Step 7: Run lint**

Run: `/lint agent-design`
Verify: `_health.md` created with sections for critical/warnings/suggestions

- [ ] **Step 8: Verify in Obsidian**

Open `$KNOWLEDGE_BASE` as an Obsidian vault. Verify:
- Wiki articles are visible and rendered
- Wikilinks are clickable
- Graph view shows connections between articles
