import {compareImageEvidence} from './image-analysis.js';
import {standardWorkshop} from './workshop-status.js';

const stopRE=/停工|暂停施工|中止施工|\bstopped\b|\bsuspended\b/i;
const notStoppedRE=/未停工|不停工|没有停工|并未停工|未暂停施工|未中止施工/gi;
const noCrewRE=/(?:今日|当日|现场)?暂无(?:人员|工人).*施工|无人施工|零施工人员|无施工人员/i;
const waitingRE=/暂未安排施工|等待(?:施工|浇筑|材料|设备|作业)|待施工|具备施工条件/i;
const notStartedRE=/尚未开工|未开展施工|未开始施工/i;
const activeRE=/施工|绑扎|浇筑|拆除|回填|安装|开挖|养护|清理|放线|搭设|破碎|砌筑/i;
const progressRE=/已完成|完成约|浇筑|拆除|回填|安装|开挖|清理|放线|搭设|绑扎|破碎|砌筑/i;
const norm=value=>String(value||'').toLowerCase().replace(/[\s，。；、,.!！?？:：()（）【】\[\]"']/g,'');
const grams=value=>{const text=norm(value),out=new Set();for(let i=0;i<text.length-1;i++)out.add(text.slice(i,i+2));return out;};
const similarity=(left,right)=>{const a=grams(left),b=grams(right);if(!a.size||!b.size)return 0;let common=0;for(const item of a)if(b.has(item))common++;return common/(a.size+b.size-common);};
const trustedText=row=>[['status',row.status],['constructionContent',row.constructionContent],['rawRecord',row.rawRecord]].filter(([field,value])=>value&&!row.reviewFields?.includes(field)).map(([,value])=>value).join(' ');
const textOf=rows=>rows.map(trustedText).filter(Boolean).join('；');
const explicitlyStopped=text=>stopRE.test(String(text||'').replace(notStoppedRE,''));
const validNumber=value=>typeof value==='number'&&Number.isFinite(value);
const explicitZeroCrew=row=>row.staffScope==='车间施工人数'&&!row.reviewFields?.some(field=>['chineseStaff','localStaff','staffScope'].includes(field))&&row.chineseStaff===0&&row.localStaff===0;
const genericProcess=value=>!value||/未报告|待复核|多工序|土建施工/.test(value);
const comparableProcess=(left,right)=>{const a=left.filter(value=>!genericProcess(value)),b=right.filter(value=>!genericProcess(value));return !a.length||!b.length||a.some(value=>b.includes(value));};

function dayRows(rows){
  const grouped=new Map();for(const row of rows){if(!grouped.has(row.date))grouped.set(row.date,[]);grouped.get(row.date).push(row);}
  return [...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>{const text=textOf(items),images=[],rowTexts=items.map(row=>({row,text:trustedText(row)})),activeRows=rowTexts.filter(({text:value})=>activeRE.test(value)&&!explicitlyStopped(value)&&!noCrewRE.test(value)&&!waitingRE.test(value)&&!notStartedRE.test(value));return {date,rows:items,text,images,processes:[...new Set(items.map(row=>row.process).filter(Boolean))],reports:[...new Set(items.map(row=>row.id).filter(Boolean))],sources:[...new Set(items.map(row=>row.sourceFile||row.reportName).filter(Boolean))],explicitStop:items.some(row=>row.siteVerifiedStop===true)||(rowTexts.some(({text:value})=>explicitlyStopped(value))&&!activeRows.length),noCrew:items.some(row=>explicitZeroCrew(row)||noCrewRE.test(trustedText(row))),waiting:waitingRE.test(text),notStarted:notStartedRE.test(text),active:activeRows.length>0,categories:new Set(),reasons:[],photoIds:new Set(),contrary:false};});
}

function quantityAdvanced(previous,current){
  for(const row of current.rows){if(validNumber(row.dailyConcrete)&&row.dailyConcrete>0)return true;const prior=previous.rows.find(item=>item.process===row.process&&item.workUnit===row.workUnit);if(prior&&validNumber(row.cumulativeConcrete)&&validNumber(prior.cumulativeConcrete)&&row.cumulativeConcrete>prior.cumulativeConcrete)return true;if(prior&&validNumber(row.actualProgress)&&validNumber(prior.actualProgress)&&row.actualProgress>prior.actualProgress)return true;}return false;
}

function photoSignal(previous,current){
  let best=null;for(const left of previous.images)for(const right of current.images){if(!comparableProcess([left.relatedProcess],[right.relatedProcess]))continue;const compared=compareImageEvidence(left,right);if(compared.duplicate){best={kind:'duplicate',score:1,ids:[left.imageId,right.imageId]};continue;}if((left.visionEnabled||left.manualReviewed)&&(right.visionEnabled||right.manualReviewed)&&compared.evidenceWeight>=.45&&compared.similarity>=.78&&(!best||compared.similarity>best.score))best={kind:'similar',score:compared.similarity,ids:[left.imageId,right.imageId]};}return best;
}

function markPair(previous,current){
  if(!comparableProcess(previous.processes,current.processes))return;
  const blocked=previous.explicitStop||current.explicitStop||previous.noCrew||current.noCrew||previous.waiting||current.waiting||previous.notStarted||current.notStarted,score=similarity(previous.text,current.text),advanced=quantityAdvanced(previous,current);
  if(!blocked&&score>=.82&&!advanced){for(const day of [previous,current]){day.categories.add('text');day.reasons.push(`连续施工描述高度相似（${Math.round(score*100)}%）`);}}
  const photo=photoSignal(previous,current);if(photo){for(const day of [previous,current]){day.categories.add('photo');photo.ids.forEach(id=>day.photoIds.add(id));day.reasons.push(photo.kind==='duplicate'?'跨日报重复使用同一照片':`施工场景高度相似（${Math.round(photo.score*100)}%）`);}}
  const changed=score<.7&&current.active&&progressRE.test(current.text);current.contrary=advanced||changed||current.images.some(image=>(image.visibleFacts||[]).some(fact=>/工人|施工人员/.test(fact)&&/作业|施工|绑扎|安装|操作/.test(fact)));
}

function segments(days){const result=[];let run=[];const flush=()=>{if(run.length)result.push(run);run=[];};for(const day of days){const abnormal=day.explicitStop||day.categories.size;if(abnormal&&!day.contrary)run.push(day);else flush();}flush();return result;}
const classification=run=>{if(run.some(day=>day.explicitStop))return '确认停工';const categories=new Set(run.flatMap(day=>[...day.categories]));return run.length>=3&&categories.size>=2?'高度疑似停工':'疑似停滞';};
const summary=run=>({status:classification(run),startDate:run[0].date,endDate:run.at(-1).date,days:run.length,categories:[...new Set(run.flatMap(day=>[...day.categories]))],reasons:[...new Set(run.flatMap(day=>day.reasons))],reportIds:[...new Set(run.flatMap(day=>day.reports))],sources:[...new Set(run.flatMap(day=>day.sources))],photoIds:[...new Set(run.flatMap(day=>[...day.photoIds]))]});

export function analyzeWorkshopStoppageEvidence(records,images=[],{date='',workshop='',process='',mappings=[]}={}){
  const usable=records.filter(row=>row.recordType!=='personnel-summary'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')&&row.workshop&&!row.reviewFields?.some(field=>['date','workshop'].includes(field))&&(!date||row.date<=date)&&(!workshop||standardWorkshop(row.workshop,mappings)===standardWorkshop(workshop,mappings))&&(!process||row.process===process)),groups=new Map();
  for(const row of usable){const name=standardWorkshop(row.workshop,mappings);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(row);}
  const results=[];for(const [name,rows] of groups){const days=dayRows(rows),byDate=new Map(days.map(day=>[day.date,day]));for(const image of images){if(image.ignored||image.decorative||image.logoConfirmed||standardWorkshop(image.relatedWorkshop,mappings)!==name||!byDate.has(image.relatedDate)||(process&&image.relatedProcess!==process))continue;byDate.get(image.relatedDate).images.push(image);}for(const day of days){if(day.noCrew){day.categories.add('personnel');day.reasons.push('日报明确记录无人施工或车间施工人数为零');}}for(let i=1;i<days.length;i++)markPair(days[i-1],days[i]);const history=segments(days).map(summary),latest=days.at(-1),currentRun=history.find(item=>item.endDate===latest.date);let current;
    if(latest.explicitStop)current=currentRun||summary([latest]);else if(latest.notStarted)current={status:'未开展施工',startDate:latest.date,endDate:latest.date,days:1,reasons:['最新日报明确记录尚未开展施工'],categories:[],reportIds:latest.reports,sources:latest.sources,photoIds:[]};else if(latest.waiting)current={status:'等待施工',startDate:latest.date,endDate:latest.date,days:1,reasons:['最新日报为等待安排、条件或工序衔接'],categories:[],reportIds:latest.reports,sources:latest.sources,photoIds:[]};else if(currentRun)current=currentRun;else if(latest.active&&history.length)current={status:'已恢复施工',startDate:history.at(-1).startDate,endDate:latest.date,days:history.at(-1).days,reasons:[`最新日报 ${latest.date} 出现施工恢复记录`,...history.at(-1).reasons],categories:history.at(-1).categories,reportIds:[...history.at(-1).reportIds,...latest.reports],sources:[...new Set([...history.at(-1).sources,...latest.sources])],photoIds:history.at(-1).photoIds,recoveredFrom:history.at(-1)};else current={status:latest.active?'正常施工':'数据不足',startDate:latest.date,endDate:latest.date,days:1,reasons:[latest.active?'最新日报存在具体施工活动':'最新日报未提供足够判断信息'],categories:[],reportIds:latest.reports,sources:latest.sources,photoIds:[]};results.push({workshop:name,latestDate:latest.date,latestProcesses:latest.processes,current,history});}
  const rank={'确认停工':0,'高度疑似停工':1,'疑似停滞':2,'已恢复施工':3,'等待施工':4,'未开展施工':5,'数据不足':6,'正常施工':7};return results.sort((a,b)=>(rank[a.current.status]??9)-(rank[b.current.status]??9)||a.workshop.localeCompare(b.workshop));
}
