import { HTTPException } from "hono/http-exception"

import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
  ToolCall,
} from "~/services/copilot/create-chat-completions"

import type { GeminiPart, GeminiResponse } from "./gemini-types"

export function readObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HTTPException(400, { message: `${name} must be an object.` })
  }
  return value as Record<string, unknown>
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new HTTPException(400, {
      message: `${name} must be a non-empty string.`,
    })
  }
  return value
}

function readArray(value: unknown, name: string): Array<unknown> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HTTPException(400, {
      message: `${name} must be a non-empty array.`,
    })
  }
  return value as Array<unknown>
}

function normalizeSchema(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const schema = { ...readObject(value, "schema") }
  if (typeof schema.type === "string") schema.type = schema.type.toLowerCase()
  if (schema.properties !== undefined) {
    schema.properties = Object.fromEntries(
      Object.entries(readObject(schema.properties, "properties")).map(
        ([name, item]) => [name, normalizeSchema(item)],
      ),
    )
  }
  for (const key of ["items", "additionalProperties"]) {
    if (schema[key] !== undefined) schema[key] = normalizeSchema(schema[key])
  }
  if (Array.isArray(schema.anyOf))
    schema.anyOf = schema.anyOf.map((item: unknown) => normalizeSchema(item))
  return schema
}

function translateTools(value: unknown): Array<Tool> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value))
    throw new HTTPException(400, { message: "tools must be an array." })
  return value.flatMap((entry: unknown) => {
    const tool = readObject(entry, "tool")
    return readArray(tool.functionDeclarations, "functionDeclarations").map(
      (item) => {
        const declaration = readObject(item, "functionDeclaration")
        return {
          type: "function" as const,
          function: {
            name: readString(declaration.name, "function name"),
            ...(declaration.description === undefined ?
              {}
            : {
                description: readString(
                  declaration.description,
                  "function description",
                ),
              }),
            parameters: readObject(
              declaration.parametersJsonSchema
                ?? normalizeSchema(
                  declaration.parameters ?? {
                    type: "object",
                    properties: {},
                  },
                ),
              "parameters",
            ),
          },
        }
      },
    )
  })
}

function messageContent(parts: Array<ContentPart>): Message["content"] {
  if (parts.length === 0) return null
  if (parts.every((part) => part.type === "text"))
    return parts.map((part) => part.text).join("")
  return parts
}

function createMessage(
  role: Message["role"],
  parts: Array<ContentPart>,
  calls: Array<ToolCall>,
): Message | undefined {
  if (parts.length === 0 && calls.length === 0) return
  return {
    role,
    content: messageContent(parts),
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  }
}

function translateContentPart(part: Record<string, unknown>): ContentPart {
  if (typeof part.text === "string") return { type: "text", text: part.text }
  if (part.inlineData === undefined)
    throw new HTTPException(400, {
      message: "Unsupported Gemini content part.",
    })
  const image = readObject(part.inlineData, "inlineData")
  const mimeType = readString(image.mimeType, "mimeType")
  if (!mimeType.startsWith("image/"))
    throw new HTTPException(400, {
      message: "Only inline images are supported.",
    })
  return {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${readString(image.data, "image data")}`,
    },
  }
}

function translateCall(value: unknown, fallbackId: string): ToolCall {
  const call = readObject(value, "functionCall")
  return {
    id:
      call.id === undefined ?
        fallbackId
      : readString(call.id, "functionCall id"),
    type: "function",
    function: {
      name: readString(call.name, "functionCall name"),
      arguments: JSON.stringify(
        readObject(call.args ?? {}, "functionCall args"),
      ),
    },
  }
}

function translateResult(
  value: unknown,
  pendingCalls: Array<ToolCall>,
): Message {
  const result = readObject(value, "functionResponse")
  const name = readString(result.name, "functionResponse name")
  const index = pendingCalls.findIndex(
    (call) =>
      call.function.name === name
      && (result.id === undefined || call.id === result.id),
  )
  if (index === -1)
    throw new HTTPException(400, {
      message: `No matching function call for ${name}.`,
    })
  const [call] = pendingCalls.splice(index, 1)
  return {
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify(
      readObject(result.response, "functionResponse response"),
    ),
  }
}

function translateMessages(contents: unknown): Array<Message> {
  const pendingCalls: Array<ToolCall> = []
  const messages: Array<Message> = []
  for (const [contentIndex, entry] of readArray(
    contents,
    "contents",
  ).entries()) {
    const content = readObject(entry, "content")
    if (
      content.role !== undefined
      && content.role !== "user"
      && content.role !== "model"
    )
      throw new HTTPException(400, {
        message: "content role must be user or model.",
      })
    const role = content.role === "model" ? "assistant" : "user"
    const parts: Array<ContentPart> = []
    const calls: Array<ToolCall> = []
    for (const [partIndex, value] of readArray(
      content.parts,
      "parts",
    ).entries()) {
      const part = readObject(value, "part")
      if (part.thought === true) continue
      if (part.functionResponse !== undefined) {
        messages.push(translateResult(part.functionResponse, pendingCalls))
      } else if (part.functionCall !== undefined && role === "assistant") {
        const call = translateCall(
          part.functionCall,
          `call_${contentIndex}_${partIndex}`,
        )
        calls.push(call)
        pendingCalls.push(call)
      } else {
        parts.push(translateContentPart(part))
      }
    }
    const message = createMessage(role, parts, calls)
    if (message) messages.push(message)
  }
  if (messages.length === 0)
    throw new HTTPException(400, {
      message: "contents must include non-thinking content.",
    })
  return messages
}

function readGenerationNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new HTTPException(400, { message: `Invalid ${name}.` })
  if (
    (name === "maxOutputTokens" || name === "candidateCount")
    && (!Number.isInteger(value) || value === 0)
  )
    throw new HTTPException(400, { message: `Invalid ${name}.` })
  return value
}

function applyGenerationConfig(
  payload: ChatCompletionsPayload,
  value: unknown,
): void {
  if (value === undefined) return
  const config = readObject(value, "generationConfig")
  if (
    config.responseSchema !== undefined
    || config.responseJsonSchema !== undefined
  ) {
    throw new HTTPException(400, {
      message: "Schema-constrained output is not supported.",
    })
  }
  const numericKeys = {
    maxOutputTokens: "max_tokens",
    temperature: "temperature",
    topP: "top_p",
    candidateCount: "n",
  } as const
  for (const [key, target] of Object.entries(numericKeys)) {
    const setting = config[key]
    if (setting === undefined) continue
    payload[target] = readGenerationNumber(setting, key)
  }
  if (config.stopSequences !== undefined) {
    if (
      !Array.isArray(config.stopSequences)
      || !config.stopSequences.every(
        (item: unknown) => typeof item === "string",
      )
    )
      throw new HTTPException(400, {
        message: "stopSequences must be strings.",
      })
    payload.stop = config.stopSequences
  }
  if (config.responseMimeType === "application/json") {
    payload.response_format = { type: "json_object" }
  } else if (
    config.responseMimeType !== undefined
    && config.responseMimeType !== "text/plain"
  ) {
    throw new HTTPException(400, { message: "Unsupported responseMimeType." })
  }
}

export function translateToOpenAI(
  value: unknown,
  model: string,
  stream = false,
): ChatCompletionsPayload {
  const request = readObject(value, "request")
  const payload: ChatCompletionsPayload = {
    model,
    messages: translateMessages(request.contents),
    stream,
  }
  if (request.systemInstruction !== undefined) {
    const system = readObject(request.systemInstruction, "systemInstruction")
    const text = readArray(system.parts, "systemInstruction.parts")
      .map((value) => {
        const part = readObject(value, "systemInstruction part")
        if (typeof part.text !== "string")
          throw new HTTPException(400, {
            message: "System instructions must contain text.",
          })
        return part.text
      })
      .join("\n")
    payload.messages.unshift({ role: "system", content: text })
  }
  payload.tools = translateTools(request.tools)
  if (request.toolConfig !== undefined) {
    const config = readObject(
      readObject(request.toolConfig, "toolConfig").functionCallingConfig,
      "functionCallingConfig",
    )
    const modes = {
      NONE: "none",
      AUTO: "auto",
      ANY: "required",
      VALIDATED: "auto",
    } as const
    const mode = config.mode ?? "AUTO"
    if (typeof mode !== "string" || !Object.hasOwn(modes, mode))
      throw new HTTPException(400, {
        message: "Invalid function calling mode.",
      })
    payload.tool_choice = modes[mode as keyof typeof modes]
    if (config.allowedFunctionNames !== undefined) {
      const names = readArray(
        config.allowedFunctionNames,
        "allowedFunctionNames",
      ).map((name) => readString(name, "allowed function name"))
      payload.tools = payload.tools?.filter((tool) =>
        names.includes(tool.function.name),
      )
      if (!payload.tools?.length)
        throw new HTTPException(400, {
          message: "No matching allowed functions.",
        })
      if (mode === "ANY" && names.length === 1)
        payload.tool_choice = { type: "function", function: { name: names[0] } }
    }
  }
  applyGenerationConfig(payload, request.generationConfig)
  return payload
}

function translateFunctionCall(call: ToolCall): GeminiPart {
  if (!call.function.name) throw new Error("Upstream function name is missing.")
  const args: unknown = JSON.parse(call.function.arguments || "{}")
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("Upstream function arguments must be a JSON object.")
  return {
    functionCall: {
      id: call.id,
      name: call.function.name,
      args: args as Record<string, unknown>,
    },
  }
}

export function translateFunctionCalls(
  calls: Array<ToolCall>,
  reason: string,
): Array<GeminiPart> {
  return calls.flatMap((call) => {
    try {
      return [translateFunctionCall(call)]
    } catch (error) {
      if (reason === "length" || reason === "content_filter") return []
      throw error
    }
  })
}

export function mapFinishReason(
  reason: string,
): "STOP" | "MAX_TOKENS" | "SAFETY" {
  if (reason === "length") return "MAX_TOKENS"
  if (reason === "content_filter") return "SAFETY"
  return "STOP"
}

export function translateUsage(
  usage: NonNullable<ChatCompletionResponse["usage"]>,
): NonNullable<GeminiResponse["usageMetadata"]> {
  return {
    promptTokenCount: usage.prompt_tokens,
    candidatesTokenCount: usage.completion_tokens,
    totalTokenCount: usage.total_tokens,
    ...(usage.prompt_tokens_details ?
      { cachedContentTokenCount: usage.prompt_tokens_details.cached_tokens }
    : {}),
  }
}

export function translateToGemini(
  response: ChatCompletionResponse,
): GeminiResponse {
  return {
    candidates: response.choices.map((choice) => ({
      index: choice.index,
      content: {
        role: "model",
        parts: [
          ...(choice.message.content ? [{ text: choice.message.content }] : []),
          ...translateFunctionCalls(
            choice.message.tool_calls ?? [],
            choice.finish_reason,
          ),
        ],
      },
      finishReason: mapFinishReason(choice.finish_reason),
    })),
    modelVersion: response.model,
    responseId: response.id,
    ...(response.usage ?
      { usageMetadata: translateUsage(response.usage) }
    : {}),
  }
}
