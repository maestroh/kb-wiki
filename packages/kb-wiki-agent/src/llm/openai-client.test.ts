import { vi, test, expect } from "vitest";

// INVARIANT: each test MUST assign the relevant mock factory before importing/constructing the client — stale factories cause cross-test pollution.

// Mutable factory so each test can swap the stream without re-mocking
let mockStreamFactory: () => AsyncGenerator<unknown> = async function* () {
  yield { choices: [{ delta: { content: "hi" }, finish_reason: null }] };
  yield { choices: [{ delta: {}, finish_reason: "stop" }] };
};

// Mutable factory for non-streaming complete() responses
let mockCompleteFactory: () => unknown = () => ({
  choices: [{ message: { content: "", tool_calls: undefined } }],
  usage: undefined,
});

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          // Branch on stream flag: streaming tests get an async generator, complete() tests get a plain object
          create: async (opts: { stream?: boolean }) =>
            opts?.stream ? mockStreamFactory() : mockCompleteFactory(),
        },
      };
    },
  };
});

test("stream yields content then done", async () => {
  // Use default factory (content stream)
  mockStreamFactory = async function* () {
    yield { choices: [{ delta: { content: "hi" }, finish_reason: null }] };
    yield { choices: [{ delta: {}, finish_reason: "stop" }] };
  };
  const { OpenAIClient } = await import("./openai-client");
  const c = new OpenAIClient({ apiKey: "x", baseURL: "http://t", model: "m" });
  const out: unknown[] = [];
  for await (const ev of c.stream({ messages: [] })) out.push(ev);
  expect(out).toContainEqual({ content: "hi" });
  expect(out.at(-1)).toEqual({ done: true });
});

test("stream yields toolCall chunk with parsed arguments", async () => {
  // Swap factory to a tool-call stream
  mockStreamFactory = async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "search_kb", arguments: '{"que' } }] }, finish_reason: null }] };
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "", arguments: 'ry":"test"}' } }] }, finish_reason: null }] };
    yield { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
  };
  const { OpenAIClient } = await import("./openai-client");
  const c = new OpenAIClient({ apiKey: "x", model: "m" });
  const out: unknown[] = [];
  for await (const ev of c.stream({ messages: [] })) out.push(ev);
  expect(out).toContainEqual({ toolCall: { name: "search_kb", arguments: { query: "test" } } });
  expect(out.at(-1)).toEqual({ done: true });
});

test("complete() happy path returns content and mapped usage", async () => {
  mockCompleteFactory = () => ({
    choices: [{ message: { content: "hello", tool_calls: undefined } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  const { OpenAIClient } = await import("./openai-client");
  const c = new OpenAIClient({ apiKey: "x", model: "m" });
  const result = await c.complete({ messages: [] });
  expect(result.content).toBe("hello");
  expect(result.toolCalls).toBeUndefined();
  expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
});

test("complete() tool-call path returns parsed ToolCall", async () => {
  mockCompleteFactory = () => ({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id: "call_1", function: { name: "search_kb", arguments: '{"query":"x"}' } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
  });
  const { OpenAIClient } = await import("./openai-client");
  const c = new OpenAIClient({ apiKey: "x", model: "m" });
  const result = await c.complete({ messages: [] });
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls![0].id).toBe("call_1");
  expect(result.toolCalls![0].name).toBe("search_kb");
  expect(result.toolCalls![0].arguments).toEqual({ query: "x" });
});
