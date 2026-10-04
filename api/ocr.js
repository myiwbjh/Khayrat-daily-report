import {
  parseBody,
  requireConsent,
  authorizeAI,
  imageData,
  ApiError,
} from "../server/ai-auth.js";
import { openAIImage, OCR_SCHEMA } from "../server/vision-service.js";
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST")
    return response.status(405).json({ error: "Method not allowed" });
  try {
    const body = parseBody(request.body);
    requireConsent(body);
    await authorizeAI(request);
    if (process.env.OCR_ENABLED !== "true")
      throw new ApiError(503, "OCR is disabled");
    const analysis = await openAIImage(
        imageData(body.imageDataUrl),
        "",
        OCR_SCHEMA,
        { ocr: true },
      ),
      r = analysis.result;
    if (
      typeof r?.text !== "string" ||
      r.text.length > 30000 ||
      !Array.isArray(r.uncertainSegments) ||
      r.uncertainSegments.some((s) => typeof s !== "string")
    )
      throw new ApiError(502, "Invalid OCR result");
    return response
      .status(200)
      .json({
        ...r,
        model: analysis.model,
        usage: analysis.usage,
        layoutVerified: false,
        reviewRequired: true,
      });
  } catch (error) {
    return response
      .status(error.status || 502)
      .json({
        error: error.status ? error.message : "OCR service unavailable",
      });
  }
}
