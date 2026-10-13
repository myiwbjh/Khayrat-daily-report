import {analyzeProgress,crossAnalyze,currentProgressRows,stableId} from './project-data.js';

const text=value=>String(value??'').trim();
const dateOf=row=>row.periodEnd||row.date||row.month||row.siteArrivalDate||row.arrivalDate||row.eta||'';
const sourceOf=row=>({date:dateOf(row),file:row.sourceFile||row.source||'系统数据',page:row.pageNumber||null,row:row.sourceRow||null,excerpt:row.sourceExcerpt||row.risk||row.rawRecord||row.remark||''});
const severityRank={low:1,medium:2,high:3};
const resolvedRE=/已解决|已解除|已关闭|已完成|已到场|已清关|恢复施工|不再制约/i;
const riskRE=/风险|制约|滞后|延误|停工|暂停|未到|待清关|清关|缺少|不足|未提供|等待|受阻|影响|问题/i;
const categoryOf=value=>{
  const valueText=text(value);
  if(/图纸|设计|drawing|design/i.test(valueText))return'设计图纸';
  if(/清关|海关|报关|custom/i.test(valueText))return'设备清关';
  if(/设备|到货|物流|发运|运输|船期|ETA/i.test(valueText))return'设备到货';
  if(/人员|人力|劳务|工人|staff|labor/i.test(valueText))return'人员资源';
  if(/材料|机具|资源|机械/i.test(valueText))return'施工资源';
  if(/停工|暂停|停滞|未施工/i.test(valueText))return'施工停滞';
  return'进度滞后';
};
const severityOf=value=>/停工|重大|严重|关键线路|清关滞留|逾期/i.test(value)?'high':/滞后|延误|不足|未提供|待清关|受阻/i.test(value)?'medium':'low';
const compact=value=>text(value).replace(/\s+/g,' ').slice(0,180);

export function analyzeProjectRisks({reports=[],progress=[],shipments=[],mappings=[],images=[],asOf=new Date().toISOString().slice(0,10),projectId='khayrat'}={}){
  const sameProject=row=>(row.projectId||row.project_id||'khayrat')===projectId;
  reports=reports.filter(row=>sameProject(row)&&dateOf(row)<=asOf);progress=progress.filter(sameProject);shipments=shipments.filter(sameProject);images=images.filter(row=>sameProject(row)&&!row.ignored&&!row.decorative&&dateOf(row)<=asOf);
  const risks=new Map();
  const add=risk=>{
    const key=risk.key||`${risk.category}:${risk.scope||'项目'}`,existing=risks.get(key),sources=[...(existing?.sources||[]),...(risk.sources||[])],evidence=[...(existing?.evidence||[]),...(risk.evidence||[])];
    const merged={...existing,...risk,key,severity:!existing||severityRank[risk.severity]>=severityRank[existing.severity]?risk.severity:existing.severity,sources:[...new Map(sources.map(item=>[JSON.stringify(item),item])).values()],evidence:[...new Set(evidence.filter(Boolean))]};
    merged.id=stableId('risk',[key,merged.firstSeen||merged.sourceDate||''],projectId);risks.set(key,merged);
  };

  const explicitGroups=new Map();
  for(const row of reports){const detail=compact(row.risk||((/risk$/.test(row.recordType||''))?row.rawRecord:'')||'');if(!detail||(!riskRE.test(detail)&&!/risk$/.test(row.recordType||'')))continue;const category=categoryOf(`${row.process} ${detail}`),scope=row.workshop||'项目',key=`fact:${category}:${scope}`,list=explicitGroups.get(key)||[];list.push({row,detail,category,scope});explicitGroups.set(key,list);}
  for(const [key,list] of explicitGroups){list.sort((a,b)=>dateOf(a.row).localeCompare(dateOf(b.row)));const latest=list.at(-1),resolved=resolvedRE.test(`${latest.row.status} ${latest.detail}`);add({key,category:latest.category,scope:latest.scope,severity:severityOf(latest.detail),title:`${latest.scope}：${latest.category}`,factType:'confirmed',status:resolved?'resolved':'active',sourceDate:dateOf(latest.row),firstSeen:dateOf(list[0].row),basis:'日报或周报明确记录',impact:resolved?'历史制约已在后续来源中标记解决':'可能影响相关施工计划和关键节点',action:resolved?'保留历史，继续观察是否复发':'明确责任人和完成日期，下一次日报复核闭环',evidence:[latest.detail],sources:list.map(item=>sourceOf(item.row))});}

  const official=analyzeProgress(progress,{asOf});
  if(Number.isFinite(official.variance)&&official.variance<=-3)add({key:'inference:project-progress',category:'进度滞后',scope:'项目',severity:official.variance<=-10?'high':official.variance<=-5?'medium':'low',title:'项目实际进度落后计划',factType:'inference',status:'active',sourceDate:official.cutoff,firstSeen:official.cutoff,basis:'正式工程量 Excel 的计划与实际累计进度差',impact:'若趋势延续，可能影响设备安装及合同节点',action:'复核关键线路与赶工资源，按最新工程量表更新纠偏计划',evidence:[`截至 ${official.cutoff}，实际较计划 ${official.variance.toFixed(1)} 个百分点`],sources:currentProgressRows(progress).slice(0,1).map(sourceOf)});
  const current=official.latest.filter(row=>!row.stale&&Number.isFinite(row.plannedCumulativePct)&&Number.isFinite(row.actualCumulativePct)).map(row=>({...row,gap:row.actualCumulativePct-row.plannedCumulativePct})).filter(row=>row.gap<=-5).sort((a,b)=>a.gap-b.gap).slice(0,8);
  for(const row of current)add({key:`inference:wbs:${row.wbs||row.item}`,category:'进度滞后',scope:row.wbs||row.item,title:`${row.wbs||''} ${row.item||''} 进度滞后`.trim(),severity:row.gap<=-15?'high':'medium',factType:'inference',status:'active',sourceDate:official.cutoff,firstSeen:official.cutoff,basis:'正式工程量 Excel 的 WBS 计划与实际累计值',impact:'该 WBS 可能拖累专业和项目总体进度',action:'核对剩余工程量、资源投入和前置条件',evidence:[`计划 ${row.plannedCumulativePct.toFixed(1)}%，实际 ${row.actualCumulativePct.toFixed(1)}%，差 ${row.gap.toFixed(1)} 个百分点`],sources:[sourceOf(row)]});

  const byActivity=new Map();for(const row of reports.filter(row=>/停工|暂停|停滞|未施工/i.test(`${row.status} ${row.constructionContent} ${row.rawRecord}`))){const scope=row.workshop||row.process||'未关联区域',key=`stoppage:${scope}`,list=byActivity.get(key)||[];list.push(row);byActivity.set(key,list);}
  for(const [key,list] of byActivity){list.sort((a,b)=>dateOf(a).localeCompare(dateOf(b)));const last=list.at(-1),later=reports.filter(row=>(row.workshop||row.process)===(last.workshop||last.process)&&dateOf(row)>dateOf(last)&&/施工中|已完成|恢复/i.test(`${row.status} ${row.constructionContent}`)).sort((a,b)=>dateOf(a).localeCompare(dateOf(b))).at(-1),resolved=Boolean(later);add({key,category:'施工停滞',scope:last.workshop||last.process||'未关联区域',title:`${last.workshop||last.process||'现场'}施工停滞`,severity:list.length>=2?'high':'medium',factType:'confirmed',status:resolved?'resolved':'active',sourceDate:dateOf(later||last),firstSeen:dateOf(list[0]),basis:'日报明确停工/暂停记录',impact:resolved?'已恢复施工，保留停滞历史':'连续停滞可能影响后续工序',action:resolved?'复核恢复后的完成量':'确认停滞原因、复工条件与责任人',evidence:[`${list.length} 个来源日期明确记录停工/暂停`,later?`后续 ${dateOf(later)} 已记录恢复施工`:'' ],sources:[...list.map(sourceOf),...(later?[sourceOf(later)]:[])]});}

  for(const shipment of shipments){const status=`${shipment.status||''} ${shipment.customsStatus||''}`,date=shipment.eta||shipment.arrivalDate||shipment.shippingDate||'',late=date&&date<asOf&&!/已清关|现场到货|已到场|delivered/i.test(status);if(!late&&!/待清关|清关滞留|延误|受阻/i.test(status))continue;const category=/清关/i.test(status)?'设备清关':'设备到货';add({key:`fact:shipment:${shipment.shipmentBatch||''}:${shipment.equipmentName||shipment.packageLot||''}`,category,scope:shipment.shipmentBatch||'未标批次',title:`${shipment.equipmentName||shipment.packageLot||'设备'}${category==='设备清关'?'清关':'到货'}风险`,severity:/滞留|延误|逾期/i.test(status)||late?'high':'medium',factType:'confirmed',status:'active',sourceDate:date||asOf,firstSeen:date||asOf,basis:'设备物流台账状态及日期',impact:'可能影响安装窗口和后续调试',action:'更新船期、到港、清关和现场到货责任节点',evidence:[status.trim()||`ETA ${date} 已早于 ${asOf}，尚无到场记录`],sources:[sourceOf(shipment)]});}

  const people=reports.filter(row=>row.staffScope==='项目总人数'&&Number.isFinite(row.totalStaff??(row.chineseStaff+row.localStaff))).sort((a,b)=>dateOf(a).localeCompare(dateOf(b))),headcount=row=>row.totalStaff??row.chineseStaff+row.localStaff;
  if(people.length>1){const previous=people.at(-2),latest=people.at(-1),drop=(headcount(previous)-headcount(latest))/Math.max(1,headcount(previous));if(drop>=.1)add({key:'inference:headcount-drop',category:'人员资源',scope:'项目',title:'项目人员投入下降',severity:drop>=.25?'high':'medium',factType:'inference',status:'active',sourceDate:dateOf(latest),firstSeen:dateOf(latest),basis:'相邻两期项目总人数对比',impact:'可能降低现场多工作面并行能力',action:'结合下周计划核对关键工种和属地劳务需求',evidence:[`${dateOf(previous)} ${headcount(previous)} 人 → ${dateOf(latest)} ${headcount(latest)} 人，下降 ${(drop*100).toFixed(1)}%`],sources:[sourceOf(previous),sourceOf(latest)]});}

  const latestPhotoDate=images.map(dateOf).sort().at(-1);for(const image of images.filter(item=>dateOf(item)===latestPhotoDate&&/停工|无明显施工|无人作业|闲置/i.test(`${item.scene} ${item.aiSummary} ${(item.visibleFacts||[]).join(' ')}`))){const scope=image.relatedWorkshop||'未关联区域';add({key:`stoppage:${scope}`,category:'施工停滞',scope,title:`${scope}可能停滞`,severity:'medium',factType:'inference',status:'active',sourceDate:dateOf(image),firstSeen:dateOf(image),basis:'最新现场照片可见事实与场景分类',impact:'可能存在资源不足或作业面等待',action:'结合当日日报和连续照片人工确认',evidence:[image.aiSummary||image.scene||'照片显示无明显施工'],sources:[sourceOf(image)]});}

  for(const finding of crossAnalyze({reports,progress,shipments,mappings,asOf,projectId}))add({key:`inference:cross:${finding.title}`,category:categoryOf(finding.title),scope:'项目',title:finding.title,severity:finding.severity||'medium',factType:'inference',status:'active',sourceDate:asOf,firstSeen:asOf,basis:finding.basis,impact:'多来源组合显示潜在项目制约',action:finding.confirmation,evidence:finding.facts,sources:[]});
  const items=[...risks.values()].sort((a,b)=>(a.status==='resolved')-(b.status==='resolved')||severityRank[b.severity]-severityRank[a.severity]||String(b.sourceDate).localeCompare(String(a.sourceDate)));
  return {items,counts:{total:items.length,active:items.filter(item=>item.status==='active').length,resolved:items.filter(item=>item.status==='resolved').length,high:items.filter(item=>item.status==='active'&&item.severity==='high').length,medium:items.filter(item=>item.status==='active'&&item.severity==='medium').length,low:items.filter(item=>item.status==='active'&&item.severity==='low').length},asOf};
}
