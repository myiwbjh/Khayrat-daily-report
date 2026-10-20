import {reviewEvidence} from './evidence-review.js';
import {timingSafeEqual} from 'node:crypto';
import {ApiError, requireConsent} from './ai-auth.js';
import {rest, serviceAccess} from './project-auth.js';
import {requireChainConsent} from './vision-provider.js';
import {storedImage, visionImage, validateVision, VISION_SCHEMA} from './vision-service.js';
import {findDuplicateEvidence,consolidateEvidence} from './photo-dedupe-service.js';

const rpc=(name,body,restImpl)=>restImpl(`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(body)});
export function freeConsent(body,env=process.env){
  requireConsent(body,env);
  const chain=requireChainConsent(body,env);
  if(chain.some(provider=>provider.id==='openai'))throw new ApiError(403,'后台识别只允许已确认的免费模型');
  return {consent:true,provider:body.provider,consentScope:body.consentScope||''};
}
export function workerAuthorized(request,env=process.env){
  const expected=env.VISION_WORKER_SECRET,actual=request.headers?.authorization?.replace(/^Bearer /,'');
  return Boolean(expected?.length>=32&&actual&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected)));
}
export async function enqueueVision(body,auth,{restImpl=rest,env=process.env}={}){
  if(body.imageIds!==undefined&&!Array.isArray(body.imageIds))throw new ApiError(400,'Invalid image IDs');
  const consent=freeConsent(body,env),ids=[...new Set(body.imageIds||[body.imageId])];
  if(!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[-_a-zA-Z0-9]{1,240}$/.test(id)))throw new ApiError(400,'Invalid image IDs');
  return rpc('enqueue_vision_jobs',{p_ids:ids,p_user:auth.user.id,p_consent:consent,p_retry:body.retry===true},restImpl);
}
export function savedAnalysis(evidence){
  const p=evidence.automaticAnalysis||evidence;
  if(!evidence.visionEnabled||!p.provider||p.provider==='text-only')return null;
  const result={scene:p.scene,visibleFacts:p.visibleFacts,activities:p.activities||[],equipment:p.equipment||p.tags||[],materials:p.materials||[],structures:p.structures||[],stage:p.stage||'无法判断',inferences:p.inferences||[],limitations:p.limitations||[],summary:p.summary||p.aiSummary||'',confidence:p.confidence,crossValidation:p.crossValidation};
  try{validateVision(result);}catch{return null;}
  return {result,provider:p.provider,model:p.model,usage:p.usage,analyzedAt:p.analyzedAt,fallback:p.fallback||false,attempts:p.attempts||[],cached:true};
}
export function evidenceAnalysis(analysis,context,fingerprint=null){
  const r=analysis.result;
  return {...r,tags:[...r.equipment,...r.materials],aiSummary:r.summary,textFacts:context,evidenceType:'AI推断',reviewRecommended:true,manualReviewed:false,visionEnabled:true,provider:analysis.provider,model:analysis.model,usage:analysis.usage||null,analyzedAt:analysis.analyzedAt,cached:analysis.cached||false,fallback:analysis.fallback||false,attempts:analysis.attempts||[],...(fingerprint?{perceptualHash:fingerprint.perceptualHash,differenceHash:fingerprint.differenceHash,imageWidth:fingerprint.width,imageHeight:fingerprint.height,imageAspectRatio:fingerprint.aspectRatio,fingerprintAlgorithm:fingerprint.algorithm}:{})};
}
export async function processVisionJob({restImpl=rest,env=process.env,fetchImpl=fetch,storedImageImpl=storedImage,visionImpl=visionImage,reviewImpl=reviewEvidence}={}){
  const jobs=await rpc('claim_vision_job',{},restImpl),job=jobs?.[0];
  if(!job)return {processed:0};
  let analysis=null,contentHash=null,duplicate=null;
  try{
    freeConsent(job.consent,env);
    const member=await restImpl(`/rest/v1/project_members?project_id=eq.khayrat&user_id=eq.${encodeURIComponent(job.requested_by)}&select=role`);
    const user=await restImpl(`/auth/v1/admin/users/${encodeURIComponent(job.requested_by)}`),identity=user.user||user;
    const allowed=(env.AI_ALLOWED_USER_EMAILS||'').toLowerCase().split(',').map(s=>s.trim());
    if(member[0]?.role!=='editor'||!identity.email_confirmed_at||!allowed.includes(String(identity.email||'').toLowerCase()))throw new ApiError(403,'提交者的 AI 或 Editor 授权已失效');
    const image=await storedImageImpl(job.image_id,serviceAccess(env),{env,fetchImpl});
    contentHash=image.contentHash;
    duplicate=await findDuplicateEvidence({...image.evidence,imageId:job.image_id},{...image.fingerprint,contentHash},{restImpl,env,fetchImpl,storedImageImpl}).catch(()=>null);
    analysis=job.analysis?{...job.analysis,cached:true}:savedAnalysis(image.evidence);
    if(!analysis&&duplicate)analysis=savedAnalysis(duplicate.candidate);
    if(!analysis){
      const cached=await restImpl(`/rest/v1/vision_runs?project_id=eq.khayrat&state=eq.success&content_hash=eq.${encodeURIComponent(contentHash)}&select=analysis&limit=1`);
      if(cached[0]?.analysis){analysis={...cached[0].analysis,cached:true};validateVision(analysis.result);}
    }
    // Legacy successes predate server hashes. Their browser signature hashes the
    // same original data URL, so re-use only after checking its recorded analysis.
    if(!analysis){
      const old=await restImpl(`/rest/v1/image_evidence?project_id=eq.khayrat&payload->>contentSignature=eq.${encodeURIComponent(image.legacySignature||contentHash)}&payload->>visionEnabled=eq.true&select=payload&limit=20`);
      analysis=old.map(row=>savedAnalysis(row.payload)).find(Boolean)||null;
    }
    if(!analysis)analysis=await visionImpl(image.dataUrl,image.context,VISION_SCHEMA,{env,fetchImpl});
    validateVision(analysis.result);
    if(analysis.cached){
      // Pixel facts are reusable; cross-validation belongs to this report/date.
      analysis={...analysis,result:{...analysis.result,crossValidation:{status:'insufficient-evidence',reason:'复用相同图片的视觉事实；当前日报关联需复核'}}};
    }
    const completedEvidence={...image.evidence,...evidenceAnalysis(analysis,image.context,image.fingerprint),imageContentHash:contentHash,imageId:job.image_id};
    await rpc('finish_vision_job',{p_id:job.image_id,p_lease:job.updated_at,p_analysis:analysis,p_evidence:evidenceAnalysis(analysis,image.context,image.fingerprint),p_hash:contentHash,p_error:null},restImpl);
    const consolidated=duplicate?await consolidateEvidence(completedEvidence,duplicate.candidate,duplicate.match,{env,fetchImpl}):null;
    let automaticReview='pending';try{await reviewImpl({imageIds:[consolidated?.canonical?.imageId||job.image_id],restImpl});automaticReview='complete';}catch{/* Recognition is saved; the editor refresh retries source review without a model call. */}
    return {processed:1,state:'success',cached:Boolean(analysis.cached),automaticReview};
  }catch(error){
    // Preserve a completed model result even if evidence persistence failed.
    // Retrying then uses this result instead of spending another model call.
    await rpc('finish_vision_job',{p_id:job.image_id,p_lease:job.updated_at,p_analysis:analysis,p_evidence:null,p_hash:contentHash,p_error:error.status?error.message:'后台识别或结果保存失败，请手动重试',p_attempts:error.attempts||[]},restImpl);
    return {processed:1,state:'failed'};
  }
}
