export const SCENES=['施工中','停工或无明显施工','材料堆放','设备到货','安装准备','已完成区域','无法判断'];
// Text is evidence of what the report says, never evidence of pixels or attendance.
export function analyzeImageMetadata(image){return {tags:[],aiSummary:image.nearbyText?'已关联日报原文；尚未分析图片像素。':'尚未关联施工文字；需人工确认归属。',textFacts:image.nearbyText||'',visibleFacts:[],inferences:[],evidenceType:'日报文字',scene:'无法判断',confidence:0,manualReviewed:false,reviewRecommended:true,provider:'text-only',visionEnabled:false};}
export class ImageAnalysisProvider{
  constructor({endpoint='',consent=false,accessToken='',provider='',fetchImpl=fetch}={}){this.endpoint=endpoint;this.consent=consent;this.accessToken=accessToken;this.provider=provider;this.fetch=(...args)=>Reflect.apply(fetchImpl,globalThis,args);}
  get enabled(){return Boolean(this.endpoint&&this.consent&&this.accessToken);}
  async analyze(image){
    if(!this.enabled)throw new Error('视觉识别需要登录和明确的图片传输授权');
    if(!image.objectPath)throw new Error('请先将图片保存到私有云端存储');
    const response=await this.fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.accessToken}`},body:JSON.stringify({imageId:image.imageId,consent:true,...(this.provider?{provider:this.provider}:{})})});
    if(!response.ok){let message='';try{message=(await response.json()).error||'';}catch{}throw new Error(`视觉分析 ${response.status}${message?': '+message:''}`);}
    const r=await response.json();if(!SCENES.includes(r.scene)||!Array.isArray(r.visibleFacts)||!Array.isArray(r.inferences))throw new Error('视觉分析格式错误');
    return {scene:r.scene,tags:[...(r.equipment||[]),...(r.materials||[])],visibleFacts:r.visibleFacts,textFacts:r.textFacts||'',inferences:r.inferences,limitations:r.limitations||[],activities:r.activities||[],structures:r.structures||[],stage:r.stage,crossValidation:r.crossValidation,aiSummary:r.summary,confidence:r.confidence,evidenceType:'AI推断',manualReviewed:false,reviewRecommended:true,provider:r.provider,model:r.model,usage:r.usage,analyzedAt:r.analyzedAt,visionEnabled:true};
  }
}
export function findEvidenceConflicts(record,images){
  const conflicts=[];for(const image of images){if(image.crossValidation?.status==='potential-conflict')conflicts.push({imageId:image.imageId,reason:image.crossValidation.reason});
    // Legacy results are warnings only; new visual models cannot classify stoppage or delivery.
    if(!image.visionEnabled&&image.provider!=='text-only'&&/施工中/.test(record.status||'')&&/停工/.test(image.scene||''))conflicts.push({imageId:image.imageId,reason:'旧规则停工推断未经像素分析，需重新复核'});
  }return conflicts;
}
