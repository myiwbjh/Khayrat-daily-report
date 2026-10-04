import {evidenceOf} from './report-model.js';
const key=r=>[r.workshop,r.process,r.recordType==='personnel-summary'?`personnel-${r.personnelStatistics?.scope||r.staffScope}-${r.personnelStatistics?.timeBasis||'current'}`:r.activityId||'',r.equipmentName||''].map(x=>String(x||'').trim().toLowerCase()).join('|');
const known=(r,field)=>!r.reviewFields?.includes(field)&&r[field]!=null&&r[field]!=='';
function change(before,after,field){return known(before,field)&&known(after,field)?after[field]-before[field]:null;}
function state(value){if(/^(停工|stopped|suspended)$/i.test(value))return 0;if(/^(施工中|作业中|construction|working|in progress)$/i.test(value))return 1;if(/^(完成|已完成|completed)$/i.test(value))return 2;return null;}

// Compare the latest two available report dates. Missing dates/rows are never zero.
export function compareReports(records,{beforeDate,afterDate}={}){
  const dates=[...new Set(records.map(r=>r.date).filter(Boolean))].sort();
  afterDate ||= dates.at(-1);beforeDate ||= dates.filter(d=>d<afterDate).at(-1);
  if(!beforeDate||!afterDate||beforeDate>=afterDate)return {beforeDate,afterDate,rows:[],warnings:['需要至少两份不同日期的日报，且前期日期早于后期日期。']};
  const groups=new Map();for(const r of records.filter(r=>r.date===beforeDate||r.date===afterDate)){const k=key(r);if(!groups.has(k))groups.set(k,{before:[],after:[]});groups.get(k)[r.date===beforeDate?'before':'after'].push(r);}
  const rows=[...groups].map(([activity,group])=>{
    const before=group.before[0],after=group.after[0],display=after||before,uncertain=[];
    const result={activity,workshop:display.workshop,process:display.process,activityId:display.activityId||'',before,after,evidence:[...group.before,...group.after].map(evidenceOf)};
    if(group.before.length!==1||group.after.length!==1)return {...result,classification:'待复核',notes:[!before?'前期未报告该活动':!after?'后期未报告该活动':'同一活动有多条记录，无法唯一匹配'],changes:{}};
    if(['date','workshop','process'].some(f=>!known(before,f)||!known(after,f)))uncertain.push('关键匹配字段缺失或待复核');
    const comparableScope=before.staffScope&&before.staffScope===after.staffScope&&!before.reviewFields?.includes('staffScope')&&!after.reviewFields?.includes('staffScope');
    const comparableUnit=before.workUnit&&before.workUnit===after.workUnit&&!before.reviewFields?.includes('workUnit')&&!after.reviewFields?.includes('workUnit');
    const changes={chineseStaff:comparableScope?change(before,after,'chineseStaff'):null,localStaff:comparableScope?change(before,after,'localStaff'):null,dailyQuantity:comparableUnit?change(before,after,'dailyConcrete'):null,cumulativeQuantity:comparableUnit?change(before,after,'cumulativeConcrete'):null,actualProgress:change(before,after,'actualProgress')};
    if(!comparableScope)uncertain.push('人员口径缺失或不同，人数不可直接比较');
    if(!comparableUnit)uncertain.push('工程量单位缺失或不同，工程量不可直接比较');
    const s0=known(before,'status')?state(before.status):null,s1=known(after,'status')?state(after.status):null,signals=[];
    if(s0!=null&&s1!=null)signals.push(Math.sign(s1-s0));else uncertain.push('施工状态不足以判断改善或恶化');
    if(changes.actualProgress!=null)signals.push(Math.sign(changes.actualProgress));
    if(changes.cumulativeQuantity!=null&&changes.cumulativeQuantity<0)uncertain.push('累计工程量下降，需核对修订或统计口径');
    if(changes.dailyQuantity!=null)signals.push(Math.sign(changes.dailyQuantity));
    const positive=signals.includes(1),negative=signals.includes(-1);
    const classification=uncertain.includes('关键匹配字段缺失或待复核')||positive&&negative||changes.cumulativeQuantity<0?'待复核':positive?'改善':negative?'恶化':signals.length?'无变化':'待复核';
    if(positive&&negative)uncertain.push('施工状态、进度或当日工程量变化方向冲突');
    return {...result,classification,changes,notes:uncertain,unit:comparableUnit?after.workUnit:'',statusChange:`${before.status||'未报告'} → ${after.status||'未报告'}`,contentChange:before.constructionContent!==after.constructionContent,issueChange:before.risk!==after.risk};
  });
  const gap=Math.round((new Date(afterDate)-new Date(beforeDate))/86400000);
  return {beforeDate,afterDate,rows,warnings:gap>1?[`两份日报相隔 ${gap} 天；不推断中间缺失日期的施工情况。`]:[]};
}
