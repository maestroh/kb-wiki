import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
export type Message = ChatCompletionMessageParam;

export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown>; }
export interface ToolCall { id: string; name: string; arguments: any; }
export interface LLMRequest { messages: Message[]; tools?: ToolDefinition[]; temperature?: number; maxTokens?: number; toolChoice?: "auto"|"none"|"required"; }
export interface LLMResponse { content: string; toolCalls?: ToolCall[]; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
export interface LLMChunk { content?: string; toolCall?: { name: string; arguments: any }; done?: boolean; }
export interface LLMClient { complete(r: LLMRequest): Promise<LLMResponse>; stream(r: LLMRequest): AsyncGenerator<LLMChunk>; }

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "done"; response: string; messages: Message[] };

export interface ChatInput { history: Message[]; message: string; }
export interface MemoryConfig { kbPath: string; gitToken?: string; }
export interface GuardsConfig { maxSteps?: number; maxTokens?: number; }
export interface CompileConfig { threshold?: number; model?: string; }
export interface AgentConfig {
  llm: LLMClient;
  skills?: { paths: string[] };
  memory: MemoryConfig;
  systemPrompt?: string;
  guards?: GuardsConfig;
  compile?: CompileConfig;
}
