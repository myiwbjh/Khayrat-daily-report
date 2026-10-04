import { parseBody, requireConsent, authorizeAI } from "../server/ai-auth.js";
import {
  storedImage,
  openAIImage,
  VISION_SCHEMA,
  validateVision,
} from "../server/vision-service.js";
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST")
    return response.status(405).json({ error: "Method not allowed" });
  try {
    const body = parseBody(request.body);
    requireConsent(body);
    const auth = await authorizeAI(request),
      image = await storedImage(body.imageId, auth),
      analysis = await openAIImage(image.dataUrl, image.context, VISION_SCHEMA);
    validateVision(analysis.result);
    return response
      .status(200)
      .json({
        ...analysis.result,
        provider: analysis.provider,
        model: analysis.model,
        usage: analysis.usage,
        analyzedAt: analysis.analyzedAt,
        textFacts: image.context,
        reviewRecommended: true,
      });
  } catch (error) {
    return response
      .status(error.status || 502)
      .json({ error: error.status ? error.message : "AI service unavailable" });
  }
}
