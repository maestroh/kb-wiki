export const version = "0.1.0";

// ---------------------------------------------------------------------------
// Core factory + Agent interface
// ---------------------------------------------------------------------------
export { createAgent } from "./agent.js";
export type { Agent } from "./agent.js";
// SyncResult is the return type of Agent.sync() — re-exported so hosts can
// type the result without reaching into internal modules.
export type { SyncResult } from "./memory/index.js";

// ---------------------------------------------------------------------------
// LLM client implementation (hosts can supply a custom LLMClient instead)
// ---------------------------------------------------------------------------
export { OpenAIClient } from "./llm/openai-client.js";

// ---------------------------------------------------------------------------
// Public types — the minimal surface hosts need to implement a custom client,
// build chat UIs, or extend the agent. Internal memory/loop/skills are NOT
// exported here.
// ---------------------------------------------------------------------------
export type {
  AgentConfig,
  AgentEvent,
  ChatInput,
  Message,
  LLMClient,
  LLMRequest,
  LLMResponse,
  LLMChunk,
  ToolDefinition,
  ToolCall,
  MemoryConfig,
  GuardsConfig,
  CompileConfig,
} from "./types.js";
