import { MODEL } from "../server/vision-service.js";
export default function handler(request, response) {
  const approved =
      process.env.AI_FEATURES_APPROVED === "true" &&
      Boolean(process.env.AI_ALLOWED_USER_EMAILS?.trim()),
    visionEnabled =
      approved &&
      process.env.VISION_PROVIDER === "openai" &&
      Boolean(process.env.OPENAI_API_KEY) &&
      (!process.env.VISION_MODEL || process.env.VISION_MODEL === MODEL);
  response.setHeader("Cache-Control", "no-store");
  response
    .status(200)
    .json({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
      storageBucket: process.env.SUPABASE_STORAGE_BUCKET || "khayrat-reports",
      ocrEnabled: visionEnabled && process.env.OCR_ENABLED === "true",
      visionEnabled,
      visionProvider: visionEnabled ? "OpenAI" : "",
      visionModel: visionEnabled ? MODEL : "",
      authRequired: process.env.ACCESS_CONTROL_REQUIRED !== "false",
    });
}
