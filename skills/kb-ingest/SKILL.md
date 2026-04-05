---
name: kb-ingest
description: Add source material (files, URLs, or notes) to a knowledge base topic. Preprocesses documents into markdown.
---

# Ingest Source Material

Add raw source material to a topic's `raw/` directory, optionally preprocessing it into markdown.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

The plugin root is at `${CLAUDE_PLUGIN_ROOT}` (set automatically by Claude Code).

## Usage

`/kb-ingest <topic> <source>`

Where `<source>` is one of:
- A file path (absolute or relative to current directory)
- A URL (starts with `http://` or `https://`)
- Inline text (anything else — saved as a timestamped note)

## Behavior

### 1. Validate

- Check `$KNOWLEDGE_BASE` is set and exists
- Check `topics/<topic>` exists. If not, ask the user if they want to create it (run the `/kb-topic` skill logic)

### 2. Determine Input Type and Process

**If source is a file path:**

Detect the file type by extension and process accordingly:

| Extension | Destination | Preprocessing |
|-----------|-------------|---------------|
| `.md` | `raw/notes/` | None — copy as-is |
| `.txt` | `raw/notes/` | None — copy as-is |
| `.pdf` | `raw/documents/` | Run: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/preprocess-pdf.ts" <file> <output-dir>` |
| `.docx` | `raw/documents/` | Run: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/preprocess-pdf.ts" <file> <output-dir>` |
| `.pptx` | `raw/documents/` | Run: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/preprocess-pdf.ts" <file> <output-dir>` |
| `.mp4`, `.mov`, `.webm`, `.mkv` | `raw/videos/` | Run: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/preprocess-video.ts" <file> <output-dir>` |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp` | `raw/images/` | None — copy as-is |
| Other | `raw/` (root) | None — copy as-is, flag as "unprocessed" |

Copy the original file to the destination directory. If a preprocessor is available and succeeds, the generated `.md` file will be placed alongside the original. If the preprocessor fails or is not installed, copy the file anyway and note it as "unprocessed" in the index.

**If source is a URL:**

Run: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/preprocess-url.ts" <url> "$KNOWLEDGE_BASE/topics/<topic>/raw/links/" "$KNOWLEDGE_BASE/topics/<topic>/raw/images/"`

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

Does NOT compile into wiki articles — that's `/kb-compile`'s job.

### 4. Confirm

Tell the user:
- What was ingested and where it was stored
- Whether preprocessing succeeded, failed, or was skipped
- Suggest running `/kb-compile <topic>` to incorporate into the wiki
