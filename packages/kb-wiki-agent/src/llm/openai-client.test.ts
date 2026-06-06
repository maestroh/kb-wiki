import { vi, test, expect } from "vitest";

// Mutable factory so each test can swap the stream without re-mocking
let mockStreamFactory: () => AsyncGenerator<unknown> = async function* () {
  yield { choices: [{ delta: { content: "hi" }, finish_reason: null }] };
  yield { choices: [{ delta: {}, finish_reason: "stop" }] };
};

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: async () => mockStreamFactory(),
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
