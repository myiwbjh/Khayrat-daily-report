export const SCENES=['施工中','停工或无明显施工','材料堆放','设备到货','安装准备','已完成区域','无法判断'];
// Text is evidence of what the report says, never evidence of pixels or attendance.
export function analyzeImageMetadata(image){return {tags:[],aiSummary:image.nearbyText?'已关联日报原文；尚未分析图片像素。':'尚未关联施工文字；需人工确认归属。',textFacts:image.nearbyText||'',visibleFacts:[],inferences:[],evidenceType:'日报文字',scene:'无法判断',confidence:0,manualReviewed:false,reviewRecommended:true,provider:'text-only',visionEnabled:false};}

export async function fingerprintImageData(dataUrl){const bytes=new TextEncoder().encode(dataUrl),digest=await crypto.subtle.digest('SHA-256',bytes);return `sha256:${[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')}`;}
export class ImageAnalysisProvider{
  constructor({endpoint='',consent=false,accessToken='',provider='',consentScope='',fetchImpl=fetch}={}){this.endpoint=endpoint;this.consent=consent;this.accessToken=accessToken;this.provider=provider;this.consentScope=consentScope;this.fetch=(...args)=>Reflect.apply(fetchImpl,globalThis,args);}
  get enabled(){return Boolean(this.endpoint&&this.consent&&this.accessToken);}
  async analyze(image){
    if(!this.enabled)throw new Error('视觉识别需要登录和明确的图片传输授权');
    if(!image.objectPath)throw new Error('请先将图片保存到私有云端存储');
    const response=await this.fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.accessToken}`},body:JSON.stringify({imageId:image.imageId,consent:true,...(this.consentScope?{consentScope:this.consentScope}:{}),...(this.provider?{provider:this.provider}:{})})});
    if(!response.ok){let message='';try{message=(await response.json()).error||'';}catch{}throw new Error(`视觉分析 ${response.status}${message?': '+message:''}`);}
    const r=await response.json();if(!SCENES.includes(r.scene)||!Array.isArray(r.visibleFacts)||!Array.isArray(r.inferences))throw new Error('视觉分析格式错误');
    return {scene:r.scene,tags:[...(r.equipment||[]),...(r.materials||[])],visibleFacts:r.visibleFacts,textFacts:r.textFacts||'',inferences:r.inferences,limitations:r.limitations||[],activities:r.activities||[],structures:r.structures||[],stage:r.stage,crossValidation:r.crossValidation,aiSummary:r.summary,confidence:r.confidence,evidenceType:'AI推断',manualReviewed:false,reviewRecommended:true,provider:r.provider,model:r.model,usage:r.usage,fallback:r.fallback||false,attempts:r.attempts||[],cached:r.cached||false,analyzedAt:r.analyzedAt,visionEnabled:true};
  }
}
export function findEvidenceConflicts(record,images){
  const conflicts=[];for(const image of images){if(image.crossValidation?.status==='potential-conflict')conflicts.push({imageId:image.imageId,reason:image.crossValidation.reason});
    // Legacy results are warnings only; new visual models cannot classify stoppage or delivery.
    if(!image.visionEnabled&&image.provider!=='text-only'&&/施工中/.test(record.status||'')&&/停工/.test(image.scene||''))conflicts.push({imageId:image.imageId,reason:'旧规则停工推断未经像素分析，需重新复核'});
  }return conflicts;
}
export function summarizeImageEvidence(images,{date='',workshop='',process=''}={}){
  const relevant=images.filter(i=>!i.ignored&&(!date||!i.relatedDate||i.relatedDate<=date)&&(!workshop||i.relatedWorkshop===workshop)&&(!process||i.relatedProcess===process));
  const analyzed=relevant.filter(i=>i.visionEnabled||i.manualReviewed),linked=relevant.filter(i=>i.relatedRecordId||i.relatedRecordKey||i.association?.status?.startsWith('linked'));
  const conflicts=relevant.filter(i=>i.crossValidation?.status==='potential-conflict');
  const scenes=new Map();for(const image of analyzed){const scene=image.scene||'无法判断';scenes.set(scene,(scenes.get(scene)||0)+1);}
  return {total:relevant.length,analyzed:analyzed.length,linked:linked.length,pending:relevant.length-analyzed.length,review:relevant.filter(i=>i.reviewRecommended&&!i.manualReviewed).length,conflicts:conflicts.length,sceneCounts:[...scenes].sort((a,b)=>b[1]-a[1]||SCENES.indexOf(a[0])-SCENES.indexOf(b[0])),conflictItems:conflicts};
}

const comparableText=value=>[value].flat().filter(Boolean).join(' ').toLowerCase().replace(/[\s，。；、,.!！?？:：()（）【】\[\]"']/g,'');
const shingles=value=>{const text=comparableText(value),out=new Set();for(let i=0;i<text.length-1;i++)out.add(text.slice(i,i+2));return out;};
const textSimilarity=(left,right)=>{const a=shingles(left),b=shingles(right);if(!a.size||!b.size)return null;let common=0;for(const item of a)if(b.has(item))common++;return common/(a.size+b.size-common);};
const sameAsset=(left,right)=>{
  const a=left.contentSignature||left.visualFingerprint||left.pixelHash;
  const b=right.contentSignature||right.visualFingerprint||right.pixelHash;
  return Boolean(a&&b&&a===b);
};
const visualSimilarity=(left,right)=>{
  const fields=[['stage',.25],['structures',.3],['activities',.2],['visibleFacts',.2],['scene',.05]];
  let score=0,weight=0;for(const [key,w] of fields){const similarity=textSimilarity(left[key],right[key]);if(similarity==null)continue;score+=similarity*w;weight+=w;}
  return {score:weight?score/weight:0,evidenceWeight:weight};
};
const daySpan=(left,right)=>Math.round((Date.parse(right)-Date.parse(left))/86400000);
const normalized=value=>comparableText(value);

// Photo similarity is a review signal only. It never upgrades an image pair to a stoppage finding.
export function detectSuspectedStagnation(images,records=[],{date='',workshop='',process='',minDays=7,minSimilarity=.78}={}){
  const eligible=images.filter(image=>!image.ignored&&!image.decorative&&!image.logoConfirmed&&(image.visionEnabled||image.manualReviewed)&&image.relatedDate&&image.relatedWorkshop&&(!date||image.relatedDate<=date)&&(!workshop||normalized(image.relatedWorkshop)===normalized(workshop))&&(!process||normalized(image.relatedProcess)===normalized(process))),candidates=eligible.filter(image=>image.contentSignature||image.visualFingerprint||image.pixelHash);
  const groups=new Map();for(const image of candidates){const key=normalized(image.relatedWorkshop);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(image);}
  const items=[];let duplicatesExcluded=0;
  for(const group of groups.values()){
    const byDate=new Map();for(const image of group){if(!byDate.has(image.relatedDate))byDate.set(image.relatedDate,[]);byDate.get(image.relatedDate).push(image);}const dates=[...byDate].sort(([a],[b])=>a.localeCompare(b));
    for(let earlier=0;earlier<dates.length;earlier++)for(let later=earlier+1;later<dates.length;later++){
      const [startDate,startImages]=dates[earlier],[endDate,endImages]=dates[later],days=daySpan(startDate,endDate);if(days<minDays)continue;let best=null;
      for(const previous of startImages)for(const current of endImages){
        if(sameAsset(previous,current)){duplicatesExcluded++;continue;}
        if(previous.relatedProcess&&current.relatedProcess&&normalized(previous.relatedProcess)!==normalized(current.relatedProcess))continue;
        const similarity=visualSimilarity(previous,current);if(similarity.evidenceWeight<.45||similarity.score<minSimilarity)continue;
        if(!best||similarity.score>best.similarity.score)best={previous,current,similarity};
      }
      if(best){
        const {previous,current,similarity}=best;
        const relatedReports=records.filter(record=>normalized(record.workshop)===normalized(current.relatedWorkshop)&&record.date>=previous.relatedDate&&record.date<=current.relatedDate&&(!previous.relatedProcess||!current.relatedProcess||!record.process||normalized(record.process)===normalized(current.relatedProcess)));
        const reportText=relatedReports.map(record=>[record.status,record.constructionContent,record.rawRecord].filter(Boolean).join(' ')).join(' '),explicit=/停工|暂停施工|中止施工|stopped|suspended/i.test(reportText),confirmed=/现场确认|监理确认|业主确认|签认/.test(reportText),active=/施工中|进行中|持续施工|in progress/i.test(reportText);
        const reportBasis=confirmed&&explicit?'日报含经现场/监理确认的停工依据':explicit?'日报含明确停工表述；长期停工仍需连续日报或现场确认':active?'同期日报仍记录施工中，需优先复核图文冲突':relatedReports.length?'同期日报未提供明确停工依据':'缺少同期日报交叉依据';
        items.push({classification:'疑似停滞',stopDetermination:false,workshop:current.relatedWorkshop,process:current.relatedProcess||previous.relatedProcess||'',startDate:previous.relatedDate,endDate:current.relatedDate,days,similarity:similarity.score,images:[previous.imageId,current.imageId],reportCount:relatedReports.length,reportBasis});
      }
    }
  }
  return {items:items.sort((a,b)=>b.similarity-a.similarity||b.days-a.days),duplicatesExcluded,compared:candidates.length,skippedUnfingerprinted:eligible.length-candidates.length};
}

