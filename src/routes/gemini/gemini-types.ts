export interface GeminiFunctionCall {
  id?: string
  name: string
  args: Record<string, unknown>
}

export interface GeminiPart {
  text?: string
  functionCall?: GeminiFunctionCall
}

export interface GeminiCandidate {
  index: number
  content: { role: "model"; parts: Array<GeminiPart> }
  finishReason?: "STOP" | "MAX_TOKENS" | "SAFETY"
}

export interface GeminiResponse {
  candidates?: Array<GeminiCandidate>
  modelVersion: string
  responseId: string
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
    cachedContentTokenCount?: number
  }
}

export interface GeminiStreamState {
  candidateFinished: Map<number, boolean>
  toolCalls: Map<
    number,
    Map<number, { id: string; name: string; arguments: string }>
  >
}
