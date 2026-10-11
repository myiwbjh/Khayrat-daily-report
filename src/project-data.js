import {parseReportDate} from './report-model.js';

const text=value=>String(value??'').trim();
const number=value=>{if(value===''||value==null)return null;const n=Number(String(value).replace(/[,% ]/g,''));return Number.isFinite(n)?n:null;};
const valueOf=(row,aliases)=>{const entries=Object.fromEntries(Object.entries(row).map(([k,v])=>[k.trim().toLowerCase(),v]));const key=aliases.find(alias=>Object.hasOwn(entries,alias.toLowerCase()));return key?entries[key.toLowerCase()]:'';};
export const stableId=(prefix,parts,projectId='khayrat')=>`${prefix}:${encodeURIComponent(JSON.stringify([projectId,...parts.map(text)]))}`;
export const monthEnd=value=>{const date=parseReportDate(value)||(/^\d{4}-\d{2}$/.test(value)?parseReportDate(`${value}-01`):'');if(!date)return '';const [y,m]=date.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};

export const PROGRESS_HEADERS=['WBS','分部分项','权重','总量','单位','月份','月度计划量','月度实际量','计划月完成比例','计划累计完成比例','实际月完成比例','实际累计完成比例'];
export const SHIPMENT_HEADERS=['设备类别','设备名称','供应商','Package/Lot','发运批次','数量','单位','重量','重量单位','发货日期','POL','POD','ETA','到港日期','清关状态','现场到货日期','当前状态','Installation Area / Intended Workshop'];
export const CROSSWALK_HEADERS=['来源类型','来源值','目标类型','目标值','关系','备注'];

export function normalizeProgressRows(rows,source='unknown',projectId='khayrat'){
  const aliases={wbs:['WBS','wbs_code','wbs'],item:['分部分项','WBS名称','工作项','item'],weight:['权重','weight'],total:['总量','total_quantity'],unit:['单位','unit'],month:['月份','month','日期'],plannedMonthlyQuantity:['月度计划量','planned_monthly_quantity'],actualMonthlyQuantity:['月度实际量','actual_monthly_quantity'],plannedMonthlyPct:['计划月完成比例','planned_monthly_pct'],plannedCumulativePct:['计划累计完成比例','planned_cumulative_pct'],actualMonthlyPct:['实际月完成比例','actual_monthly_pct'],actualCumulativePct:['实际累计完成比例','actual_cumulative_pct']};
  return rows.map((row,index)=>{const out={sourceFile:source,sourceRow:index+2,sourceType:'progress'};for(const [field,names] of Object.entries(aliases))out[field]=['weight','total','plannedMonthlyQuantity','actualMonthlyQuantity','plannedMonthlyPct','plannedCumulativePct','actualMonthlyPct','actualCumulativePct'].includes(field)?number(valueOf(row,names)):text(valueOf(row,names));out.month=monthEnd(out.month);out.projectId=projectId;out.id=stableId('progress',[out.wbs,out.item,out.month],projectId);out.reviewFields=[];if(!out.wbs&&!out.item)out.reviewFields.push('wbs/item');if(!out.month)out.reviewFields.push('month');if(out.weight!=null&&out.weight<0)out.reviewFields.push('weight');return {...out,needsReview:out.reviewFields.length>0};}).filter(r=>r.wbs||r.item);
}

export function normalizeShipmentRows(rows,source='unknown',projectId='khayrat'){
  const aliases={category:['设备类别','category'],equipmentName:['设备名称','equipment_name'],supplier:['供应商','supplier'],packageLot:['Package/Lot','Package','Lot','package_lot'],shipmentBatch:['发运批次','shipment_batch'],quantity:['数量','quantity'],unit:['单位','unit'],weight:['重量','weight'],weightUnit:['重量单位','weight_unit'],shippingDate:['发货日期','shipping_date'],pol:['POL','装货港'],pod:['POD','卸货港'],eta:['ETA','预计到港日期'],arrivalDate:['到港日期','arrival_date'],customsStatus:['清关状态','customs_status'],siteArrivalDate:['现场到货日期','site_arrival_date'],status:['当前状态','status'],installationArea:['Installation Area / Intended Workshop','安装区域','拟安装车间','installation_area']};
  return rows.map((row,index)=>{const out={sourceFile:source,sourceRow:index+2,sourceType:'shipment'};for(const [field,names] of Object.entries(aliases)){const raw=valueOf(row,names);out[field]=['quantity','weight'].includes(field)?number(raw):['shippingDate','eta','arrivalDate','siteArrivalDate'].includes(field)?parseReportDate(raw):text(raw);}out.projectId=projectId;out.id=stableId('shipment',[out.category,out.supplier,out.packageLot,out.shipmentBatch,out.equipmentName],projectId);out.reviewFields=[];if(!out.category)out.reviewFields.push('category');if(!out.equipmentName)out.reviewFields.push('equipmentName');if(!out.packageLot&&!out.shipmentBatch)out.reviewFields.push('packageLot/shipmentBatch');return {...out,needsReview:out.reviewFields.length>0};}).filter(r=>r.category||r.equipmentName||r.packageLot);
}

export function normalizeCrosswalkRows(rows,source='unknown',projectId='khayrat'){
  const aliases={sourceType:['来源类型','source_type'],sourceValue:['来源值','source_value'],targetType:['目标类型','target_type'],targetValue:['目标值','target_value'],relation:['关系','relation'],note:['备注','note']};
  return rows.map((row,index)=>{const out={sourceFile:source,sourceRow:index+2};for(const [field,names] of Object.entries(aliases))out[field]=text(valueOf(row,names));out.relation=out.relation||'related';out.projectId=projectId;out.id=stableId('mapping',[out.sourceType,out.sourceValue,out.targetType,out.targetValue,out.relation],projectId);return out;}).filter(r=>r.sourceType&&r.sourceValue&&r.targetType&&r.targetValue);
}

const latestBy=(rows,key,dateField)=>{const map=new Map();for(const row of [...rows].sort((a,b)=>String(a[dateField]||'').localeCompare(String(b[dateField]||''))))map.set(key(row),row);return [...map.values()];};
export function currentProgressRows(rows){
  const workbook=rows.filter(row=>row.sourceType==='progress-workbook'&&row.snapshotRole==='current');
  if(!workbook.length)return rows.filter(row=>row.snapshotRole!=='historical-plan');
  const hasAuthoritativeState=workbook.some(row=>typeof row.batchCurrentVersion==='boolean'||row.batchImportStatus);
  const eligible=hasAuthoritativeState?workbook.filter(row=>row.batchCurrentVersion===true&&row.batchImportStatus==='complete'):workbook;
  if(!eligible.length)return [];
  const batches=new Map();for(const row of eligible){const key=row.importBatchId||row.fileHash||row.sourceFile;const stamp=String(row.importedAt||'');if(!batches.has(key)||stamp>batches.get(key))batches.set(key,stamp);}
  const current=[...batches].sort((a,b)=>a[1].localeCompare(b[1])).at(-1)?.[0];
  return eligible.filter(row=>(row.importBatchId||row.fileHash||row.sourceFile)===current);
}
// A monthly cumulative value is an end-of-month observation, never a day-1 fact.
export function analyzeProgress(rows,{asOf=new Date().toISOString().slice(0,10)}={}){
  const selected=currentProgressRows(rows),valid=selected.filter(r=>monthEnd(r.month)&&r.isLeaf!==false).map(r=>({...r,month:monthEnd(r.month)}));
  const key=r=>JSON.stringify([r.projectId||'khayrat',r.wbs||r.item]);
  const universe=new Map();for(const r of valid){const k=key(r);if(!universe.has(k))universe.set(k,[]);universe.get(k).push(r);}
  const weights=new Map(),issues=[];for(const [k,items] of universe){const values=[...new Set(items.map(r=>r.weight).filter(w=>Number.isFinite(w)&&w>=0))];if(values.length!==1||items.some(r=>!Number.isFinite(r.weight)||r.weight<0))issues.push(`weight:${k}`);else if(values[0]>0)weights.set(k,values[0]);}
  const totalWeight=[...weights.values()].reduce((a,b)=>a+b,0);
  const aggregate=(items,field,cutoff)=>{const byKey=new Map(items.map(r=>[key(r),r]));let sum=0,coveredWeight=0;for(const [k,w] of weights){const r=byKey.get(k),validPercent=Number.isFinite(r?.[field])&&r[field]>=0&&(r[field]<=100||r.managementBaselineTotal!=null);if(r?.month===cutoff&&validPercent){sum+=r[field]*w;coveredWeight+=w;}}
    return {value:!issues.length&&totalWeight>0&&coveredWeight===totalWeight?sum/totalWeight:null,coveredWeight,totalWeight};};
  const currentEnd=monthEnd(asOf),d=new Date(`${currentEnd}T00:00:00Z`),cutoff=asOf>=currentEnd?currentEnd:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0)).toISOString().slice(0,10);
  const latest=latestBy(valid.filter(r=>r.month<=cutoff),key,'month');
  const planned=aggregate(latest,'plannedCumulativePct',cutoff),actual=aggregate(latest,'actualCumulativePct',cutoff),plannedMonthly=aggregate(latest,'plannedMonthlyPct',cutoff),actualMonthly=aggregate(latest,'actualMonthlyPct',cutoff);
  const timeline=[...new Set(valid.map(r=>r.month))].sort().map(month=>{const items=latestBy(valid.filter(r=>r.month<=month),key,'month');return {month,planned:aggregate(items,'plannedCumulativePct',month).value,actual:month<=cutoff?aggregate(items,'actualCumulativePct',month).value:null};});
  return {planned:planned.value,actual:actual.value,variance:planned.value!=null&&actual.value!=null?actual.value-planned.value:null,plannedMonthly:plannedMonthly.value,actualMonthly:actualMonthly.value,timeline,latest:latest.map(r=>({...r,stale:r.month!==cutoff})),cutoff,totalWeight,coverage:{planned,actual,plannedMonthly,actualMonthly},issues,selected};
}

export function summarizeProgress(rows,options={}){
  const analysis=analyzeProgress(rows,options),current=analysis.latest.filter(row=>!row.stale),disciplines=[];
  const names=[...new Set(current.map(row=>row.discipline||'未分类'))];
  for(const name of names){const items=current.filter(row=>(row.discipline||'未分类')===name),weight=items.reduce((sum,row)=>sum+(Number.isFinite(row.weight)?row.weight:0),0),weighted=field=>weight?items.reduce((sum,row)=>sum+(Number.isFinite(row[field])?row[field]*row.weight:0),0)/weight:null;disciplines.push({name,weight,plannedCompletion:weighted('plannedCumulativePct'),actualCompletion:weighted('actualCumulativePct'),contributionToProject:analysis.totalWeight?items.reduce((sum,row)=>sum+(Number.isFinite(row.actualCumulativePct)?row.actualCumulativePct*row.weight:0),0)/analysis.totalWeight:null});}
  const lagging=current.filter(row=>Number.isFinite(row.plannedCumulativePct)&&Number.isFinite(row.actualCumulativePct)).map(row=>({...row,variance:row.actualCumulativePct-row.plannedCumulativePct,contributionToProject:analysis.totalWeight?row.actualCumulativePct*row.weight/analysis.totalWeight:null})).sort((a,b)=>a.variance-b.variance).slice(0,8);
  const workbook=currentProgressRows(rows),currentBatch=workbook[0]?.importBatchId||'',batches=[...new Map(rows.filter(row=>row.sourceType==='progress-workbook'&&row.snapshotRole==='current'&&row.batchImportStatus!=='failed'&&row.batchImportStatus!=='importing').map(row=>[row.importBatchId,{id:row.importBatchId,importedAt:row.importedAt,fileHash:row.fileHash,sourceFile:row.sourceFile}])).values()].sort((a,b)=>String(a.importedAt).localeCompare(String(b.importedAt))),currentIndex=batches.findIndex(batch=>batch.id===currentBatch),previousBatch=currentIndex>0?batches[currentIndex-1]:null;
  const snapshot=batch=>new Map(rows.filter(row=>row.importBatchId===batch&&row.snapshotRole==='current').map(row=>[`${row.wbs}|${row.month}`,row]));let versionDiff=null;
  if(previousBatch){const before=snapshot(previousBatch.id),after=snapshot(currentBatch),quantityAdjusted=new Set(),weightAdjusted=new Set(),planAdjusted=new Set(),beforeWbs=new Set([...before.values()].map(row=>row.wbs)),afterWbs=new Set([...after.values()].map(row=>row.wbs));let actualChange=null;for(const [key,row] of after){const old=before.get(key);if(!old)continue;if(row.baselineTotal!==old.baselineTotal)quantityAdjusted.add(row.wbs);if(row.weight!==old.weight)weightAdjusted.add(row.wbs);if(row.plannedMonthlyQuantity!==old.plannedMonthlyQuantity)planAdjusted.add(row.wbs);}const previous=analyzeProgress(rows.filter(row=>row.importBatchId===previousBatch.id),options);if(previous.actual!=null&&analysis.actual!=null)actualChange=analysis.actual-previous.actual;versionDiff={previous:previousBatch,current:batches[currentIndex],wbsAdded:[...afterWbs].filter(wbs=>!beforeWbs.has(wbs)),wbsRemoved:[...beforeWbs].filter(wbs=>!afterWbs.has(wbs)),quantityAdjusted:[...quantityAdjusted],weightAdjusted:[...weightAdjusted],planAdjusted:[...planAdjusted],actualChange};}
  const metadata=workbook.find(row=>row.workbookMeta)?.workbookMeta,qualityIssues=metadata?.qualityIssues||[...new Map(workbook.filter(row=>row.quantityMismatch).map(row=>[row.wbs,{type:'plan-tracking-quantity',wbs:row.wbs,item:row.item,excelPlanTotal:row.baselineTotal,baselineTotal:row.baselineTotal,trackingTotal:row.trackingTotal,unit:row.unit,difference:row.trackingTotal-row.baselineTotal,reason:'Excel 原始计划与实际跟踪总量不一致',status:'To Be Verified'}])).values()];
  return {...analysis,disciplines,lagging,versionDiff,currentBatch,qualityIssues};
}

const node=(type,value)=>JSON.stringify([type,text(value)]);
export function crossAnalyze({reports=[],progress=[],shipments=[],mappings=[],asOf=new Date().toISOString().slice(0,10),projectId='khayrat'}){
  const sameProject=r=>(r.projectId||r.project_id||'khayrat')===projectId;
  progress=progress.filter(sameProject);shipments=shipments.filter(sameProject);mappings=mappings.filter(sameProject);reports=reports.filter(sameProject);
  const findings=[],adj=new Map();
  for(const m of mappings){const a=node(m.sourceType,m.sourceValue),b=node(m.targetType,m.targetValue);for(const [from,to] of [[a,b],[b,a]]){if(!adj.has(from))adj.set(from,new Set());adj.get(from).add(to);}}
  const reachable=roots=>{const seen=new Set(roots),queue=[...roots];while(queue.length){for(const next of adj.get(queue.shift())||[])if(!seen.has(next)){seen.add(next);queue.push(next);}}return seen;};
  const latestProgress=analyzeProgress(progress,{asOf}),current=latestProgress.latest.filter(p=>!p.stale);
  const arrived=s=>s.siteArrivalDate?s.siteArrivalDate<=asOf:/^(现场到货|已到现场|已到场|site delivered|delivered to site)$/i.test(text(s.status));
  for(const shipment of shipments.filter(arrived)){
    const linked=reachable([node('equipment_category',shipment.category),node('equipment_item',shipment.equipmentName),...(shipment.installationArea?[node('installation_area',shipment.installationArea)]:[])]);
    const delayed=current.filter(p=>(linked.has(node('wbs',p.wbs))||linked.has(node('wbs_item',p.item)))&&Number.isFinite(p.plannedCumulativePct)&&Number.isFinite(p.actualCumulativePct)&&p.actualCumulativePct-p.plannedCumulativePct<=-5);
    if(delayed.length)findings.push({type:'inference',severity:'high',title:'制约可能已由物流转为土建',facts:[`${shipment.equipmentName} 已到场/现场到货`,...delayed.map(p=>`${p.wbs||p.item} ${p.month} 实际累计 ${p.actualCumulativePct}% / 计划 ${p.plannedCumulativePct}%`)],basis:'设备物流与带类型 Crosswalk 映射后的规则判断',confirmation:'需项目团队确认基础是否具备安装条件'});
  }
  const from=new Date(new Date(`${asOf}T00:00:00Z`).getTime()-29*86400000).toISOString().slice(0,10);
  const recent=reports.filter(r=>r.date>=from&&r.date<=asOf),stopped=recent.filter(r=>/停工|暂停|\bstopped\b|\bsuspended\b/i.test(`${r.status} ${r.constructionContent} ${r.rawRecord}`));
  const groups=new Map();for(const r of stopped){const k=node(r.workshop,r.process);if(!groups.has(k))groups.set(k,new Set());groups.get(k).add(r.date);}
  const stoppedDays=Math.max(0,...[...groups.values()].map(s=>s.size));
  const people=latestBy(recent.filter(r=>r.staffScope==='项目总人数'),r=>r.date,'date').sort((a,b)=>a.date.localeCompare(b.date)),total=r=>r.totalStaff??(r.chineseStaff!=null&&r.localStaff!=null?r.chineseStaff+r.localStaff:null);
  const headcountDrop=people.length>1&&total(people.at(-1))!=null&&total(people.at(-2))!=null&&total(people.at(-1))<total(people.at(-2));
  if(latestProgress.variance!=null&&latestProgress.variance<=-5&&(stoppedDays>=2||headcountDrop))findings.push({type:'inference',severity:'high',title:'进度滞后风险升高',facts:[`截至 ${latestProgress.cutoff} 实际累计较计划偏差 ${latestProgress.variance.toFixed(1)} 个百分点`,stoppedDays>=2?`同一活动近期有 ${stoppedDays} 个日报日明确停工/暂停`:'项目总人数较上一期下降'],basis:'独立进度数据与最近30天日报交叉规则',confirmation:'需核对停工持续性、关键线路及赶工措施'});
  return findings;
}

export function validateHeadcount(record){const total=record.totalStaff??null,components=record.chineseStaff!=null&&record.localStaff!=null?record.chineseStaff+record.localStaff:null;return {total:total??components,reportedTotal:total,components,consistent:total==null||components==null||total===components,needsReview:total!=null&&components!=null&&total!==components};}
