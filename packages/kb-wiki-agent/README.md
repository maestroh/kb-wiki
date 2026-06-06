# kb-wiki-agent

A lightweight, embeddable Node package — a stateless ReAct agent that uses a [kb-wiki](https://github.com/maestroh/kb-wiki) knowledge base as long-term memory, runs skills (slash-command definitions), and exposes a streaming `chat()`. The governing principle is lightness: no framework, no daemon, no persistent process — just a factory function that returns `{ chat, run, sync }`.

---

## Install

`kb-wiki-agent` is a workspace package inside this monorepo. It depends on `kb-wiki-scripts` (also a workspace package) and runs directly from TypeScript source — there is no build step.

```json
// workspace root package.json (already wired)
"dependencies": {
  "kb-wiki-agent": "workspace:*"
}
```

Import it as:

```ts
import { createAgent, OpenAIClient } from "kb-wiki-agent";
```

The package uses `"exports": "./src/index.ts"` so consumers run via `tsx` or a bundler that resolves TypeScript sources (Vitest is pre-configured for this).

---

## Quick start

```ts
import { createAgent, OpenAIClient } from "kb-wiki-agent";
import type { AgentEvent } from "kb-wiki-agent";

const agent = createAgent({
  llm: new OpenAIClient({
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o",
    // baseURL: "https://api.deepinfra.com/v1/openai", // any OpenAI-compatible endpoint
    // temperature: 0.7,                               // optional; default 0.7
  }),
  skills: { paths: ["./skills"] },           // optional: paths to skill SKILL.md files
  memory: { kbPath: process.env.KNOWLEDGE_BASE! },
  systemPrompt: "You are a helpful assistant.",
  guards:   { maxSteps: 15 },                // default 15
  compile:  { threshold: 10 },              // default 10
});

// ── streaming ──────────────────────────────────────────────────────────────
for await (const ev of agent.chat({ history: [], message: "Set up CI; we deploy via Fly." })) {
  if (ev.type === "token")       process.stdout.write(ev.text);
  if (ev.type === "tool_call")   console.error(`→ ${ev.name}`, ev.args);
  if (ev.type === "tool_result") console.error(`← ${ev.name} ok=${ev.ok}`);
  if (ev.type === "done") {
    // ev.response — the final text string
    // ev.messages — [userMessage, assistantMessage] only; history is host-owned
  }
}

// ── non-streaming ──────────────────────────────────────────────────────────
const { response, messages } = await agent.run({
  history: [],
  message: "What is our current deployment strategy?",
});

// ── sync memory to its git remote ─────────────────────────────────────────
// The only deliberate, host-triggered memory operation:
await agent.sync();
```

### AgentEvent union

```ts
type AgentEvent =
  | { type: "token";       text: string }
  | { type: "tool_call";   name: string; args: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "done";        response: string; messages: Message[] };
```

---

## Configuration

### `createAgent(config: AgentConfig)`

| Field | Type | Default | Description |
|---|---|---|---|
| `llm` | `LLMClient` | required | LLM implementation. Use `OpenAIClient` or supply a custom `{ complete, stream }` object. |
| `skills.paths` | `string[]` | `[]` | Directories to scan for `SKILL.md` files. Omit if you have no skills. |
| `memory.kbPath` | `string` | required | Absolute path to the kb-wiki knowledge base (= the git repo root). |
| `memory.gitToken` | `string` | — | Optional HTTPS token used by `sync()` to push to the remote. |
| `systemPrompt` | `string` | — | Base system prompt. Core facts and the goal anchor are prepended automatically. |
| `guards.maxSteps` | `number` | `15` | Maximum ReAct loop iterations before a hard stop. |
| `guards.maxTokens` | `number` | — | Token budget across the conversation (optional). |
| `compile.threshold` | `number` | `10` | Pending-source count that triggers a background compile. |
| `compile.model` | `string` | — | Model override for the compile step (reserved; not yet used by the current loop). |

**`history`** is host-owned. Pass it in on every call; the agent never stores it. The `messages` returned by `chat()`/`run()` contains only `[userMessage, assistantMessage]` — splice it into your own history array.

### `new OpenAIClient(config: OpenAIClientConfig)`

| Field | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | API key for the LLM provider. |
| `model` | `string` | `"gpt-3.5-turbo"` | Model ID to use for all requests. |
| `baseURL` | `string` | SDK default (OpenAI) | Override to target DeepInfra, Together, local Ollama, etc. |
| `temperature` | `number` | `0.7` | Default sampling temperature (per-request overrides take precedence). |

---

## Environment

| Variable | Purpose |
|---|---|
| `KNOWLEDGE_BASE` | Path to the kb-wiki repo root — pass to `memory.kbPath`. |
| `OPENAI_API_KEY` (or equivalent) | LLM provider API key — pass to `OpenAIClient({ apiKey })`. |

`baseURL` and `model` are constructor arguments rather than env vars so the host retains full control.

---

## Memory is automatic

The host never operates memory directly — every exchange is deterministically pre-cleaned and ingested (capture); pending sources are compiled into synthesized wiki articles in the background once a threshold is crossed (compile); and `recall` is an internal tool the agent calls on demand, read-merging the clean wiki with still-pending raw so answers are never stale. Core facts are always injected into the system prompt. The only deliberate, host-triggered memory operation is `sync()`, which runs a git stage → commit → pull --rebase → push cycle to push the local KB to its remote.

Capture runs before the `done` event is yielded (not after), so it completes whether or not the consumer drains the generator past `done`.

---

## Testing

```bash
cd packages/kb-wiki-agent
npx vitest run
```

---

## Design docs

- [Agent Core Design](../../docs/superpowers/specs/2026-06-05-agent-core-design.html) — architecture, memory contract, ReAct loop, API rationale
- [Implementation Plan](../../docs/superpowers/plans/2026-06-05-kb-wiki-agent-plan.html) — phased plan with task breakdown
