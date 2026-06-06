import OpenAI from 'openai';
import type { LLMRequest, LLMResponse, LLMChunk, LLMClient, ToolDefinition } from '../types';
import { logger } from './logger';

/**
 * OpenAI-compatible LLM client configuration
 */
export interface OpenAIClientConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
}

/**
 * OpenAI-compatible LLM client
 *
 * Handles all interactions with the LLM via OpenAI SDK.
 * Works with OpenAI and any OpenAI-compatible API (DeepInfra, etc.)
 */
export class OpenAIClient implements LLMClient {
  private config: OpenAIClientConfig;
  private client: OpenAI;

  constructor(config: OpenAIClientConfig) {
    this.config = config;

    // Initialize OpenAI client; if no baseURL provided, let the SDK use its own default
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });

    logger.info('OpenAIClient initialized', {
      baseURL: config.baseURL ?? '(sdk default)',
      model: config.model || 'default',
    });
  }

  /**
   * Send a request and get complete response
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    try {
      const completion = await this.client.chat.completions.create({
        model: this.config.model || 'gpt-3.5-turbo',
        messages: request.messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        tools: request.tools ? this.convertToolsToOpenAIFormat(request.tools) : undefined,
        tool_choice: request.toolChoice,
      });

      const choice = completion.choices[0];
      const content = choice?.message?.content || '';
      const toolCalls = choice?.message?.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      // DIAGNOSTIC: non-streaming complete() latency + token usage
      logger.info('[LLM] complete() diagnostic', {
        model: this.config.model,
        durationMs: Date.now() - startTime,
        finishReason: choice?.finish_reason,
        hadToolCall: !!(toolCalls && toolCalls.length > 0),
        toolsOffered: request.tools?.map(t => t.name) || [],
        maxTokensSet: request.maxTokens ?? null,
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        contentLength: content.length,
      });

      return {
        content,
        toolCalls,
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
      };
    } catch (error) {
      logger.error('LLM completion error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Stream a request and yield response chunks
   */
  async *stream(request: LLMRequest): AsyncGenerator<LLMChunk> {
    // Generate unique trace ID for this request
    const traceId = `llm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      const systemPromptLength = request.messages
        .filter(m => m.role === 'system')
        .reduce((len, m) => len + (typeof m.content === 'string' ? m.content.length : 0), 0);

      logger.info('[LLM] Request', {
        traceId,
        model: this.config.model,
        tools: request.tools?.map(t => t.name) || [],
        messageCount: request.messages.length,
        systemPromptLength,
      });

      const stream = await this.client.chat.completions.create({
        model: this.config.model || 'gpt-3.5-turbo',
        messages: request.messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        tools: request.tools ? this.convertToolsToOpenAIFormat(request.tools) : undefined,
        stream: true,
      });

      // Accumulate tool call arguments since they come in chunks
      const toolCallAccumulators: Map<number, { name: string; arguments: string }> = new Map();

      let chunkCount = 0;
      let accumulatedContent = '';

      for await (const chunk of stream) {
        chunkCount++;
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta?.content) {
          accumulatedContent += delta.content;
          yield { content: delta.content };
        }

        // Accumulate tool call data
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;

            if (!toolCallAccumulators.has(index)) {
              toolCallAccumulators.set(index, { name: '', arguments: '' });
            }

            const acc = toolCallAccumulators.get(index)!;

            if (toolCall.function?.name) {
              acc.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              acc.arguments += toolCall.function.arguments;
            }
          }
        }

        // When stream is complete, yield accumulated tool calls
        if (finishReason) {
          const toolNames = [...toolCallAccumulators.values()].map(a => a.name).filter(Boolean);

          logger.info('[LLM] Response', {
            traceId,
            finishReason,
            chunks: chunkCount,
            contentLength: accumulatedContent.length,
            toolCalls: toolNames,
          });

          logger.debug('[LLM] Response content', {
            traceId,
            content: accumulatedContent.substring(0, 200),
          });

          // Yield all accumulated tool calls
          for (const [index, acc] of toolCallAccumulators) {
            if (acc.name) {
              try {
                const parsedArgs = acc.arguments ? JSON.parse(acc.arguments) : {};

                yield {
                  toolCall: {
                    name: acc.name,
                    arguments: parsedArgs,
                  },
                };
              } catch (parseError) {
                logger.error('[LLM] Failed to parse tool call arguments', {
                  traceId,
                  index,
                  name: acc.name,
                  rawArguments: acc.arguments.substring(0, 200),
                  error: parseError instanceof Error ? parseError.message : 'Unknown error',
                });
              }
            }
          }

          yield { done: true };
        }
      }
    } catch (error) {
      logger.error('[LLM] Streaming error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Convert our tool definitions to OpenAI function calling format
   */
  private convertToolsToOpenAIFormat(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Get current model being used
   */
  getModel(): string {
    return this.config.model || 'gpt-3.5-turbo';
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OpenAIClientConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('OpenAIClient configuration updated', config);
  }
}
