import {parseReportDate} from './report-model.js';

const text=value=>String(value??'').trim();
const number=value=>{if(value===''||value==null)return null;const n=Number(String(value).replace(/[,% ]/g,''));return Number.isFinite(n)?n:null;};
const valueOf=(row,aliases)=>{const entries=Object.fromEntries(Object.entries(row).map(([k,v])=>[k.trim().toLowerCase(),v]));const key=aliases.find(alias=>Object.hasOwn(entries,alias.toLowerCase()));return key?entries[key.toLowerCase()]:'';};
export const stableId=(prefix,parts,projectId='khayrat')=>`${prefix}:${encodeURIComponent(JSON.stringify([projectId,...parts.map(text)]))}`;
export const monthEnd=value=>{const date=parseReportDate(value)||(/^\d{4}-\d{2}$/.test(value)?parseReportDate(`${value}-01`):'');if(!date)return '';const [y,m]=date.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};

export const PROGRESS_HEADERS=['WBS','分部分项','权重','总量','单位','月份','月度计划量','月度实际量','计划月完成比例','计划累计完成比例','实际月完成比例','实际累计完成比例'];
export const SHIPMENT_HEADERS=['序号','设备类别','设备名称','部件名称','规格型号','供应商','Package/Lot','发运批次','数量','单位','包装方式','长度cm','宽度cm','高度cm','体积m3','净重Kg','毛重Kg','发货日期','POL','POD','ETA','到港日期','清关状态','现场到货日期','当前状态','Installation Area / Intended Workshop','备注'];
export const CROSSWALK_HEADERS=['来源类型','来源值','目标类型','目标值','关系','备注'];

export function normalizeProgressRows(rows,source='unknown',projectId='khayrat'){
  const aliases={wbs:['WBS','wbs_code','wbs'],item:['分部分项','WBS名称','工作项','item'],weight:['权重','weight'],total:['总量','total_quantity'],unit:['单位','unit'],month:['月份','month','日期'],plannedMonthlyQuantity:['月度计划量','planned_monthly_quantity'],actualMonthlyQuantity:['月度实际量','actual_monthly_quantity'],plannedMonthlyPct:['计划月完成比例','planned_monthly_pct'],plannedCumulativePct:['计划累计完成比例','planned_cumulative_pct'],actualMonthlyPct:['实际月完成比例','actual_monthly_pct'],actualCumulativePct:['实际累计完成比例','actual_cumulative_pct']};
  return rows.map((row,index)=>{const out={sourceFile:source,sourceRow:index+2,sourceType:'progress'};for(const [field,names] of Object.entries(aliases))out[field]=['weight','total','plannedMonthlyQuantity','actualMonthlyQuantity','plannedMonthlyPct','plannedCumulativePct','actualMonthlyPct','actualCumulativePct'].includes(field)?number(valueOf(row,names)):text(valueOf(row,names));out.month=monthEnd(out.month);out.projectId=projectId;out.id=stableId('progress',[out.wbs,out.item,out.month],projectId);out.reviewFields=[];if(!out.wbs&&!out.item)out.reviewFields.push('wbs/item');if(!out.month)out.reviewFields.push('month');if(out.weight!=null&&out.weight<0)out.reviewFields.push('weight');return {...out,needsReview:out.reviewFields.length>0};}).filter(r=>r.wbs||r.item);
}

export function normalizeShipmentRows(rows,source='unknown',projectId='khayrat'){
  const aliases={packageSequence:['序号','package_sequence'],category:['设备类别','category'],equipmentName:['设备名称','货物名称','equipment_name'],componentName:['部件名称','component_name'],specification:['规格型号','Specification','specification'],supplier:['供应商','供货厂家','supplier'],packageLot:['Package/Lot','包装编号','外包装编号','Package','Lot','package_lot'],shipmentBatch:['发运批次','运输批次','shipment_batch'],quantity:['数量','装箱数量','quantity'],unit:['单位','unit'],packingType:['包装方式','packing_type'],lengthCm:['长度cm','length_cm'],widthCm:['宽度cm','width_cm'],heightCm:['高度cm','height_cm'],volumeM3:['体积m3','volume_m3'],netWeightKg:['净重Kg','net_weight_kg'],grossWeightKg:['毛重Kg','gross_weight_kg'],weight:['重量','weight'],weightUnit:['重量单位','weight_unit'],shippingDate:['发货日期','shipping_date'],pol:['POL','装货港'],pod:['POD','卸货港'],eta:['ETA','预计到港日期'],arrivalDate:['到港日期','arrival_date'],customsStatus:['清关状态','customs_status'],siteArrivalDate:['现场到货日期','site_arrival_date'],status:['当前状态','status'],installationArea:['Installation Area / Intended Workshop','安装区域','拟安装车间','installation_area'],remark:['备注','remark']};
  const numericFields=new Set(['quantity','lengthCm','widthCm','heightCm','volumeM3','netWeightKg','grossWeightKg','weight']),dateFields=new Set(['shippingDate','eta','arrivalDate','siteArrivalDate']);
  return rows.map((row,index)=>{const out={sourceFile:source,sourceRow:index+2,sourceType:'shipment'};for(const [field,names] of Object.entries(aliases)){const raw=valueOf(row,names);out[field]=numericFields.has(field)?number(raw):dateFields.has(field)?parseReportDate(raw):text(raw);}out.weight=out.grossWeightKg??out.weight;out.weightUnit=out.weightUnit||(out.weight!=null?'kg':'');out.projectId=projectId;out.id=stableId('shipment',shipmentIdentityParts(out),projectId);out.reviewFields=[];if(!out.category)out.reviewFields.push('category');if(!out.equipmentName)out.reviewFields.push('equipmentName');if(!out.packageLot&&!out.shipmentBatch)out.reviewFields.push('packageLot/shipmentBatch');return {...out,needsReview:out.reviewFields.length>0};}).filter(r=>r.category||r.equipmentName||r.packageLot);
}

export const shipmentIdentityParts=row=>[row.shipmentBatch,row.packageLot,row.packageSequence,row.supplier,row.equipmentName];

export function summarizeShipments(rows){
  const numeric=(row,field,fallback)=>Number.isFinite(row[field])?row[field]:Number.isFinite(row[fallback])?row[fallback]:null,packages=new Map(),batchTotals=new Map(),categories=new Map();
  for(const row of rows){const key=JSON.stringify([row.shipmentBatch||'',row.packageLot||'',row.packageSequence||row.sourceRow||'']),gross=numeric(row,'grossWeightKg','weight'),volume=numeric(row,'volumeM3'),anomalies=[...(row.anomalies||[])];if(row.packageLot){const duplicateKey=JSON.stringify([row.shipmentBatch||'',row.packageLot]);packages.set(duplicateKey,(packages.get(duplicateKey)||0)+1);}if(!row.packageLot)anomalies.push('件号缺失');if(!row.equipmentName)anomalies.push('设备名称缺失');if(!Number.isFinite(row.quantity)||row.quantity<=0)anomalies.push('数量缺失或无效');if(gross==null)anomalies.push('毛重缺失');if(volume==null)anomalies.push('体积缺失');if(Number.isFinite(row.netWeightKg)&&gross!=null&&gross<row.netWeightKg)anomalies.push('毛重小于净重');row._shipmentKey=key;row._computedAnomalies=[...new Set(anomalies)];const batch=row.shipmentBatch||'未标批次',totals=batchTotals.get(batch)||{batch,packages:0,quantity:0,grossWeightKg:0,volumeM3:0,anomalies:0};totals.packages++;totals.quantity+=Number.isFinite(row.quantity)?row.quantity:0;totals.grossWeightKg+=gross||0;totals.volumeM3+=volume||0;totals.anomalies+=row._computedAnomalies.length?1:0;batchTotals.set(batch,totals);categories.set(row.category||'未分类',(categories.get(row.category||'未分类')||0)+1);}
  for(const row of rows)if(row.packageLot&&packages.get(JSON.stringify([row.shipmentBatch||'',row.packageLot]))>1)row._computedAnomalies=[...new Set([...row._computedAnomalies,'件号重复'])];
  return {packages:rows.length,quantity:rows.reduce((sum,row)=>sum+(Number.isFinite(row.quantity)?row.quantity:0),0),grossWeightKg:rows.reduce((sum,row)=>sum+(numeric(row,'grossWeightKg','weight')||0),0),volumeM3:rows.reduce((sum,row)=>sum+(numeric(row,'volumeM3')||0),0),anomalies:rows.filter(row=>row._computedAnomalies.length),batches:[...batchTotals.values()].sort((a,b)=>a.batch.localeCompare(b.batch)),categories:[...categories].sort((a,b)=>b[1]-a[1])};
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
  const aggregate=(items,field,cutoff)=>{const byKey=new Map(items.map(r=>[key(r),r]));let sum=0,coveredWeight=0;for(const [k,w] of weights){const r=byKey.get(k),validPercent=Number.isFinite(r?.[field])&&r[field]>=0&&r[field]<=100;if(r?.month===cutoff&&validPercent){sum+=r[field]*w;coveredWeight+=w;}}
    return {value:!issues.length&&totalWeight>0&&coveredWeight===totalWeight?sum/totalWeight:null,coveredWeight,totalWeight};};
  const monthlyField=(row,kind)=>{
    const quantity=row?.[`${kind}MonthlyQuantity`],baseline=row?.baselineTotal??row?.total;
    if(Number.isFinite(quantity)&&Number.isFinite(baseline)&&baseline>0)return quantity/baseline*100;
    const percent=row?.[`${kind}MonthlyPct`];return Number.isFinite(percent)&&percent>=0&&percent<=100?percent:null;
  };
  const aggregateMonthly=(items,kind,cutoff)=>{const byKey=new Map(items.map(r=>[key(r),r]));let sum=0,coveredWeight=0;for(const [k,w] of weights){const r=byKey.get(k),value=monthlyField(r,kind);if(r?.month===cutoff&&value!=null){sum+=value*w;coveredWeight+=w;}}return {value:!issues.length&&totalWeight>0&&coveredWeight===totalWeight?sum/totalWeight:null,coveredWeight,totalWeight};};
  const currentEnd=monthEnd(asOf),d=new Date(`${currentEnd}T00:00:00Z`),cutoff=asOf>=currentEnd?currentEnd:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0)).toISOString().slice(0,10);
  const latest=latestBy(valid.filter(r=>r.month<=cutoff),key,'month');
  const months=[...new Set(valid.map(r=>r.month))].sort();let plannedRunning=0,actualRunning=0,plannedContinuous=true,actualContinuous=true;
  const timeline=months.map(month=>{const monthItems=valid.filter(r=>r.month===month),plannedMonthly=aggregateMonthly(monthItems,'planned',month).value,actualMonthly=month<=cutoff?aggregateMonthly(monthItems,'actual',month).value:null,items=latestBy(valid.filter(r=>r.month<=month),key,'month');
    plannedContinuous=plannedContinuous&&plannedMonthly!=null;actualContinuous=actualContinuous&&actualMonthly!=null;if(plannedMonthly!=null)plannedRunning+=plannedMonthly;if(actualMonthly!=null)actualRunning+=actualMonthly;
    return {month,planned:plannedContinuous?plannedRunning:aggregate(items,'plannedCumulativePct',month).value,actual:month<=cutoff?(actualContinuous?actualRunning:aggregate(items,'actualCumulativePct',month).value):null,plannedMonthly,actualMonthly};});
  const point=timeline.find(item=>item.month===cutoff),sourcePlanned=aggregate(latest,'plannedCumulativePct',cutoff),sourceActual=aggregate(latest,'actualCumulativePct',cutoff),sourcePlannedMonthly=aggregateMonthly(valid.filter(row=>row.month===cutoff),'planned',cutoff),sourceActualMonthly=aggregateMonthly(valid.filter(row=>row.month===cutoff),'actual',cutoff),plannedMonthly={...sourcePlannedMonthly,value:point?.plannedMonthly??null},actualMonthly={...sourceActualMonthly,value:point?.actualMonthly??null};
  const planned={...sourcePlanned,value:point?.planned??null},actual={...sourceActual,value:point?.actual??null};
  if(timeline.some(item=>(item.planned??0)>100.000001||(item.actual??0)>100.000001))issues.push('cumulative-over-100');
  const normalizedLatest=latest.map(row=>{const itemTimeline=valid.filter(item=>key(item)===key(row)&&item.month<=row.month),cumulative=kind=>{const values=itemTimeline.map(item=>monthlyField(item,kind));return values.length&&values.every(value=>value!=null)?values.reduce((sum,value)=>sum+value,0):row[`${kind}CumulativePct`];};return {...row,normalizedPlannedCumulativePct:cumulative('planned'),normalizedActualCumulativePct:cumulative('actual'),stale:row.month!==cutoff};});
  return {planned:planned.value,actual:actual.value,variance:planned.value!=null&&actual.value!=null?actual.value-planned.value:null,plannedMonthly:plannedMonthly.value,actualMonthly:actualMonthly.value,timeline,latest:normalizedLatest,cutoff,totalWeight,coverage:{planned,actual,plannedMonthly,actualMonthly},issues,selected};
}

export function summarizeProgress(rows,options={}){
  const analysis=analyzeProgress(rows,options),current=analysis.latest.filter(row=>!row.stale),disciplines=[];
  const names=[...new Set(current.map(row=>row.discipline||'未分类'))];
  const metric=(row,kind)=>row[`normalized${kind[0].toUpperCase()+kind.slice(1)}CumulativePct`]??row[`${kind}CumulativePct`];
  for(const name of names){const items=current.filter(row=>(row.discipline||'未分类')===name),weight=items.reduce((sum,row)=>sum+(Number.isFinite(row.weight)?row.weight:0),0),weighted=kind=>weight?items.reduce((sum,row)=>sum+(Number.isFinite(metric(row,kind))?metric(row,kind)*row.weight:0),0)/weight:null;disciplines.push({name,weight,plannedCompletion:weighted('planned'),actualCompletion:weighted('actual'),contributionToProject:analysis.totalWeight?items.reduce((sum,row)=>sum+(Number.isFinite(metric(row,'actual'))?metric(row,'actual')*row.weight:0),0)/analysis.totalWeight:null});}
  const lagging=current.filter(row=>Number.isFinite(metric(row,'planned'))&&Number.isFinite(metric(row,'actual'))).map(row=>({...row,plannedCumulativePct:metric(row,'planned'),actualCumulativePct:metric(row,'actual'),variance:metric(row,'actual')-metric(row,'planned'),contributionToProject:analysis.totalWeight?metric(row,'actual')*row.weight/analysis.totalWeight:null})).sort((a,b)=>a.variance-b.variance).slice(0,8);
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
