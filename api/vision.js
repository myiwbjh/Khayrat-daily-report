import {runVisionOnce} from '../server/vision-runs.js';
import { parseBody, requireConsent, authorizeAI } from "../server/ai-auth.js";
import {
  storedImage,
  visionImage,
  VISION_SCHEMA,
  validateVision,
} from "../server/vision-service.js";
import { requireChainConsent } from '../server/vision-provider.js';
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST")
    return response.status(405).json({ error: "Method not allowed" });
  try {
    const body = parseBody(request.body);
    requireConsent(body);
    requireChainConsent(body);
    const auth = await authorizeAI(request),
      image = await storedImage(body.imageId, auth),
      analysis = await runVisionOnce(body.imageId,auth,()=>{
        const previous=image.evidence.automaticAnalysis;
        if(image.evidence.visionEnabled&&previous){const result={scene:previous.scene,visibleFacts:previous.visibleFacts,activities:previous.activities||[],equipment:previous.equipment||previous.tags||[],materials:previous.materials||[],structures:previous.structures||[],stage:previous.stage||'无法判断',inferences:previous.inferences||[],limitations:previous.limitations||[],summary:previous.summary||previous.aiSummary||'',confidence:previous.confidence,crossValidation:previous.crossValidation};validateVision(result);return {result,provider:previous.provider,model:previous.model,usage:previous.usage,analyzedAt:previous.analyzedAt,fallback:previous.fallback||false,attempts:previous.attempts||[{provider:previous.provider,model:previous.model,status:'success',usage:previous.usage||null}],cached:true};}
        return visionImage(image.dataUrl, image.context, VISION_SCHEMA);
      });
    validateVision(analysis.result);
    return response
      .status(200)
      .json({
        ...analysis.result,
        provider: analysis.provider,
        model: analysis.model,
        usage: analysis.usage,
        fallback: analysis.fallback, attempts:analysis.attempts, cached:analysis.cached||false,
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

