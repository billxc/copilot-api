import { describe, expect, test } from "bun:test"

import type { GeminiStreamState } from "~/routes/gemini/gemini-types"
import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import { translateChunkToGemini } from "~/routes/gemini/stream-translation"

const base: ChatCompletionChunk = {
  id: "chat_1",
  object: "chat.completion.chunk",
  created: 0,
  model: "gpt-4.1",
  choices: [],
}

describe("Gemini streaming translation", () => {
  test("emits text immediately and preserves candidate indexes", () => {
    const state: GeminiStreamState = {
      toolCalls: new Map(),
      candidateFinished: new Map(),
    }
    const result = translateChunkToGemini(
      {
        ...base,
        choices: [
          {
            index: 1,
            delta: { content: "Hello" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      state,
    )
    expect(result?.candidates).toEqual([
      { index: 1, content: { role: "model", parts: [{ text: "Hello" }] } },
    ])
  })

  test("buffers fragmented parallel function arguments until the candidate finishes", () => {
    const state: GeminiStreamState = {
      toolCalls: new Map(),
      candidateFinished: new Map(),
    }
    const first = translateChunkToGemini(
      {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  function: { name: "read_file", arguments: '{"path":' },
                },
                {
                  index: 1,
                  id: "call_b",
                  function: { name: "read_file", arguments: '{"path":"b.ts"}' },
                },
              ],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      state,
    )
    expect(first).toBeUndefined()
    const final = translateChunkToGemini(
      {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }],
            },
            finish_reason: "tool_calls",
            logprobs: null,
          },
        ],
      },
      state,
    )
    expect(final?.candidates).toEqual([
      {
        index: 0,
        content: {
          role: "model",
          parts: [
            {
              functionCall: {
                id: "call_a",
                name: "read_file",
                args: { path: "a.ts" },
              },
            },
            {
              functionCall: {
                id: "call_b",
                name: "read_file",
                args: { path: "b.ts" },
              },
            },
          ],
        },
        finishReason: "STOP",
      },
    ])
    expect(state.toolCalls.size).toBe(0)
  })

  test("emits usage-only events without a fake candidate", () => {
    const result = translateChunkToGemini(
      {
        ...base,
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
      { toolCalls: new Map(), candidateFinished: new Map() },
    )
    expect(result?.usageMetadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 2,
      totalTokenCount: 12,
    })
    expect(result?.candidates).toBeUndefined()
  })

  test("does not emit role-only events or conceal invalid function JSON", () => {
    const state: GeminiStreamState = {
      toolCalls: new Map(),
      candidateFinished: new Map(),
    }
    expect(
      translateChunkToGemini(
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
              logprobs: null,
            },
          ],
        },
        state,
      ),
    ).toBeUndefined()
    expect(() =>
      translateChunkToGemini(
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { name: "bad", arguments: "{" } },
                ],
              },
              finish_reason: "tool_calls",
              logprobs: null,
            },
          ],
        },
        state,
      ),
    ).toThrow()
  })
})

describe("Gemini interrupted function calls", () => {
  test.each([
    { reason: "length", expected: "MAX_TOKENS" },
    { reason: "content_filter", expected: "SAFETY" },
  ] as const)(
    "preserves $reason and usage for interrupted function arguments",
    ({ reason, expected }) => {
      const result = translateChunkToGemini(
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { name: "read_file", arguments: '{"path":' },
                  },
                ],
              },
              finish_reason: reason,
              logprobs: null,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        },
        { toolCalls: new Map(), candidateFinished: new Map() },
      )
      expect(result?.candidates?.[0].finishReason).toBe(expected)
      expect(result?.candidates?.[0].content.parts).toEqual([])
      expect(result?.usageMetadata?.totalTokenCount).toBe(12)
    },
  )
})
