import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import type {
  GeminiCandidate,
  GeminiPart,
  GeminiResponse,
  GeminiStreamState,
} from "./gemini-types"

import {
  mapFinishReason,
  translateFunctionCalls,
  translateUsage,
} from "./non-stream-translation"

function collectToolCalls(
  choice: ChatCompletionChunk["choices"][number],
  state: GeminiStreamState,
): void {
  for (const delta of choice.delta.tool_calls ?? []) {
    let calls = state.toolCalls.get(choice.index)
    if (!calls) {
      calls = new Map()
      state.toolCalls.set(choice.index, calls)
    }
    const call = calls.get(delta.index) ?? {
      id: `call_${choice.index}_${delta.index}`,
      name: "",
      arguments: "",
    }
    if (delta.id) call.id = delta.id
    call.name += delta.function?.name ?? ""
    call.arguments += delta.function?.arguments ?? ""
    calls.set(delta.index, call)
  }
}

function finishToolCalls(
  index: number,
  state: GeminiStreamState,
  reason: string,
): Array<GeminiPart> {
  const calls = state.toolCalls.get(index)
  state.toolCalls.delete(index)
  const completed = [...(calls ?? [])]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    }))
  return translateFunctionCalls(completed, reason)
}

export function translateChunkToGemini(
  chunk: ChatCompletionChunk,
  state: GeminiStreamState,
): GeminiResponse | undefined {
  const candidates: Array<GeminiCandidate> = []
  for (const choice of chunk.choices) {
    state.candidateFinished.set(choice.index, Boolean(choice.finish_reason))
    const parts: Array<GeminiPart> = []
    if (choice.delta.content) parts.push({ text: choice.delta.content })
    collectToolCalls(choice, state)
    if (choice.finish_reason)
      parts.push(...finishToolCalls(choice.index, state, choice.finish_reason))
    if (parts.length > 0 || choice.finish_reason) {
      candidates.push({
        index: choice.index,
        content: { role: "model", parts },
        ...(choice.finish_reason ?
          { finishReason: mapFinishReason(choice.finish_reason) }
        : {}),
      })
    }
  }
  if (candidates.length === 0 && !chunk.usage) return undefined
  return {
    ...(candidates.length > 0 ? { candidates } : {}),
    modelVersion: chunk.model,
    responseId: chunk.id,
    ...(chunk.usage ? { usageMetadata: translateUsage(chunk.usage) } : {}),
  }
}
