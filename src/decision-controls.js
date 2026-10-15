import {stableId} from './project-data.js';

const dateValue=value=>value?Date.parse(`${value}T00:00:00Z`):NaN;
const text=value=>String(value||'').trim();
const list=value=>Array.isArray(value)?value.map(text).filter(Boolean):text(value).split(/[，,；;\n]/).map(text).filter(Boolean);

export function progressDecisionState(summary={}){
  const selected=summary.selected||[],qualityIssues=summary.qualityIssues||[],meta=selected.find(row=>row.workbookMeta)?.workbookMeta?.batch||{};
  const qualityStatus=text(meta.qualityStatus||selected[0]?.batchQualityStatus);
  if(!selected.length)return {status:'blocked',decisionReady:false,label:'无正式进度',reason:'尚无可用于决策的当前 WBS 进度数据'};
  if(qualityIssues.length)return {status:'provisional',decisionReady:false,label:'暂定 · 待复核',reason:`存在 ${qualityIssues.length} 条计划、实际或 WBS 基准差异`};
  if(qualityStatus&&!/^(verified|已验证|已复核|通过)$/i.test(qualityStatus))return {status:'provisional',decisionReady:false,label:'暂定 · 待复核',reason:`当前导入批次状态为 ${qualityStatus}`};
  return {status:'ready',decisionReady:true,label:'已验证',reason:'当前 WBS 基准及导入批次未发现待复核差异'};
}

export function equipmentControlId(batch,projectId='khayrat'){return stableId('equipment-batch',[text(batch)||'未标批次'],projectId);}

export function normalizeEquipmentControl(value={},projectId='khayrat'){
  const batchName=text(value.batchName||value.shipmentBatch)||'未标批次';
  return {...value,id:value.id||equipmentControlId(batchName,projectId),projectId,batchName,status:text(value.status)||'planned',linkedWbs:list(value.linkedWbs),linkedWorkshops:list(value.linkedWorkshops),history:Array.isArray(value.history)?value.history:[]};
}

export function equipmentBatchHealth(shipments=[],controls=[],mappings=[],asOf=new Date().toISOString().slice(0,10)){
  const controlByBatch=new Map(controls.map(value=>{const c=normalizeEquipmentControl(value,value.projectId);return [c.batchName,c];})),batches=new Map();
  for(const row of shipments){const batch=text(row.shipmentBatch)||'未标批次';if(!batches.has(batch))batches.set(batch,[]);batches.get(batch).push(row);}
  const mappedValues=new Set(mappings.flatMap(row=>[row.sourceValue,row.targetValue]).map(text).filter(Boolean));
  const items=[...batches].map(([batchName,rows])=>{
    const control=controlByBatch.get(batchName)||normalizeEquipmentControl({batchName},rows[0]?.projectId||'khayrat');
    const lifecycleFields=['eta','arrivalDate','customsStatus','siteArrivalDate','status','installationArea'],reported=lifecycleFields.filter(field=>text(control[field])||rows.some(row=>text(row[field]))).length;
    const anomalyCount=rows.filter(row=>Array.isArray(row._computedAnomalies)&&row._computedAnomalies.length).length;
    const linkedWbs=control.linkedWbs||[],linkedWorkshops=control.linkedWorkshops||[],mappingCoverage=linkedWbs.length+linkedWorkshops.length?100:rows.some(row=>mappedValues.has(text(row.category))||mappedValues.has(text(row.installationArea)))?50:0;
    const overdue=control.status!=='ready'&&Number.isFinite(dateValue(control.dueDate))&&dateValue(control.dueDate)<dateValue(asOf);
    const blockers=[...(reported<3?['物流里程碑不足']:[]),...(mappingCoverage===0?['未关联 WBS / 车间']:[]),...(anomalyCount?['箱单异常待复核']:[]),...(overdue?['协调事项逾期']:[])];
    return {batchName,rows,control,lifecycleCompleteness:Math.round(reported/lifecycleFields.length*100),mappingCoverage,anomalyCount,overdue,blockers,decisionReady:!blockers.length};
  }).sort((a,b)=>Number(b.overdue)-Number(a.overdue)||b.blockers.length-a.blockers.length||a.batchName.localeCompare(b.batchName,'zh-CN'));
  return {items,counts:{total:items.length,ready:items.filter(item=>item.decisionReady).length,blocked:items.filter(item=>item.blockers.length).length,overdue:items.filter(item=>item.overdue).length}};
}

export function normalizeRiskAction(value={},projectId='khayrat'){
  return {...value,id:text(value.id),projectId,status:['open','monitoring','closed'].includes(value.status)?value.status:'open',owner:text(value.owner),dueDate:text(value.dueDate),response:text(value.response),closureNote:text(value.closureNote),history:Array.isArray(value.history)?value.history:[]};
}

export function mergeRiskActions(items=[],actions=[],asOf=new Date().toISOString().slice(0,10)){
  const byId=new Map(actions.map(value=>{const a=normalizeRiskAction(value,value.projectId);return [a.id,a];}));
  const merged=items.map(item=>{const action=byId.get(item.id),actionStatus=action?.status||(item.status==='resolved'?'closed':'open'),status=action?actionStatus==='closed'?'resolved':'active':item.status||'active',overdue=status==='active'&&Number.isFinite(dateValue(action?.dueDate))&&dateValue(action.dueDate)<dateValue(asOf);return {...item,status,actionStatus,owner:action?.owner||'',dueDate:action?.dueDate||'',response:action?.response||'',closureNote:action?.closureNote||'',actionHistory:action?.history||[],overdue,unassigned:status==='active'&&!action?.owner};});
  return {items:merged,counts:{total:merged.length,active:merged.filter(item=>item.status==='active').length,resolved:merged.filter(item=>item.status==='resolved').length,high:merged.filter(item=>item.status==='active'&&item.severity==='high').length,medium:merged.filter(item=>item.status==='active'&&item.severity==='medium').length,overdue:merged.filter(item=>item.overdue).length,unassigned:merged.filter(item=>item.status==='active'&&item.unassigned).length}};
}
