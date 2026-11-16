import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"

import {
  geminiError,
  handleCountTokens,
  handleGeneration,
  handleModels,
} from "./handler"

export const geminiRoutes = new Hono()

geminiRoutes.onError(async (error, context) => {
  const response = await geminiError(error)
  return context.json(response.body, response.code)
})

geminiRoutes.get("/models", (context) => handleModels(context))
geminiRoutes.get("/models/:model", (context) =>
  handleModels(context, context.req.param("model")),
)
geminiRoutes.post("/models/:model", (context) => {
  const path = context.req.param("model")
  const separator = path.lastIndexOf(":")
  const model = path.slice(0, separator)
  const action = path.slice(separator + 1)
  if (separator <= 0)
    throw new HTTPException(404, { message: "Unknown model action." })
  if (action === "countTokens") return handleCountTokens(context, model)
  if (action === "generateContent" || action === "streamGenerateContent")
    return handleGeneration(context, model, action === "streamGenerateContent")
  throw new HTTPException(404, { message: `Unknown model action: ${action}.` })
})
