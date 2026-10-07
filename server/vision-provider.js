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


export const GEMINI_MODELS=['gemini-3.8-flash','gemini-3.5-flash-lite','gemini-3.7-flash'];
export function freeProviderChain(env=process.env){
 const primary=visionProvider(env);if(primary.id!=='groq')return [primary];
 // Verified 2026-10-07 against official pricing/model docs. Never infer free from a model name.
 const backups=env.GEMINI_API_KEY&&env.GEMINI_FREE_TIER_CONFIRMED==='true'&&env.GEMINI_BILLING_DISABLED_CONFIRMED==='true'&&env.GEMINI_NONCONFIDENTIAL_USE_CONFIRMED==='true'?GEMINI_MODELS.map(model=>({id:'gemini',name:'Google Gemini',model,minIntervalMs:61000,privacyNotice:'Google 免费层可能用于产品改进及人工审阅；仅发送非敏感、非保密资料。'})):[];
 return [primary,...backups];
}
export function consentScope(env=process.env){return freeProviderChain(env).map(p=>`${p.id}:${p.model}`).join('|')+'|privacy-v1';}
export function requireChainConsent(body,env=process.env){const chain=freeProviderChain(env);requireProviderConsent(body,env);if(chain.length>1&&body.consentScope!==consentScope(env))throw new ApiError(409,'视觉接收平台范围已改变，请重新阅读并授权');return chain;}
