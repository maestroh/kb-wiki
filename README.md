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
