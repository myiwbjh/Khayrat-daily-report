import { visionProvider, freeProviderChain, consentScope } from '../server/vision-provider.js';
export default function handler(request, response) {
  const approved =
      process.env.AI_FEATURES_APPROVED === "true" &&
      Boolean(process.env.AI_ALLOWED_USER_EMAILS?.trim()),
    provider = (() => { try { return visionProvider(); } catch { return null; } })(),
    visionEnabled = Boolean(approved && provider);
  response.setHeader("Cache-Control", "no-store");
  response
    .status(200)
    .json({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
      storageBucket: process.env.SUPABASE_STORAGE_BUCKET || "khayrat-reports",
      ocrEnabled: visionEnabled && provider.id === 'openai' && process.env.OCR_ENABLED === "true",
      visionEnabled,
      visionChain: visionEnabled?freeProviderChain().map(({id,name,model,privacyNotice})=>({id,name,model,privacyNotice})):[],
      visionConsentScope: visionEnabled?consentScope():null,
      visionProvider: visionEnabled ? provider.name : '',
      visionProviderId: visionEnabled ? provider.id : '',
      visionModel: visionEnabled ? provider.model : '',
      visionMinIntervalMs: visionEnabled ? provider.minIntervalMs : 0,
      visionCostNotice: visionEnabled ? provider.costNotice : '',
      visionPrivacyNotice: visionEnabled ? provider.privacyNotice : '',
      authRequired: process.env.ACCESS_CONTROL_REQUIRED !== "false",
    });
}

