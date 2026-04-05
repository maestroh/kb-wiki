# Claude Knowledge Plugin

A Claude Code plugin for managing LLM-maintained personal knowledge bases.

## Setup

### 1. Install the plugin

```bash
# Add the marketplace
claude plugin marketplace add maestroh/kb-wiki

# Install the plugin
claude plugin install claude-knowledge-plugin@claude-knowledge-plugin
```

### 2. Set the environment variable

Add this to your `~/.zshrc` (or shell profile):

```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

Then restart your shell or run `source ~/.zshrc`.

### 3. Initialize your knowledge base

Open any repo in Claude Code and run:

```
/kb-init
```

This creates your knowledge base at the path you configured. You can then open `$KNOWLEDGE_BASE` as an [Obsidian](https://obsidian.md) vault.

## Skills

- `/kb-init [path]` — Initialize a new knowledge base
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
