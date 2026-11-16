import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"
import { HTTPException } from "hono/http-exception"
import { streamSSE } from "hono/streaming"

import type { Model } from "~/services/copilot/get-models"

import { awaitApproval } from "~/lib/approval"
import { HTTPError } from "~/lib/error"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { cacheModels } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
} from "~/services/copilot/create-chat-completions"

import type { GeminiStreamState } from "./gemini-types"

import {
  readObject,
  translateToGemini,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToGemini } from "./stream-translation"

export async function geminiError(error: unknown) {
  let code = 500
  if (error instanceof HTTPError) code = error.response.status
  else if (error instanceof HTTPException) code = error.status
  let message =
    error instanceof Error ? error.message : "Internal server error."
  if (error instanceof HTTPError) {
    const text = await error.response.text()
    message = text || message
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string }
        message?: string
      }
      message = body.error?.message ?? body.message ?? message
    } catch {
      message = text || message
    }
  }
  const statuses: Record<number, string> = {
    400: "INVALID_ARGUMENT",
    401: "UNAUTHENTICATED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    429: "RESOURCE_EXHAUSTED",
    500: "INTERNAL",
    502: "UNAVAILABLE",
    503: "UNAVAILABLE",
    504: "DEADLINE_EXCEEDED",
  }
  return {
    code: code as ContentfulStatusCode,
    body: { error: { code, message, status: statuses[code] ?? "UNKNOWN" } },
  }
}

async function readRequest(context: Context): Promise<unknown> {
  try {
    return await context.req.json<unknown>()
  } catch {
    throw new HTTPException(400, {
      message: "Request body must be valid JSON.",
    })
  }
}

export async function handleGeneration(
  context: Context,
  model: string,
  streaming: boolean,
) {
  const payload = translateToOpenAI(
    await readRequest(context),
    model,
    streaming,
  )
  const limit = state.models?.data.find((item) => item.id === model)
    ?.capabilities.limits.max_output_tokens
  if (limit !== undefined)
    payload.max_tokens = Math.min(payload.max_tokens ?? limit, limit)
  if (streaming) payload.stream_options = { include_usage: true }

  await checkRateLimit(state)
  if (state.manualApprove) await awaitApproval()
  const response = await createChatCompletions(payload)
  if ("choices" in response) return context.json(translateToGemini(response))

  return streamSSE(context, async (stream) => {
    const streamState: GeminiStreamState = {
      toolCalls: new Map(),
      candidateFinished: new Map(),
    }
    try {
      for await (const event of response) {
        if (event.data === "[DONE]") break
        if (!event.data) continue
        const chunk = JSON.parse(event.data) as ChatCompletionChunk
        const translated = translateChunkToGemini(chunk, streamState)
        if (translated)
          await stream.writeSSE({ data: JSON.stringify(translated) })
      }
      if (
        streamState.toolCalls.size > 0
        || streamState.candidateFinished.size === 0
        || [...streamState.candidateFinished.values()].some(
          (finished) => !finished,
        )
      )
        throw new Error("Upstream stream ended before all candidates finished.")
    } catch (error) {
      consola.error("Gemini stream failed:", error)
      await stream.writeSSE({
        data: JSON.stringify((await geminiError(error)).body),
      })
    }
  })
}

export async function handleCountTokens(context: Context, model: string) {
  const body = readObject(await readRequest(context), "request")
  const payload = translateToOpenAI(body.generateContentRequest ?? body, model)
  const selectedModel = state.models?.data.find((item) => item.id === model)
  if (!selectedModel)
    throw new HTTPException(404, { message: `Model ${model} not found.` })
  const count = await getTokenCount(payload, selectedModel)
  return context.json({ totalTokens: count.input + count.output })
}

function translateModel(model: Model) {
  return {
    name: `models/${model.id}`,
    baseModelId: model.id,
    displayName: model.name,
    version: model.version,
    inputTokenLimit:
      model.capabilities.limits.max_prompt_tokens
      ?? model.capabilities.limits.max_context_window_tokens,
    outputTokenLimit: model.capabilities.limits.max_output_tokens,
    supportedGenerationMethods: [
      "generateContent",
      "streamGenerateContent",
      "countTokens",
    ],
  }
}

export async function handleModels(context: Context, model?: string) {
  try {
    await cacheModels()
  } catch (error) {
    if (!state.models) throw error
    consola.warn("Failed to refresh models, serving cached copy", error)
  }
  const models =
    state.models?.data
      .filter((item) => item.capabilities.type === "chat")
      .map((item) => translateModel(item)) ?? []
  if (model === undefined) return context.json({ models })
  const selected = models.find((item) => item.name === `models/${model}`)
  if (!selected)
    throw new HTTPException(404, { message: `Model ${model} not found.` })
  return context.json(selected)
}
