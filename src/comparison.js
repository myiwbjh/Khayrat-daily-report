import {evidenceOf} from './report-model.js';
import {standardWorkshop} from './workshop-status.js';

const clean=value=>String(value||'').trim();
const normalized=value=>clean(value).normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const unique=values=>[...new Set(values.flat().map(clean).filter(Boolean))];
const known=(r,field)=>r&&!r.reviewFields?.includes(field)&&r[field]!=null&&r[field]!=='';
const activityKey=r=>[r.recordType==='personnel-summary'?`personnel-${r.personnelStatistics?.scope||r.staffScope}-${r.personnelStatistics?.timeBasis||'current'}`:r.activityId||r.process||r.constructionContent||'',r.equipmentName||''].map(normalized).join('|');
const evidenceKey=e=>[e.date,e.sourceFile,e.pageNumber,e.sourceRow,e.process,e.activityId,e.constructionContent,e.excerpt].join('|');
const distinct=(items,key)=>[...new Map(items.map(item=>[key(item),item])).values()];
const change=(before,after)=>before!=null&&after!=null?after-before:null;
function state(value){if(/^(停工|stopped|suspended)$/i.test(value))return 0;if(/^(施工中|作业中|construction|working|in progress)$/i.test(value))return 1;if(/^(完成|已完成|completed)$/i.test(value))return 2;return null;}

function sideValue(rows,field){
  const values=[...new Set(rows.filter(r=>known(r,field)).map(r=>r[field]))];
  return values.length===1?values[0]:null;
}
function quantityTotal(groups,side,field){
  let total=0,found=false;
  for(const group of groups){
    const rows=group[side],values=[...new Set(rows.filter(r=>known(r,field)).map(r=>r[field]))];
    if(!rows.length)continue;
    if(values.length!==1)return null;
    total+=values[0];found=true;
  }
  return found?total:null;
}
function photoKey(image){return `${image.relatedDate||''}|${image.contentSignature||image.visualFingerprint||image.pixelHash||image.imageId}`;}
function compareActivity(group){
  const before=group.before[0],after=group.after[0],display=after||before,notes=[];
  if(group.before.length!==1||group.after.length!==1)notes.push(!before?'前期原文未报告该活动':!after?'后期原文未报告该活动':'同一活动存在多条原文记录，全部保留且不自动覆盖');
  const comparable=group.before.length===1&&group.after.length===1;
  const comparableScope=comparable&&before.staffScope&&before.staffScope===after.staffScope&&!before.reviewFields?.includes('staffScope')&&!after.reviewFields?.includes('staffScope');
  const comparableUnit=comparable&&before.workUnit&&before.workUnit===after.workUnit&&!before.reviewFields?.includes('workUnit')&&!after.reviewFields?.includes('workUnit');
  const changes={
    chineseStaff:comparableScope?change(sideValue(group.before,'chineseStaff'),sideValue(group.after,'chineseStaff')):null,
    localStaff:comparableScope?change(sideValue(group.before,'localStaff'),sideValue(group.after,'localStaff')):null,
    dailyQuantity:comparableUnit?change(sideValue(group.before,'dailyConcrete'),sideValue(group.after,'dailyConcrete')):null,
    cumulativeQuantity:comparableUnit?change(sideValue(group.before,'cumulativeConcrete'),sideValue(group.after,'cumulativeConcrete')):null,
    actualProgress:comparable?change(sideValue(group.before,'actualProgress'),sideValue(group.after,'actualProgress')):null
  };
  if(comparable&&!comparableScope&&(group.before.some(r=>r.chineseStaff!=null||r.localStaff!=null)||group.after.some(r=>r.chineseStaff!=null||r.localStaff!=null)))notes.push('人员口径缺失或不同，未计算人数变化');
  if(comparable&&!comparableUnit&&(group.before.some(r=>r.dailyConcrete!=null||r.cumulativeConcrete!=null)||group.after.some(r=>r.dailyConcrete!=null||r.cumulativeConcrete!=null)))notes.push('工程量单位缺失或不同，未计算工程量变化');
  const signals=[];
  if(comparable){const s0=state(before.status),s1=state(after.status);if(s0!=null&&s1!=null)signals.push(Math.sign(s1-s0));if(changes.actualProgress!=null)signals.push(Math.sign(changes.actualProgress));if(changes.dailyQuantity!=null)signals.push(Math.sign(changes.dailyQuantity));}
  if(changes.cumulativeQuantity!=null&&changes.cumulativeQuantity<0)notes.push('累计工程量原文数值下降，保留原值并标注差异');
  const positive=signals.includes(1),negative=signals.includes(-1);
  if(positive&&negative)notes.push('施工状态、进度或当日工程量变化方向不一致');
  const classification=!comparable?'信息不足':positive&&negative||changes.cumulativeQuantity<0?'数据差异':positive?'改善':negative?'恶化':signals.length?'无变化':'信息不足';
  return {key:group.key,processes:unique([...group.before.map(r=>r.process),...group.after.map(r=>r.process)]),activityIds:unique([...group.before.map(r=>r.activityId),...group.after.map(r=>r.activityId)]),before:group.before,after:group.after,display,changes,notes,classification,unit:comparableUnit?after.workUnit:''};
}

// Compare one card per standardized workshop. Source rows and photos stay intact and are only grouped for display.
export function compareReports(records,{beforeDate,afterDate,images=[]}={}){
  const dates=[...new Set(records.map(r=>r.date).filter(Boolean))].sort();
  afterDate ||= dates.at(-1);beforeDate ||= dates.filter(d=>d<afterDate).at(-1);
  if(!beforeDate||!afterDate||beforeDate>=afterDate)return {beforeDate,afterDate,rows:[],warnings:['需要至少两份不同日期的日报，且前期日期早于后期日期。']};
  const workshops=new Map();
  for(const record of records.filter(r=>r.date===beforeDate||r.date===afterDate)){
    const workshop=standardWorkshop(record.workshop);if(!workshop)continue;
    if(!workshops.has(workshop))workshops.set(workshop,{workshop,before:[],after:[]});
    workshops.get(workshop)[record.date===beforeDate?'before':'after'].push(record);
  }
  const rows=[...workshops.values()].map(group=>{
    const activityGroups=new Map();
    for(const side of ['before','after'])for(const record of group[side]){const key=activityKey(record);if(!activityGroups.has(key))activityGroups.set(key,{key,before:[],after:[]});activityGroups.get(key)[side].push(record);}
    const groups=[...activityGroups.values()],items=groups.map(compareActivity),all=[...group.before,...group.after];
    const processes={before:unique(group.before.map(r=>r.process)),after:unique(group.after.map(r=>r.process))};
    const activities={before:unique(group.before.flatMap(r=>[r.constructionContent,r.activities||[]])),after:unique(group.after.flatMap(r=>[r.constructionContent,r.activities||[]]))};
    const units=unique(all.map(r=>r.workUnit)),commonUnit=units.length===1?units[0]:'';
    const changes={
      chineseStaff:change(sideValue(group.before,'chineseStaff'),sideValue(group.after,'chineseStaff')),
      localStaff:change(sideValue(group.before,'localStaff'),sideValue(group.after,'localStaff')),
      dailyQuantity:commonUnit?change(quantityTotal(groups,'before','dailyConcrete'),quantityTotal(groups,'after','dailyConcrete')):null,
      cumulativeQuantity:commonUnit?change(quantityTotal(groups,'before','cumulativeConcrete'),quantityTotal(groups,'after','cumulativeConcrete')):null
    };
    const related=distinct(images.filter(image=>!image.ignored&&standardWorkshop(image.relatedWorkshop)===group.workshop&&(image.relatedDate===beforeDate||image.relatedDate===afterDate)),photoKey);
    const photos={before:related.filter(image=>image.relatedDate===beforeDate),after:related.filter(image=>image.relatedDate===afterDate)};
    const evidence=distinct(all.map(record=>({...evidenceOf(record),process:record.process||'',activityId:record.activityId||'',constructionContent:record.constructionContent||''})),evidenceKey),notes=unique(items.flatMap(item=>item.notes));
    const classes=items.map(item=>item.classification),classification=classes.includes('数据差异')||classes.includes('恶化')&&classes.includes('改善')?'数据差异':classes.includes('信息不足')?'信息不足':classes.includes('恶化')?'恶化':classes.includes('改善')?'改善':classes.every(value=>value==='无变化')?'无变化':'信息不足';
    const snapshot=side=>({constructionContent:activities[side].join('；'),equipmentStatus:unique(group[side].map(r=>r.equipmentStatus)).join('；'),risk:unique(group[side].map(r=>r.risk)).join('；'),statuses:unique(group[side].map(r=>r.status))});
    return {workshop:group.workshop,before:snapshot('before'),after:snapshot('after'),processes,activities,items,evidence,photos,photoCount:related.length,changes,unit:commonUnit,notes,classification,statusChange:`${snapshot('before').statuses.join(' / ')||'未报告'} → ${snapshot('after').statuses.join(' / ')||'未报告'}`};
  }).sort((a,b)=>a.workshop.localeCompare(b.workshop));
  const gap=Math.round((new Date(afterDate)-new Date(beforeDate))/86400000);
  return {beforeDate,afterDate,rows,warnings:gap>1?[`两份日报相隔 ${gap} 天；不推断中间缺失日期的施工情况。`]:[]};
}
