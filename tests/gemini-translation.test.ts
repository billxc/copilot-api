import { describe, expect, test } from "bun:test"

import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import {
  translateToGemini,
  translateToOpenAI,
} from "~/routes/gemini/non-stream-translation"

describe("Gemini request translation", () => {
  test("translates instructions, history, images, and generation settings", () => {
    const result = translateToOpenAI(
      {
        systemInstruction: { parts: [{ text: "Be helpful." }] },
        contents: [
          { role: "user", parts: [{ text: "Hello" }] },
          { role: "model", parts: [{ text: "Hi" }] },
          {
            parts: [
              { text: "Describe this" },
              { inlineData: { mimeType: "image/png", data: "YWJj" } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 100,
          temperature: 0.3,
          topP: 0.9,
          stopSequences: ["END"],
          candidateCount: 2,
          responseMimeType: "application/json",
        },
      },
      "gpt-4.1",
      true,
    )
    expect(result).toMatchObject({
      model: "gpt-4.1",
      stream: true,
      max_tokens: 100,
      temperature: 0.3,
      top_p: 0.9,
      stop: ["END"],
      n: 2,
      response_format: { type: "json_object" },
    })
    expect(result.messages).toEqual([
      { role: "system", content: "Be helpful." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,YWJj" },
          },
        ],
      },
    ])
  })

  test("translates native tools and matches parallel same-name results without IDs", () => {
    const result = translateToOpenAI(
      {
        contents: [
          { role: "user", parts: [{ text: "Read two files" }] },
          {
            role: "model",
            parts: [
              { text: "private", thought: true },
              { functionCall: { name: "read_file", args: { path: "a.ts" } } },
              { functionCall: { name: "read_file", args: { path: "b.ts" } } },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "read_file",
                  response: { text: "a" },
                },
              },
              {
                functionResponse: {
                  name: "read_file",
                  response: { text: "b" },
                },
              },
              { text: "Summarize" },
            ],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: "read_file",
                description: "Read",
                parametersJsonSchema: { type: "object" },
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: ["read_file"],
          },
        },
      },
      "gpt-4.1",
    )
    expect(result.tools).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read",
          parameters: { type: "object" },
        },
      },
    ])
    expect(result.tool_choice).toEqual({
      type: "function",
      function: { name: "read_file" },
    })
    const calls = result.messages[1].tool_calls ?? []
    expect(calls).toHaveLength(2)
    expect(calls[0].id).not.toBe(calls[1].id)
    expect(result.messages[1].content).toBeNull()
    expect(result.messages[2]).toEqual({
      role: "tool",
      tool_call_id: calls[0].id,
      content: '{"text":"a"}',
    })
    expect(result.messages[3]).toEqual({
      role: "tool",
      tool_call_id: calls[1].id,
      content: '{"text":"b"}',
    })
    expect(result.messages[4]).toEqual({ role: "user", content: "Summarize" })
  })

  test("retains explicit function IDs and normalizes Gemini schema types", () => {
    const result = translateToOpenAI(
      {
        contents: [
          {
            role: "model",
            parts: [
              { functionCall: { id: "call_123", name: "lookup", args: {} } },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_123",
                  name: "lookup",
                  response: { ok: true },
                },
              },
            ],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookup",
                parameters: {
                  type: "OBJECT",
                  properties: { query: { type: "STRING" } },
                },
              },
            ],
          },
        ],
      },
      "gpt-4.1",
    )
    expect(result.messages[1].tool_call_id).toBe("call_123")
    expect(result.tools?.[0].function.parameters).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
    })
  })

  test.each(["NONE", "AUTO", "ANY"])("maps %s function calling", (mode) => {
    const result = translateToOpenAI(
      {
        contents: [{ parts: [{ text: "Hi" }] }],
        toolConfig: { functionCallingConfig: { mode } },
      },
      "gpt-4.1",
    )
    expect(result.tool_choice).toBe(
      ({ NONE: "none", AUTO: "auto", ANY: "required" } as const)[
        mode as "NONE" | "AUTO" | "ANY"
      ],
    )
  })
})

describe("Gemini input validation and agy history", () => {
  test("orders parallel tool results before interleaved user text", () => {
    const result = translateToOpenAI(
      {
        contents: [
          {
            role: "model",
            parts: [
              { functionCall: { id: "first", name: "read_file", args: {} } },
              { functionCall: { id: "second", name: "read_file", args: {} } },
            ],
          },
          {
            role: "user",
            parts: [
              { text: "Before " },
              {
                functionResponse: {
                  id: "first",
                  name: "read_file",
                  response: { output: "a" },
                },
              },
              { text: "between " },
              {
                functionResponse: {
                  id: "second",
                  name: "read_file",
                  response: { output: "b" },
                },
              },
              { text: "after" },
            ],
          },
        ],
      },
      "gpt-4.1",
    )
    expect(result.messages.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
      "tool",
      "user",
    ])
    expect(result.messages[3].content).toBe("Before between after")
  })

  test("accepts agy function results carried in the model role", () => {
    const result = translateToOpenAI(
      {
        contents: [
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "call_read",
                  name: "read_file",
                  args: { Path: "test.txt" },
                },
              },
            ],
          },
          {
            role: "model",
            parts: [
              {
                functionResponse: {
                  id: "call_read",
                  name: "read_file",
                  response: { output: "fixture" },
                },
              },
            ],
          },
        ],
      },
      "gpt-4.1",
    )
    expect(result.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_read",
      content: '{"output":"fixture"}',
    })
  })

  test.each([
    null,
    {},
    { contents: [] },
    { contents: [{ role: "system", parts: [{ text: "Hi" }] }] },
    { contents: [{ parts: [] }] },
    {
      contents: [
        { parts: [{ inlineData: { mimeType: "audio/wav", data: "abc" } }] },
      ],
    },
    { contents: [{ parts: [{ fileData: { fileUri: "gs://file" } }] }] },
    {
      contents: [
        { parts: [{ functionResponse: { name: "missing", response: {} } }] },
      ],
    },
  ])("rejects malformed or unsupported content %#", (payload) => {
    expect(() => translateToOpenAI(payload, "gpt-4.1")).toThrow()
  })
})

describe("Gemini schema handling", () => {
  test.each(["responseSchema", "responseJsonSchema"])(
    "explicitly rejects unsupported %s constraints",
    (key) => {
      expect(() =>
        translateToOpenAI(
          {
            contents: [{ parts: [{ text: "Hi" }] }],
            generationConfig: {
              responseMimeType: "application/json",
              [key]: {
                type: "object",
                properties: { count: { type: "integer" } },
                required: ["count"],
              },
            },
          },
          "gpt-4.1",
        ),
      ).toThrow("Schema-constrained output is not supported.")
    },
  )

  test("rejects inherited object keys as function calling modes", () => {
    expect(() =>
      translateToOpenAI(
        {
          contents: [{ parts: [{ text: "Hi" }] }],
          toolConfig: { functionCallingConfig: { mode: "toString" } },
        },
        "gpt-4.1",
      ),
    ).toThrow()
  })

  test("passes JSON Schema through without rewriting literal type fields", () => {
    const schema = {
      type: "object",
      properties: {
        value: {
          const: { type: "UPPER" },
          enum: [{ type: "UPPER" }],
          default: { type: "UPPER" },
        },
      },
    }
    const result = translateToOpenAI(
      {
        contents: [{ parts: [{ text: "Hi" }] }],
        tools: [
          {
            functionDeclarations: [
              { name: "lookup", parametersJsonSchema: schema },
            ],
          },
        ],
      },
      "gpt-4.1",
    )
    expect(result.tools?.[0].function.parameters).toEqual(schema)
  })

  test("normalizes only actual legacy Gemini schema nodes", () => {
    const result = translateToOpenAI(
      {
        contents: [{ parts: [{ text: "Hi" }] }],
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookup",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    value: {
                      type: "OBJECT",
                      properties: { type: { type: "STRING" } },
                      default: { type: "UPPER" },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      "gpt-4.1",
    )
    expect(result.tools?.[0].function.parameters).toEqual({
      type: "object",
      properties: {
        value: {
          type: "object",
          properties: { type: { type: "string" } },
          default: { type: "UPPER" },
        },
      },
    })
  })
})

describe("Gemini response translation", () => {
  const response: ChatCompletionResponse = {
    id: "chat_123",
    object: "chat.completion",
    created: 0,
    model: "gpt-4.1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello" },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 3 },
    },
  }

  test("preserves text, model, response ID, finish reason, and usage", () => {
    expect(translateToGemini(response)).toEqual({
      candidates: [
        {
          index: 0,
          content: { role: "model", parts: [{ text: "Hello" }] },
          finishReason: "STOP",
        },
      ],
      modelVersion: "gpt-4.1",
      responseId: "chat_123",
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
        cachedContentTokenCount: 3,
      },
    })
  })

  test.each([
    { reason: "length", expected: "MAX_TOKENS" },
    { reason: "content_filter", expected: "SAFETY" },
    { reason: "tool_calls", expected: "STOP" },
  ] as const)("maps $reason finish reason", ({ reason, expected }) => {
    expect(
      translateToGemini({
        ...response,
        choices: [{ ...response.choices[0], finish_reason: reason }],
      }).candidates?.[0].finishReason,
    ).toBe(expected)
  })

  test("translates function calls into structured arguments", () => {
    const result = translateToGemini({
      ...response,
      choices: [
        {
          ...response.choices[0],
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: '{"path":"test.ts"}',
                },
              },
            ],
          },
        },
      ],
    })
    expect(result.candidates?.[0].content.parts).toEqual([
      {
        functionCall: {
          id: "call_1",
          name: "read_file",
          args: { path: "test.ts" },
        },
      },
    ])
  })

  test.each([
    { reason: "length", expected: "MAX_TOKENS" },
    { reason: "content_filter", expected: "SAFETY" },
  ] as const)(
    "preserves $reason and usage for incomplete function arguments",
    ({ reason, expected }) => {
      const result = translateToGemini({
        ...response,
        choices: [
          {
            ...response.choices[0],
            finish_reason: reason,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "partial",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      })
      expect(result.candidates?.[0].finishReason).toBe(expected)
      expect(result.candidates?.[0].content.parts).toEqual([])
      expect(result.usageMetadata?.totalTokenCount).toBe(15)
    },
  )
})
