import { ApiError } from './ai-auth.js';

export const OPENAI_MODEL = 'gpt-4.1-mini-2025-04-14';
export const GROQ_MODEL = 'qwen/qwen3.8-27b';

// Fixed destinations/models; an unconfigured free service never falls back to paid AI.
export function visionProvider(env = process.env) {
  if (env.VISION_PROVIDER === 'groq' && env.GROQ_API_KEY &&
      env.GROQ_FREE_TIER_CONFIRMED === 'true' &&
      (!env.VISION_MODEL || env.VISION_MODEL === GROQ_MODEL)) {
    return { id: 'groq', name: 'Groq', model: GROQ_MODEL, minIntervalMs: 61000,
      costNotice: '仅限已确认的 Free Plan；额度耗尽停止，不自动转付费。预览模型，结果须复核。',
      privacyNotice: '照片及配对原文由 Groq 处理；建议在 Groq Data Controls 开启 Zero Data Retention。' };
  }
  if (env.VISION_PROVIDER === 'openai' && env.OPENAI_API_KEY &&
      (!env.VISION_MODEL || env.VISION_MODEL === OPENAI_MODEL)) {
    return { id: 'openai', name: 'OpenAI', model: OPENAI_MODEL, minIntervalMs: 0,
      costNotice: '预计 $0.20–0.70 / 100 张，实际按 token 计费。',
      privacyNotice: '照片及配对原文由 OpenAI 处理。' };
  }
  throw new ApiError(503, 'Approved vision provider is not configured');
}

export function requireProviderConsent(body, env = process.env) {
  const provider = visionProvider(env);
  // Legacy requests were explicitly authorized for OpenAI only, never Groq.
  if ((body.provider || 'openai') !== provider.id)
    throw new ApiError(409, 'Vision provider changed; review destination and authorize again');
  return provider;
}
