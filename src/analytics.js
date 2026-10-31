import {latestWorkshopStates,standardWorkshop} from './workshop-status.js';
import {parseReportDate, withProvenance} from './report-model.js';
export const FIELDS = ['reportName','date','workshop','process','activityId','wbsWeight','plannedProgress','actualProgress','dailyConcrete','cumulativeConcrete','workUnit','staffScope','trade','chineseStaff','localStaff','equipmentName','equipmentStatus','risk','status','rawRecord','constructionContent'];
export const ALIASES = {
  constructionContent:['施工内容','construction_content','construction content','work description'], reportName:['日报名称','report_name','report name','report'], date:['日期','date'], workshop:['车间','workshop','area'], process:['工序','process','activity'], activityId:['活动编号','activity_id','activity id'],
  wbsWeight:['WBS权重','wbs_weight','weight'], plannedProgress:['计划进度','planned_progress','planned progress','plan'], actualProgress:['实际进度','actual_progress','actual progress','actual'], dailyConcrete:['实际完成工作量','当日混凝土','daily_concrete','daily concrete','daily_quantity'], cumulativeConcrete:['累计完成量','累计混凝土','cumulative_concrete','cumulative concrete','cumulative_quantity'],
  chineseStaff:['中方人员','chinese_staff','chinese staff'], localStaff:['属地人员','local_staff','local staff'], staffScope:['人员口径','staff_scope'], trade:['工种','trade'], workUnit:['工作量单位','单位','work_unit','unit'], equipmentName:['设备名称','equipment_name','equipment'], equipmentStatus:['设备到货情况','设备状态','equipment_status'], risk:['制约因素','风险制约','风险','risk','constraint'], status:['施工状态','工作状态','状态','status'], rawRecord:['备注','原始记录','raw_record','record','description']
};
const numericFields = new Set(['wbsWeight','plannedProgress','actualProgress','dailyConcrete','cumulativeConcrete','chineseStaff','localStaff']);

export function parseCSV(text) {
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1]; if(c==='"'&&quoted&&n==='"'){field+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}
  row.push(field);if(row.some(v=>v.trim()))rows.push(row); if(!rows.length)return [];
  const headers=rows.shift().map(h=>h.trim().replace(/^\ufeff/,'')); return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}
function number(value){if(value===''||value==null)return null;const n=Number(String(value).replace(/[% ,]/g,''));return Number.isFinite(n)?n:null;}
function validDate(value){if(value instanceof Date&&!isNaN(value))return value.toISOString().slice(0,10);if(Number(value)>20000&&Number(value)<100000){const d=new Date(Date.UTC(1899,11,30)+Number(value)*86400000);return d.toISOString().slice(0,10);}const text=String(value??'').trim().replace(/[./]/g,'-');const d=new Date(text);return !text||isNaN(d)?'':d.toISOString().slice(0,10);}

export function normalizeRows(rows, source='unknown', { allowIncomplete = false } = {}) {
  return rows.map((row,index)=>{const lower=Object.fromEntries(Object.entries(row).map(([k,v])=>[k.trim().toLowerCase(),v]));const out={source,sourceRow:row.__sourceRow||index+2,sourceSheet:row.__sourceSheet||'',rawValues:{}};
    for(const field of FIELDS){const alias=ALIASES[field].find(a=>Object.hasOwn(lower,a.toLowerCase()));let value=alias?lower[alias.toLowerCase()]:'';if(numericFields.has(field)||field==='date')out.rawValues[field]=String(value??'');out[field]=numericFields.has(field)?number(value):String(value??'').trim();}
    out.date=parseReportDate(row['日期']??row.date??out.date);if(!out.reportName)out.reportName=source;return withProvenance(out);
  }).filter(r=>(allowIncomplete||r.date) && (r.workshop||r.equipmentName||r.rawRecord||r.constructionContent));
}
export function filterRecords(records,{date='',workshop='',process='',mappings=[]}={}){return records.filter(r=>r.date&&r.workshop&&r.process&&!['date','workshop','process'].some(f=>r.reviewFields?.includes(f))&&(!date||r.date<=date)&&(!workshop||standardWorkshop(r.workshop,mappings)===standardWorkshop(workshop,mappings))&&(!process||r.process===process));}
const lastBy=(records,key)=>{const map=new Map();[...records].sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>map.set(key(r),r));return [...map.values()];};
const avg=values=>{values=values.filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
const sum=values=>{values=values.filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0):null;};
function bucket(date,period){if(period==='day')return date;if(period==='month')return date.slice(0,7);const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
function peopleByDate(records){return [...new Set(records.map(r=>r.date))].sort().map(date=>{const rows=records.filter(r=>r.date===date&&r.staffScope==='项目总人数');const values=field=>[...new Set(rows.map(r=>r[field]).filter(v=>v!=null))],one=field=>{const found=values(field);return found.length===1?found[0]:null;};const chinese=one('chineseStaff'),local=one('localStaff'),reportedValues=values('totalStaff'),reported=reportedValues.length===1?reportedValues[0]:null,components=chinese!=null&&local!=null?chinese+local:null,flagged=rows.some(r=>r.personnelStatistics?.issues?.length||['chineseStaff','localStaff','totalStaff','personnelStatistics'].some(field=>r.reviewFields?.includes(field)));return {date,chinese,local,total:reportedValues.length?reported:components,reportedTotal:reported,components,needsReview:flagged||reportedValues.length>1||reported!=null&&components!=null&&reported!==components};});}

function weighted(rows,field){const valid=rows.filter(r=>r[field]!=null&&r.wbsWeight>0),weight=sum(valid.map(r=>r.wbsWeight));return weight?valid.reduce((n,r)=>n+r[field]*r.wbsWeight,0)/weight:null;}

export function detectStoppages(records,minDays=3){const groups=new Map();records.forEach(r=>{const key=`${r.workshop}|${r.process}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});const results=[];
  for(const rows of groups.values()){const daily=lastBy(rows,r=>r.date).sort((a,b)=>a.date.localeCompare(b.date));let run=[];const flush=()=>{if(run.length>=minDays)results.push({workshop:run[0].workshop,process:run[0].process,startDate:run[0].date,endDate:run.at(-1).date,days:run.length,evidence:run});run=[];};
    daily.forEach((r,i)=>{const previous=daily[i-1];const explicit=/停工|stopped|suspended/i.test(r.status);const noProgress=r.actualProgress!=null&&previous?.actualProgress===r.actualProgress;const noQuantity=r.dailyConcrete===0||(r.cumulativeConcrete!=null&&r.cumulativeConcrete===previous?.cumulativeConcrete);const noCrew=r.chineseStaff===0&&r.localStaff===0; if(explicit||(noProgress&&noQuantity&&noCrew))run.push(r);else flush();});flush();}
  return results;
}
export function analyzeRecords(records,period='day'){
  if(!records.length)return {kpis:{},quantityGroups:[],timeline:[],workforce:[],maxStaff:0,workshops:[],equipment:[],risks:[],stoppages:[],latestDate:''};const sorted=[...records].sort((a,b)=>a.date.localeCompare(b.date)),latestDate=sorted.at(-1).date,latest=lastBy(sorted.filter(r=>r.recordType!=='personnel-summary'),r=>`${r.workshop}|${r.process}|${r.activityId||''}`),people=peopleByDate(sorted),currentPeople=people.at(-1)||{},previousPeople=people.at(-2);
  const dates=new Map();sorted.forEach(r=>{const b=bucket(r.date,period);if(!dates.has(b))dates.set(b,[]);dates.get(b).push(r);});const timeline=[...dates].map(([date,rows])=>{const last=lastBy(rows,r=>`${r.workshop}|${r.process}|${r.activityId||''}`);return {date,planned:weighted(last,'plannedProgress'),actual:weighted(last,'actualProgress')};});
  const workshops=latestWorkshopStates(sorted);
  const equipment=lastBy(sorted.filter(r=>r.equipmentName),r=>r.equipmentName).map(r=>({name:r.equipmentName,status:r.equipmentStatus||'未标注',workshop:r.workshop,note:r.rawRecord}));
  const stoppages=detectStoppages(sorted),risks=sorted.filter(r=>r.risk).map(r=>({title:r.risk,detail:`${r.workshop||'全项目'} · ${r.process||'未指定工序'}`,date:r.date,reportName:r.reportName}));const installationImpacts=stoppages.map(s=>({title:'连续停工可能影响设备安装',detail:`${s.workshop} · ${s.process} 已连续 ${s.days} 个有效日报日停工，需人工评估对 2026 年 12 月安装目标的影响`,date:s.endDate,reportName:'系统预警',confidence:'待人工评估'}));risks.push(...installationImpacts);
  const dailyQuantityRecords=sorted.filter(r=>r.sourceType!=='weekly-report'),latestDay=dailyQuantityRecords.filter(r=>r.date===latestDate),quantityGroups=[...new Set(dailyQuantityRecords.map(r=>`${r.workshop}|${r.process}|${r.workUnit}`).filter(x=>!x.endsWith('|')))].map(key=>{const [workshop,process,unit]=key.split('|'),rows=latestDay.filter(r=>r.workshop===workshop&&r.process===process&&r.workUnit===unit);const history=dailyQuantityRecords.filter(r=>r.workshop===workshop&&r.process===process&&r.workUnit===unit),known=history.filter(r=>!r.reviewFields?.includes('cumulativeConcrete')&&r.cumulativeConcrete!=null).map(r=>r.cumulativeConcrete);return {workshop,process,unit,daily:rows.some(r=>r.reviewFields?.includes('dailyConcrete'))?null:sum(rows.map(r=>r.dailyConcrete)),cumulative:rows.some(r=>r.reviewFields?.includes('cumulativeConcrete'))||!known.length?null:Math.max(...known)};});const planned=weighted(latest,'plannedProgress'),actual=weighted(latest,'actualProgress');
  return {latestDate,kpis:{planned,actual,variance:planned!=null&&actual!=null?actual-planned:null,chineseStaff:currentPeople.chinese,localStaff:currentPeople.local,totalStaff:currentPeople.total??null,staffNeedsReview:currentPeople.needsReview,staffDelta:previousPeople&&currentPeople.total!=null&&previousPeople.total!=null?currentPeople.total-previousPeople.total:null},quantityGroups,timeline,workforce:people,maxStaff:Math.max(1,...people.map(p=>p.total||0)),workshops,equipment,risks,installationImpacts,stoppages};
}
function quote(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
export function exportCSV(records){return [FIELDS.join(','),...records.map(r=>FIELDS.map(f=>quote(r[f])).join(','))].join('\n');}

