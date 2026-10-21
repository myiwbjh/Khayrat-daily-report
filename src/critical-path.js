import {currentProgressRows} from './project-data.js';

// CPM is available only with an explicit, complete FS network in calendar days.
// Crosswalk input uses existing mapped-source fields; no inferred links/durations.
const text=value=>String(value??'').trim();
const integer=value=>/^\d+$/.test(text(value))?Number(value):NaN;
const unique=list=>[...new Set(list)];
export function analyzeCriticalPath({progress=[],mappings=[],milestones=[]}={}){
  const rows=currentProgressRows(progress).filter(row=>row.wbs&&row.isLeaf!==false);
  const nodes=new Map(rows.map(row=>[text(row.wbs),{wbs:text(row.wbs),name:text(row.item)||text(row.wbs)}]));
  const ids=[...nodes.keys()],issues=[];
  if(!ids.length)return {status:'unavailable',verified:false,issues:['缺少已激活的 WBS 末级工程量数据'],criticalWbs:[],activityCount:0};
  const relevant=mappings.filter(row=>['wbs_duration','wbs_predecessor','wbs_start','wbs_finish'].includes(text(row.sourceType)));
  const byType=type=>relevant.filter(row=>text(row.sourceType)===type);
  const duration=new Map(),edges=new Map(ids.map(id=>[id,[]])),predecessors=new Map(ids.map(id=>[id,[]]));
  for(const m of byType('wbs_duration')){
    const id=text(m.sourceValue),days=integer(m.targetValue);
    if(!nodes.has(id)||text(m.targetType)!=='duration_days'||!['calendar-days','日历天'].includes(text(m.relation))||!Number.isSafeInteger(days)||days<1||days>2000||duration.has(id)){issues.push('工期映射无效、重复或未明确日历天：'+id);continue;}
    duration.set(id,days);
  }
  const roots=new Set();
  for(const m of byType('wbs_start')){
    const id=text(m.sourceValue);
    if(!nodes.has(id)||text(m.targetType)!=='role'||text(m.targetValue)!=='start'||text(m.relation)!=='project-start'){issues.push('起点映射无效：'+id);continue;}
    roots.add(id);
  }
  for(const m of byType('wbs_predecessor')){
    // sourceValue is successor, targetValue is predecessor.
    const to=text(m.sourceValue),from=text(m.targetValue);
    if(!nodes.has(to)||!nodes.has(from)||to===from||text(m.targetType)!=='wbs'||text(m.relation).toUpperCase()!=='FS'||predecessors.get(to)?.includes(from)){
      issues.push('前置工序映射无效、重复或非 FS：'+from+' → '+to);continue;
    }
    edges.get(from).push(to);predecessors.get(to).push(from);
  }
  const finishMaps=byType('wbs_finish'),finish=finishMaps[0],finishId=text(finish?.sourceValue);
  const milestone=milestones.find(m=>text(m.name)===text(finish?.targetValue)&&m.datePrecision==='day'&&/^\d{4}-\d{2}-\d{2}$/.test(text(m.date)));
  if(finishMaps.length!==1||!nodes.has(finishId)||text(finish.targetType)!=='milestone'||text(finish.relation)!=='finish'||!milestone)issues.push('缺少唯一的终点 WBS 与已确认日精度里程碑映射');
  const missingDurations=ids.filter(id=>!duration.has(id));
  if(missingDurations.length)issues.push(missingDurations.length+' 个 WBS 缺少经确认的日历天工期（如 '+missingDurations.slice(0,3).join('、')+'）');
  const unlinked=ids.filter(id=>!roots.has(id)&&!predecessors.get(id).length);
  if(unlinked.length)issues.push(unlinked.length+' 个 WBS 缺少明确前置关系或起点标记（如 '+unlinked.slice(0,3).join('、')+'）');
  if([...roots].some(id=>predecessors.get(id).length))issues.push('起点 WBS 不能同时具有前置工序');
  const indegree=new Map(ids.map(id=>[id,predecessors.get(id).length]));
  const queue=ids.filter(id=>indegree.get(id)===0),order=[];
  for(let i=0;i<queue.length;i++){const id=queue[i];order.push(id);for(const next of edges.get(id)){indegree.set(next,indegree.get(next)-1);if(indegree.get(next)===0)queue.push(next);}}
  if(order.length!==ids.length)issues.push('工序网络存在循环依赖');
  if(finishId&&nodes.has(finishId)){
    const reachable=new Set([finishId]),stack=[finishId];
    while(stack.length){const id=stack.pop();for(const p of predecessors.get(id)){if(!reachable.has(p)){reachable.add(p);stack.push(p);}}}
    const isolated=ids.filter(id=>!reachable.has(id));if(isolated.length)issues.push(isolated.length+' 个 WBS 无法追溯到目标里程碑（如 '+isolated.slice(0,3).join('、')+'）');
  }
  if(issues.length)return {status:'insufficient',verified:false,issues:unique(issues),criticalWbs:[],activityCount:ids.length,relationshipCount:byType('wbs_predecessor').length,definedDurations:duration.size,finishMilestone:milestone?.name||''};
  // Forward/backward passes for a connected, acyclic, explicit calendar-day FS network.
  const es=new Map(),ef=new Map();
  for(const id of order){const start=Math.max(0,...predecessors.get(id).map(p=>ef.get(p)));es.set(id,start);ef.set(id,start+duration.get(id));}
  const totalDuration=ef.get(finishId),ls=new Map(),lf=new Map();
  for(const id of [...order].reverse()){const successors=edges.get(id),finishAt=successors.length?Math.min(...successors.map(next=>ls.get(next))):totalDuration;lf.set(id,finishAt);ls.set(id,finishAt-duration.get(id));}
  const activities=order.map(id=>({wbs:id,name:nodes.get(id).name,durationDays:duration.get(id),earlyStart:es.get(id),earlyFinish:ef.get(id),totalFloatDays:ls.get(id)-es.get(id),critical:ls.get(id)===es.get(id)}));
  return {status:'verified-network',verified:true,issues:[],criticalWbs:activities.filter(row=>row.critical).map(row=>row.wbs),activityCount:ids.length,relationshipCount:byType('wbs_predecessor').length,activities,totalDurationDays:totalDuration,finishMilestone:milestone.name,finishDate:milestone.date,calendar:'calendar-days'};
}
