import {standardWorkshop,workshopAliasEntries} from './workshop-status.js';
import {parseReportDate} from './report-model.js';
import {documentDate} from './pdf-layout.js';
import {evidenceStatus} from './evidence-status.js';

export const AUTO_REVIEW_VERSION=1;
const clean=v=>String(v||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const date=v=>Boolean(v&&parseReportDate(v)===v);
const sourceText=r=>r.sourceExcerpt||r.constructionContent||'';
const sameDocument=(i,r)=>i.originalObjectPath&&r.originalObjectPath?i.originalObjectPath===r.originalObjectPath:Boolean(i.sourceFile&&i.sourceFile===r.sourceFile);
const knownWorkshop=v=>v&&!/未关联|未知|全项目|项目周报/.test(v);
const concepts=[['开挖','开挖|挖掘|破碎|挖土|excavat'],['回填','回填|填方|平整|backfill'],['钢筋','钢筋|插筋|绑扎|rebar|reinforc'],['模板','模板|支模|formwork'],['混凝土','混凝土|浇筑|养护|concrete'],['脚手架','脚手架|scaffold'],['装修','装修|粉刷|瓷砖|地砖|吊顶|门窗|踢脚线'],['管线','管道|管线|给水|排水|电缆|pipe|cable'],['钢结构','钢结构|桁架|钢梁'],['设备','设备安装|设备就位|机装']].map(([name,pattern])=>[name,new RegExp(pattern,'i')]);
const clauses=text=>String(text||'').split(/[。；;\n]/).filter(Boolean);
const positive=text=>!/(?:未见|未显示|无法|不能|疑似|推测|可能|不确定|看不到)/.test(text);
const tags=text=>concepts.filter(([,re])=>re.test(text)).map(([name])=>name);
// Absence from the photograph is not a construction contradiction. Require
// explicit opposite claims about the same named element and operation.
export function substantiveConflict(source,facts){
  const objects=/底板|顶板|墙板|坑壁|环梁|屋面|电缆沟|地沟|基础|梁板|立柱/g;
  for(const original of clauses(source))for(const observed of facts.flatMap(clauses).filter(positive)){
    if(![...(original.matchAll(objects))].some(match=>observed.includes(match[0])))continue;
    const ids=s=>[...s.matchAll(/\d+\s*(?:#|号|层)/g)].map(m=>clean(m[0]));
    if(ids(original).length&&ids(observed).length&&!ids(original).some(id=>ids(observed).includes(id)))continue;
    for(const action of ['浇筑','回填','开挖','安装','拆除']){
      const absent=new RegExp(`未(?:开始|进行|完成)?${action}|${action}尚未(?:开始|完成)`),done=new RegExp(`(?:已|已经)(?:完成)?${action}|${action}(?:已)?完成`);
      const state=text=>absent.test(text)?-1:done.test(text)?1:0;
      if(state(original)*state(observed)===-1)return {original,observed,action};
    }
  }
  return null;
}

export function reviewImageEvidence(image,{records=[],mappings=[]}={}){
  // Human decisions always take precedence; the original fields remain immutable.
  if(image.calibration?.decision||evidenceStatus({...image,automaticReview:undefined})!=='review')return null;
  const basis=[],reasons=[];
  const result=(status,code,reason,extra={})=>({version:AUTO_REVIEW_VERSION,status,code,reason,basis,...extra});
  const pending=(code,reason,extra={})=>result('needs-review',code,reason,extra);
  const document=records.filter(r=>sameDocument(image,r));
  const pageNumber=Number(image.pageNumber),layout=document.find(r=>Array.isArray(r.documentLayout))?.documentLayout||[],weeklyDoc=document.find(r=>r.recordType==='weekly-document');
  const page=layout.find(p=>Number(p.pageNumber)===pageNumber)||weeklyDoc?.pages?.find(p=>Number(p.pageNumber)===pageNumber);
  const location={sourceFile:image.sourceFile||'',pageNumber:image.pageNumber||null};
  basis.push({kind:'photo-source',...location,excerpt:image.association?.caption||image.caption||image.sourceExcerpt||image.nearbyText||''});
  if(!document.length)return pending('source-missing','找不到所属原始日报或周报，不能仅凭 AI 判断归属');
  const weekly=image.sourceType==='weekly-report'||Boolean(weeklyDoc);
  const dates=[...new Set(document.map(r=>r.date).filter(date))];
  if(dates.length!==1||!date(image.relatedDate))return pending('date-uncertain','原文日期缺失或同一来源包含不同日期');
  const sourceDate=dates[0];
  basis.push({kind:weekly?'weekly-period':'report-date',sourceFile:image.sourceFile,pageNumber:1,date:sourceDate,periodStart:weeklyDoc?.periodStart||'',periodEnd:weeklyDoc?.periodEnd||'',excerpt:(layout[0]?.text||weeklyDoc?.sourceExcerpt||document.find(r=>r.dateSource)?.sourceExcerpt||'').slice(0,600)});
  if(!weekly&&layout.length){
    const parsed=documentDate(layout);
    if(!parsed.date)return pending('date-uncertain','日报全文未能唯一确认报告日期，保留人工核对');
    if(parsed.date!==sourceDate)return pending('date-conflict',`日报原文日期 ${parsed.date} 与已关联日期 ${sourceDate} 不一致`);
  }
  if(weekly&&image.comparisonPeriod==='上周')return pending('comparison-period','上周对照照片不能按本周结束日确认拍摄日期，需核对原始日期或期间');
  if(sourceDate!==image.relatedDate)return pending('date-conflict',`照片关联日期 ${image.relatedDate} 与原文日期 ${sourceDate} 不一致`);
  if(weekly&&(!weeklyDoc?.periodStart||!weeklyDoc?.periodEnd||image.comparisonPeriod!=='本周'))return pending('date-uncertain','周报照片期间或上周/本周位置无法确认');
  const canonical=v=>standardWorkshop(v,mappings),originalWorkshop=canonical(image.relatedWorkshop);
  let block;
  const blocks=page?.blocks||[];
  if(image.bbox&&blocks.length){const x=image.bbox.x+image.bbox.width/2,y=image.bbox.y+image.bbox.height/2;const nearby=blocks.filter(b=>b.region&&x>=b.region.x&&x<=b.region.x+b.region.width&&y>=b.region.y&&y<=b.region.y+b.region.height);if(nearby.length===1)block=nearby[0];}
  if(!block&&image.association?.blockId)block=blocks.find(b=>b.id===image.association.blockId&&clean(b.excerpt)===clean(image.sourceExcerpt||image.association.excerpt));
  if(!block&&blocks.length===1)block=blocks[0];
  const dailyRows=document.filter(r=>r.recordType!=='personnel-summary'&&r.sourceType!=='weekly-report'&&knownWorkshop(r.workshop));
  const matched=dailyRows.filter(r=>clean(sourceText(r))&&[image.sourceExcerpt,image.association?.excerpt].some(text=>clean(text)===clean(sourceText(r))));
  let workshop=canonical(block?.workshop||'');
  if(!workshop&&matched.length&&new Set(matched.map(r=>canonical(r.workshop))).size===1)workshop=canonical(matched[0].workshop);
  if(weekly){
    const heading=clean(page?.text),candidate=canonical(image.relatedWorkshop);
    if(knownWorkshop(candidate)&&heading&&[image.relatedWorkshop,candidate,...workshopAliasEntries(mappings).filter(m=>canonical(m.alias)===candidate).map(m=>m.alias)].some(name=>clean(name)&&heading.includes(clean(name))))workshop=candidate;
  }
  if(!knownWorkshop(workshop))return pending('workshop-uncertain','照片标题或所在原文段落不能唯一确认车间，不能用整页或 AI 猜测');
  if(knownWorkshop(originalWorkshop)&&originalWorkshop!==workshop)return pending('workshop-conflict',`照片关联车间“${image.relatedWorkshop}”与原文“${block?.workshop||workshop}”不一致`);
  const candidates=document.filter(r=>(weekly?r.recordType==='weekly-workshop-status':r.recordType!=='personnel-summary')&&canonical(r.workshop)===workshop&&r.date===sourceDate);
  const selected=candidates.find(r=>block&&clean(sourceText(r))===clean(block.excerpt))||candidates.find(r=>r.id===image.relatedRecordId)||candidates[0];
  const original=block?.excerpt||sourceText(selected||{});
  if(!original)return pending('source-insufficient','已确认照片标题，但缺少该车间同期施工事实原文');
  basis.push({kind:weekly?'weekly-work':'daily-section',sourceFile:image.sourceFile,pageNumber:block?pageNumber:selected?.pageNumber||pageNumber,blockId:block?.id||image.association?.blockId||'',recordId:selected?.id||'',workshop,excerpt:original});
  // Same-date daily/weekly corroboration is retained separately; future plans and
  // previous-week comparison text are never treated as completed construction.
  const corroborating=records.filter(r=>r.sourceType==='weekly-report'&&r.recordType==='weekly-workshop-status'&&canonical(r.workshop)===workshop&&r.periodStart<=sourceDate&&r.periodEnd>=sourceDate&&!sameDocument(image,r));
  for(const r of corroborating.slice(0,2))basis.push({kind:'weekly-support',sourceFile:r.sourceFile,pageNumber:r.pageNumber,periodStart:r.periodStart,periodEnd:r.periodEnd,excerpt:sourceText(r)});
  const visual=image.automaticAnalysis||image,facts=[...(visual.visibleFacts||[]),...(visual.activities||[])],conflict=substantiveConflict(original,facts);
  if(conflict)return pending('fact-conflict',`同一构件的“${conflict.action}”存在明确相反事实`,{conflict});
  const sourceTags=tags(original),visibleTags=tags(facts.filter(positive).join(' ')),shared=sourceTags.filter(t=>visibleTags.includes(t));
  const cross=visual.crossValidation||image.crossValidation;
  if(cross?.status==='potential-conflict'&&!/表述|用词|名称|未见|未显示|无法直接|视角|角度|局部|未能直接|照片未涵盖/.test(cross.reason||''))return pending('fact-conflict',cross.reason||'已有识别提示实质冲突，缺少足够原文依据自动解除');
  if(!shared.length)return pending('visual-insufficient','原文归属已明确，但现有可见事实不足以核对施工活动；不因文字不同判定冲突');
  basis.push({kind:'existing-vision',analyzedAt:visual.analyzedAt||image.analyzedAt||'',model:visual.model||image.model||'',matchedActivities:shared,excerpt:facts.filter(positive).join('；').slice(0,1800)});
  reasons.push(`原文确认${weekly?'本周期间':'日报日期'}及车间`, `已有照片事实与“${shared.join('、')}”相符`, '表述及视角差异不作为冲突');
  return result('passed','source-consistent',reasons.join('；'),{confirmedDate:sourceDate,confirmedWorkshop:workshop,resolvedRecordId:selected?.id||'',dateMeaning:weekly?'周报期间结束日，非精确拍摄日':'所属日报日期，非精确拍摄日'});
}
