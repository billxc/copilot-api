import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import consola from "consola"
import { Hono } from "hono"

import type { Model } from "~/services/copilot/get-models"

import { state } from "~/lib/state"
import { geminiRoutes } from "~/routes/gemini/route"

const model: Model = {
  id: "gpt-4.1",
  name: "GPT 4.1",
  object: "model",
  vendor: "OpenAI",
  version: "1",
  model_picker_enabled: true,
  preview: false,
  capabilities: {
    family: "gpt",
    type: "chat",
    object: "model_capabilities",
    tokenizer: "o200k_base",
    limits: { max_output_tokens: 100, max_prompt_tokens: 1000 },
    supports: { tool_calls: true },
  },
}
const completion = {
  id: "chat_1",
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
  usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
}
const app = new Hono().route("/v1beta", geminiRoutes).route("/v1", geminiRoutes)
const savedState = { ...state }
let fetchSpy = spyOn(globalThis, "fetch")
let bodies: Array<Record<string, unknown>> = []

function mockFetch(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(handler, { preconnect: globalThis.fetch.preconnect })
}

function readBody(
  options: Parameters<typeof fetch>[1],
): Record<string, unknown> {
  if (typeof options?.body !== "string")
    throw new Error("Expected a JSON request body.")
  return JSON.parse(options.body) as Record<string, unknown>
}

beforeEach(() => {
  bodies = []
  Object.assign(state, {
    copilotToken: "test-token",
    models: { data: [model], object: "list" },
    manualApprove: false,
    rateLimitSeconds: undefined,
  })
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    mockFetch((input, options) => {
      if (typeof input === "string" && input.endsWith("/models"))
        return Promise.resolve(Response.json({ data: [model], object: "list" }))
      bodies.push(readBody(options))
      return Promise.resolve(Response.json(completion))
    }),
  )
})

afterEach(() => {
  fetchSpy.mockRestore()
  Object.assign(state, savedState, {
    rateLimitSeconds: savedState.rateLimitSeconds,
    lastRequestTimestamp: savedState.lastRequestTimestamp,
    models: savedState.models,
  })
})

function post(
  action: string,
  body: unknown = { contents: [{ parts: [{ text: "Hi" }] }] },
  prefix = "/v1beta",
) {
  return app.request(`${prefix}/models/gpt-4.1:${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Gemini HTTP compatibility", () => {
  test.each(["/v1beta", "/v1"])(
    "generates through %s and caps output tokens",
    async (prefix) => {
      const response = await post(
        "generateContent",
        {
          contents: [{ parts: [{ text: "Hi" }] }],
          generationConfig: { maxOutputTokens: 65536 },
        },
        prefix,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: "STOP",
          },
        ],
      })
      expect(bodies[0]).toMatchObject({
        model: "gpt-4.1",
        max_tokens: 100,
        stream: false,
      })
    },
  )

  test("streams Gemini SSE and includes usage without an OpenAI terminator", async () => {
    fetchSpy.mockImplementation(
      mockFetch((_input, options) => {
        bodies.push(readBody(options))
        const base = {
          id: "chat_1",
          object: "chat.completion.chunk",
          model: "gpt-4.1",
          created: 0,
        }
        return Promise.resolve(
          new Response(
            [
              {
                ...base,
                choices: [
                  {
                    index: 0,
                    delta: { content: "Hello" },
                    finish_reason: null,
                  },
                ],
              },
              {
                ...base,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              },
              { ...base, choices: [], usage: completion.usage },
            ]
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          ),
        )
      }),
    )
    const response = await post("streamGenerateContent?alt=sse")
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const text = await response.text()
    expect(text).toContain('"text":"Hello"')
    expect(text).toContain('"totalTokenCount":11')
    expect(text).not.toContain("[DONE]")
    expect(bodies[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  test("returns INVALID_ARGUMENT for malformed JSON and empty requests", async () => {
    const malformed = await app.request(
      "/v1beta/models/gpt-4.1:generateContent",
      { method: "POST", body: "{" },
    )
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({
      error: { code: 400, status: "INVALID_ARGUMENT" },
    })
    expect((await post("generateContent", {})).status).toBe(400)
    expect(bodies).toHaveLength(0)
  })

  test("preserves upstream error status in a Google error envelope", async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"error":{"message":"Quota exhausted"}}', { status: 429 }),
    )
    const response = await post("generateContent")
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exhausted",
      },
    })
  })

  test("honors the shared rate limit without contacting Copilot", async () => {
    state.rateLimitSeconds = 60
    state.lastRequestTimestamp = Date.now()
    const response = await post("generateContent")
    expect(response.status).toBe(429)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("honors manual approval rejection without contacting Copilot", async () => {
    state.manualApprove = true
    const prompt = spyOn(consola, "prompt").mockResolvedValue(false)
    try {
      expect((await post("generateContent")).status).toBe(403)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      prompt.mockRestore()
    }
  })

  test("discovers models and retrieves Gemini model metadata", async () => {
    const response = await app.request("/v1beta/models")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      models: [
        {
          name: "models/gpt-4.1",
          displayName: "GPT 4.1",
          inputTokenLimit: 1000,
          outputTokenLimit: 100,
          supportedGenerationMethods: [
            "generateContent",
            "streamGenerateContent",
            "countTokens",
          ],
        },
      ],
    })
    expect((await app.request("/v1/models/gpt-4.1")).status).toBe(200)
    expect((await app.request("/v1beta/models/missing")).status).toBe(404)
  })

  test("falls back to cached model metadata if refresh fails", async () => {
    fetchSpy.mockRejectedValue(new Error("Offline"))
    expect((await app.request("/v1beta/models")).status).toBe(200)
    state.models = undefined
    expect((await app.request("/v1beta/models")).status).toBe(500)
  })

  test("counts all history locally, including wrapped generateContentRequest", async () => {
    const contents = [{ parts: [{ text: "Hello" }] }]
    const first = await post("countTokens", { contents })
    const result = (await first.json()) as { totalTokens: number }
    expect(result.totalTokens).toBeGreaterThan(0)
    const second = await post("countTokens", {
      generateContentRequest: {
        contents: [
          ...contents,
          {
            role: "model",
            parts: [{ text: "A much longer answer with several words" }],
          },
        ],
      },
    })
    expect(
      ((await second.json()) as { totalTokens: number }).totalTokens,
    ).toBeGreaterThan(result.totalTokens)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("rejects unknown actions", async () => {
    expect((await post("unknown")).status).toBe(404)
  })
})

describe("Gemini stream termination", () => {
  test.each([
    { ending: "", name: "EOF" },
    { ending: "data: [DONE]\n\n", name: "DONE" },
  ])(
    "rejects text terminated by $name without a finish reason",
    async ({ ending }) => {
      const chunk = {
        id: "chat_1",
        model: "gpt-4.1",
        choices: [
          { index: 0, delta: { content: "partial" }, finish_reason: null },
        ],
      }
      fetchSpy.mockResolvedValue(
        new Response(`data: ${JSON.stringify(chunk)}\n\n${ending}`, {
          headers: { "content-type": "text/event-stream" },
        }),
      )
      const text = await (await post("streamGenerateContent?alt=sse")).text()
      expect(text).toContain('"text":"partial"')
      expect(text).toContain('"status":"INTERNAL"')
    },
  )

  test("requires every candidate to finish", async () => {
    const chunk = {
      id: "chat_1",
      model: "gpt-4.1",
      choices: [
        { index: 0, delta: { content: "complete" }, finish_reason: "stop" },
        { index: 1, delta: { content: "partial" }, finish_reason: null },
      ],
    }
    fetchSpy.mockResolvedValue(
      new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
    )
    expect(
      await (await post("streamGenerateContent?alt=sse")).text(),
    ).toContain('"status":"INTERNAL"')
  })

  test("reports an empty upstream stream as an error", async () => {
    fetchSpy.mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    )
    expect(
      await (await post("streamGenerateContent?alt=sse")).text(),
    ).toContain('"status":"INTERNAL"')
  })
})
