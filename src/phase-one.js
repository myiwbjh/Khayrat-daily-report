import {stableId} from './project-data.js';

const clean=value=>String(value||'').trim();
export function applyBatchContext(row,control={}) {
  // A batch milestone is not evidence that every package has arrived.
  row={...row,...row.manualControl};
  return {...row,shippingDate:row.shippingDate||control.shippingDate,eta:row.eta||control.eta,
    installationArea:row.installationArea||control.installationArea||(control.linkedWorkshops?.length===1?control.linkedWorkshops[0]:''),
    batchMilestones:{arrivalDate:control.arrivalDate,siteArrivalDate:control.siteArrivalDate,customsStatus:control.customsStatus,status:control.status}};
}

export function installationReadiness(row={}) {
  const checks=row.installationChecks||{},fields=['equipmentComplete','drawingsAvailable','foundationHandover','crewAndTools'];
  const missing=fields.filter(key=>checks[key]?.confirmed!==true||!clean(checks[key]?.evidence));
  return {ready:!missing.length,missing,label:missing.length?'安装条件待确认':'具备安装条件'};
}

export function weeklyTasks(reports=[],actions=[],projectId='khayrat') {
  const tasks=new Map();
  for(const row of [...reports].sort((a,b)=>clean(a.periodEnd||a.date).localeCompare(clean(b.periodEnd||b.date)))) {
    for(const content of clean(row.nextWeekPlan).split(/[；;\n]+/).map(clean).filter(Boolean)) {
      const title=content.replace(/^\d+[、.．)）]\s*/,''),id=stableId('weekly-task',[row.workshop,title.replace(/\s+/g,'')],projectId);
      const source={date:row.periodEnd||row.date,file:row.sourceFile||row.source,page:row.pageNumber,excerpt:content};
      const previous=tasks.get(id);
      if(previous){previous.sources.push(source);continue;}
      tasks.set(id,{id,sourceKey:id,title,category:'周计划兑现',scope:row.workshop,sourceDate:source.date,
        severity:'medium',status:'active',factType:'unconfirmed',basis:'周报下周计划；负责人、承诺日期及完成状态待确认',
        impact:'未确认完成前持续跟踪，不计入工程量',action:'确认负责人和日期；完成时填写可追溯依据；受阻时填写原因及需解决日期',
        evidence:[],sources:[source]});
    }
  }
  for(const task of tasks.values()) {
    const saved=actions.find(a=>a.id===task.id);
    const closedDate=saved?.closedAt?.slice(0,10);
    if(closedDate&&task.sources.some(s=>s.date>closedDate))task.evidence.push('已完成事项在后续周报再次出现，请核对；不重复计量');
    const candidates=reports.filter(r=>r.workshop===task.scope&&(r.periodEnd||r.date)>task.sourceDate&&(r.constructionContent||r.rawRecord));
    task.sources.push(...candidates.slice(-5).map(r=>({date:r.periodEnd||r.date,file:r.sourceFile||r.source,page:r.pageNumber,excerpt:r.constructionContent||r.rawRecord||''})));
    task.evidence.push('后续同车间记录仅为候选证据，不能自动判定完成');
  }
  return [...tasks.values()];
}

export function actionUpdate(previous,values,snapshot,now=new Date().toISOString()) {
  if(values.taskState==='blocked'&&(!clean(values.blockReason)||!clean(values.needBy)))throw new Error('受阻任务需填写原因及需解决日期');
  if(values.status==='closed'&&!clean(values.closureNote))throw new Error('关闭事项必须填写可追溯的解决依据');
  const history=[...(previous.history||[])];
  if(!history.some(h=>h.snapshot)&&snapshot)history.push({at:now,snapshot:JSON.parse(JSON.stringify(snapshot))});
  if(!history.some(h=>h.originalDueDate)&&values.dueDate)history.push({at:now,originalDueDate:previous.dueDate||values.dueDate});
  history.push({at:now,...values,previousDueDate:previous.dueDate||'',previousStatus:previous.status||'open'});
  return {...previous,...values,history,closedAt:values.status==='closed'?(previous.closedAt||now):''};
}

export function shipmentImportDelta(existing,incoming){
  const rows=[...existing],added=[],changed=[];
  const packageKey=r=>r.shipmentBatch&&(r.packageLot||r.packageSequence&&r.supplier)?JSON.stringify([r.shipmentBatch,r.packageLot||'',r.packageSequence||'',r.packageLot?'':r.supplier]):'';
  for(const candidate of incoming){
    const previous=rows.find(r=>r.id===candidate.id)||rows.find(r=>packageKey(r)&&packageKey(r)===packageKey(candidate));
    if(!previous){rows.push(candidate);added.push(candidate);continue;}
    const differences=Object.keys(candidate).filter(key=>!['id','sourceFile','sourceRow','sourceSheet','sourceAssociations','needsReview','reviewFields'].includes(key)&&candidate[key]!==''&&candidate[key]!=null&&JSON.stringify(candidate[key])!==JSON.stringify(previous[key]));
    if(!differences.length)continue;
    const signature=JSON.stringify(candidate);
    if(previous.pendingImportChanges?.some(c=>JSON.stringify(c.candidate)===signature))continue;
    const updated={...previous,pendingImportChanges:[...(previous.pendingImportChanges||[]),{fields:differences,candidate}],needsReview:true};
    rows[rows.indexOf(previous)]=updated;changed.push(updated);
  }
  return {rows,added,changed,writes:[...new Map([...added,...changed].map(r=>[r.id,r])).values()]};
}

export function selectPackingRows(rows){
  const summaries=rows.filter(r=>/总箱单|总装箱|汇总|summary|master/i.test(r.__sourceSheet||''));
  if(!summaries.length)return rows;
  // Detail sheets remain source evidence; their quantities are not added again.
  return summaries.map((r,index)=>index? r:{...r,__detailSources:[...(r.__detailSources||[]),...rows.filter(r=>!summaries.includes(r))]});
}

export function reviewShipmentChange(row,index,decision,at=new Date().toISOString()){
 const change=row.pendingImportChanges?.[index];
 if(!change||change.decision||!['adopt','retain'].includes(decision))throw new Error('变化不存在或已核对');
 const fields=['equipmentName','componentName','specification','quantity','unit','packingType','lengthCm','widthCm','heightCm','volumeM3','netWeightKg','grossWeightKg','weight','weightUnit','remark'];
 if(decision==='adopt'&&!change.fields.some(k=>fields.includes(k)))throw new Error('没有可调整的数量或规格字段，请在箱件表单核对物流，或确认保留原值');
 const overrides=decision==='adopt'?Object.fromEntries(fields.filter(k=>change.fields.includes(k)).map(k=>[k,change.candidate[k]])):{};
 return {...row,manualControl:{...row.manualControl,...overrides},pendingImportChanges:row.pendingImportChanges.map((c,i)=>i===index?{...c,decision,reviewedAt:at,adoptedFields:Object.keys(overrides),retainedFields:c.fields.filter(k=>!Object.hasOwn(overrides,k))}:c),manualHistory:[...(row.manualHistory||[]),{at,decision,source:change.candidate.sourceFile,fields:change.fields,before:row.manualControl||{},after:overrides}]};
}
