import {crossAnalyze,currentProgressRows,stableId,summarizeProgressWithWeekly} from './project-data.js';
import {shipmentIntelligence} from './equipment-intelligence.js';
import {analyzeCriticalPath} from './critical-path.js';

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
const responsibilityOf=category=>({设计图纸:'设计',设备清关:'采购/物流',设备到货:'采购/物流',人员资源:'施工管理',施工资源:'施工管理',施工停滞:'施工',进度滞后:'计划/施工',关键路径:'计划管理',资金约束:'商务/财务'}[category]||'项目管理');

export function analyzeProjectRisks({reports=[],progress=[],shipments=[],mappings=[],images=[],milestones=[],asOf=new Date().toISOString().slice(0,10),projectId='khayrat'}={}){
  const sameProject=row=>(row.projectId||row.project_id||'khayrat')===projectId;
  reports=reports.filter(row=>sameProject(row)&&dateOf(row)<=asOf);progress=progress.filter(sameProject);shipments=shipments.filter(sameProject);images=images.filter(row=>sameProject(row)&&!row.ignored&&!row.decorative&&dateOf(row)<=asOf);
  const risks=new Map();
  const add=risk=>{
    const key=risk.key||`${risk.category}:${risk.scope||'项目'}`,existing=risks.get(key),sources=[...(existing?.sources||[]),...(risk.sources||[])],evidence=[...(existing?.evidence||[]),...(risk.evidence||[])];
    const merged={...existing,...risk,key,responsibility:risk.responsibility||existing?.responsibility||responsibilityOf(risk.category),severity:!existing||severityRank[risk.severity]>=severityRank[existing.severity]?risk.severity:existing.severity,sources:[...new Map(sources.map(item=>[JSON.stringify(item),item])).values()],evidence:[...new Set(evidence.filter(Boolean))]};
    merged.id=stableId('risk',[key,merged.firstSeen||merged.sourceDate||''],projectId);risks.set(key,merged);
  };

  const explicitGroups=new Map();
  for(const row of reports){const detail=compact(row.risk||((/risk$/.test(row.recordType||''))?row.rawRecord:'')||'');if(!detail||(!riskRE.test(detail)&&!/risk$/.test(row.recordType||'')))continue;const category=categoryOf(`${row.process} ${detail}`),scope=row.workshop||'项目',key=`fact:${category}:${scope}`,list=explicitGroups.get(key)||[];list.push({row,detail,category,scope});explicitGroups.set(key,list);}
  for(const [key,list] of explicitGroups){list.sort((a,b)=>dateOf(a.row).localeCompare(dateOf(b.row)));const latest=list.at(-1),resolved=resolvedRE.test(`${latest.row.status} ${latest.detail}`);add({key,category:latest.category,scope:latest.scope,severity:severityOf(latest.detail),title:`${latest.scope}：${latest.category}`,factType:'confirmed',status:resolved?'resolved':'active',sourceDate:dateOf(latest.row),firstSeen:dateOf(list[0].row),basis:'日报或周报明确记录',impact:resolved?'历史制约已在后续来源中标记解决':'可能影响相关施工计划和关键节点',action:resolved?'保留历史，继续观察是否复发':'明确责任人和完成日期，下一次日报复核闭环',evidence:[latest.detail],sources:list.map(item=>sourceOf(item.row))});}

  const official=summarizeProgressWithWeekly({reports,progress,asOf,projectId});
  if(Number.isFinite(official.variance)&&official.variance<=-3)add({key:'inference:project-progress',category:'进度滞后',scope:'项目',severity:official.variance<=-10?'high':official.variance<=-5?'medium':'low',title:'项目实际进度落后计划',factType:'inference',status:'active',sourceDate:official.actualAsOf,firstSeen:official.actualAsOf,basis:'最新有效 WBS 计划与最新周报映射实际累计进度差',impact:'若趋势延续，可能影响设备安装及合同节点',action:'复核关键线路与赶工资源，按周报实绩更新纠偏计划',evidence:[`截至 ${official.actualAsOf}，实际较计划 ${official.variance.toFixed(1)} 个百分点`],sources:currentProgressRows(progress).slice(0,1).map(sourceOf)});
  const current=official.latest.filter(row=>!row.stale&&(row.actualSourceDate||row.month)===official.plannedAsOf&&Number.isFinite(row.plannedCumulativePct)&&Number.isFinite(row.actualCumulativePct)).map(row=>({...row,gap:row.actualCumulativePct-row.plannedCumulativePct})).filter(row=>row.gap<=-5).sort((a,b)=>a.gap-b.gap).slice(0,8);
  for(const row of current)add({key:`inference:wbs:${row.wbs||row.item}`,category:'进度滞后',scope:row.wbs||row.item,title:`${row.wbs||''} ${row.item||''} 进度滞后`.trim(),severity:row.gap<=-15?'high':'medium',factType:'inference',status:'active',sourceDate:official.cutoff,firstSeen:official.cutoff,basis:'正式工程量 Excel 的 WBS 计划与实际累计值',impact:'该 WBS 可能拖累专业和项目总体进度',action:'核对剩余工程量、资源投入和前置条件',evidence:[`计划 ${row.plannedCumulativePct.toFixed(1)}%，实际 ${row.actualCumulativePct.toFixed(1)}%，差 ${row.gap.toFixed(1)} 个百分点`],sources:[sourceOf(row)]});

  const byActivity=new Map();for(const row of reports.filter(row=>/停工|暂停|停滞|未施工/i.test(`${row.status} ${row.constructionContent} ${row.rawRecord}`))){const scope=row.workshop||row.process||'未关联区域',key=`stoppage:${scope}`,list=byActivity.get(key)||[];list.push(row);byActivity.set(key,list);}
  for(const [key,list] of byActivity){list.sort((a,b)=>dateOf(a).localeCompare(dateOf(b)));const last=list.at(-1),later=reports.filter(row=>(row.workshop||row.process)===(last.workshop||last.process)&&dateOf(row)>dateOf(last)&&/施工中|已完成|恢复/i.test(`${row.status} ${row.constructionContent}`)).sort((a,b)=>dateOf(a).localeCompare(dateOf(b))).at(-1),resolved=Boolean(later);add({key,category:'施工停滞',scope:last.workshop||last.process||'未关联区域',title:`${last.workshop||last.process||'现场'}施工停滞`,severity:list.some(x=>x.siteVerifiedStop===true)?'high':'medium',factType:'confirmed',status:resolved?'resolved':'active',sourceDate:dateOf(later||last),firstSeen:dateOf(list[0]),basis:'日报明确停工/暂停记录',impact:resolved?'后续报告出现恢复施工证据，但无法据缺报区间确定复工日期':'停工报告需确认实际持续日期，缺报期间不得计算连续天数',action:resolved?'复核恢复后的完成量':'确认停滞原因、复工条件与责任人',evidence:[`${new Set(list.map(item=>dateOf(item))).size} 个来源日期记录停工/暂停（不代表连续日历天）`,later?`后续 ${dateOf(later)} 已记录恢复施工`:'' ],sources:[...list.map(sourceOf),...(later?[sourceOf(later)]:[])]});}

  for(const shipment of shipments){const status=`${shipment.status||''} ${shipment.customsStatus||''}`,date=shipment.eta||shipment.arrivalDate||shipment.shippingDate||'',late=date&&date<asOf&&!/已清关|现场到货|已到场|delivered/i.test(status);if(!late&&!/待清关|清关滞留|延误|受阻/i.test(status))continue;const category=/清关/i.test(status)?'设备清关':'设备到货';add({key:`fact:shipment:${shipment.shipmentBatch||''}:${shipment.equipmentName||shipment.packageLot||''}`,category,scope:shipment.shipmentBatch||'未标批次',title:`${shipment.equipmentName||shipment.packageLot||'设备'}${category==='设备清关'?'清关':'到货'}风险`,severity:/滞留|延误|逾期/i.test(status)||late?'high':'medium',factType:'confirmed',status:'active',sourceDate:date||asOf,firstSeen:date||asOf,basis:'设备物流台账状态及日期',impact:'可能影响安装窗口和后续调试',action:'更新船期、到港、清关和现场到货责任节点',evidence:[status.trim()||`ETA ${date} 已早于 ${asOf}，尚无到场记录`],sources:[sourceOf(shipment)]});}

  const siloShipments=shipments.filter(row=>/钢板仓|steel\s*silo|silo/i.test(`${row.category} ${row.equipmentName} ${row.componentName}`)&&/已发运|运输|到港|清关|shipped|transit/i.test(`${row.status} ${row.customsStatus}`));
  if(siloShipments.length&&!reports.some(row=>/钢板仓|silo/i.test(`${row.workshop} ${row.process} ${row.constructionContent}`)&&/基础.*(?:完成|验收)|具备.*安装|移交.*安装/i.test(`${row.status} ${row.constructionContent} ${row.rawRecord}`)))add({key:'unconfirmed:silo-installation-readiness',category:'设备到货',scope:'钢板仓',severity:'high',title:'钢板仓发运与基础/安装条件衔接待确认',factType:'unconfirmed',status:'active',sourceDate:siloShipments.map(dateOf).sort().at(-1)||asOf,firstSeen:siloShipments.map(dateOf).sort()[0]||asOf,basis:'物流台账已有钢板仓发运状态，但当前日报/周报未找到基础验收或安装面移交证据',impact:'到货后可能发生等待、二次倒运或安装窗口错配',action:'采购物流确认到货节点；土建提交基础验收、预埋和作业面移交日期；安装单位确认吊装方案',evidence:[`${siloShipments.length} 条钢板仓物流记录已进入发运/运输/到港环节`],sources:siloShipments.slice(0,4).map(sourceOf)});

  const arrived=shipments.filter(row=>row.siteArrivalDate||/现场到货|已到场|delivered/i.test(`${row.status}`)),recentStaff=reports.filter(row=>row.staffScope==='项目总人数').sort((a,b)=>dateOf(a).localeCompare(dateOf(b))).at(-1),liftingEvidence=reports.some(row=>/吊车|起重|叉车|安装机具|crane/i.test(`${row.equipmentName} ${row.equipmentStatus} ${row.rawRecord}`));
  if(arrived.length&&(!recentStaff||!liftingEvidence))add({key:'unconfirmed:arrival-install-resources',category:'施工资源',scope:'设备安装',severity:'medium',title:'到货设备与安装人员/机具匹配待确认',factType:'unconfirmed',status:'active',sourceDate:arrived.map(dateOf).sort().at(-1)||asOf,firstSeen:arrived.map(dateOf).sort()[0]||asOf,basis:'设备已有现场到货证据，但人员汇总或吊装/安装机具证据不完整',impact:'可能造成设备堆存、安装等待或吊装计划冲突',action:'按设备到货清单锁定安装班组、关键工种、吊装机具及进场日期',evidence:[`${arrived.length} 条设备记录显示已到场`,recentStaff?`最近人员数据 ${dateOf(recentStaff)} 共 ${recentStaff.totalStaff??'未提供'} 人`:'缺少项目总人数证据',liftingEvidence?'已有安装机具记录':'缺少吊装/安装机具记录'],sources:[...arrived.slice(0,3).map(sourceOf),...(recentStaff?[sourceOf(recentStaff)]:[])]});

  const progressRows=currentProgressRows(progress),critical=analyzeCriticalPath({progress,mappings,milestones});
  if(critical.status==='insufficient')add({key:'unconfirmed:critical-path-logic',category:'关键路径',scope:'项目',severity:'medium',
    title:'关键线路尚未核定：工序逻辑或工期依据不足',factType:'unconfirmed',status:'active',
    sourceDate:official.plannedAsOf||asOf,firstSeen:official.plannedAsOf||asOf,
    basis:'只有在全部末级 WBS 的日历天工期、FS 前后关系、起点及合同里程碑终点均明确且无环时，才能采用 CPM 计算总时差',
    impact:'不能依据目前 WBS 工程量完成率推断关键线路或延期传导',
    action:'在现有 Crosswalk 表确认每个 WBS 的工期、前置工序、起点及结束里程碑；未完成前仅提示待核定',
    evidence:critical.issues,sources:[]});
  if((reports.length||progressRows.length||shipments.length)&&!reports.some(row=>/资金|付款|支付|现金流|回款|financial|payment/i.test(`${row.risk} ${row.rawRecord} ${row.constructionContent}`)))add({key:'unconfirmed:funding-evidence',category:'资金约束',scope:'项目',severity:'low',title:'资金约束状态缺少可核验证据',factType:'unconfirmed',status:'active',sourceDate:asOf,firstSeen:asOf,basis:'当前周报、日报和结构化台账未提供付款计划、到期应付或现金流状态',impact:'不能判断采购付款或分包支付是否会影响关键节点',action:'由商务/财务按周提供关键合同付款节点、到期金额和资金保障状态',evidence:['未发现可用于判断资金约束的结构化记录'],sources:[]});

  const people=reports.filter(row=>row.staffScope==='项目总人数'&&Number.isFinite(row.totalStaff??(row.chineseStaff+row.localStaff))).sort((a,b)=>dateOf(a).localeCompare(dateOf(b))),headcount=row=>row.totalStaff??row.chineseStaff+row.localStaff;
  if(people.length>1){const previous=people.at(-2),latest=people.at(-1),drop=(headcount(previous)-headcount(latest))/Math.max(1,headcount(previous));if(drop>=.1)add({key:'inference:headcount-drop',category:'人员资源',scope:'项目',title:'项目人员投入下降',severity:drop>=.25?'high':'medium',factType:'inference',status:'active',sourceDate:dateOf(latest),firstSeen:dateOf(latest),basis:'相邻两期项目总人数对比',impact:'可能降低现场多工作面并行能力',action:'结合下周计划核对关键工种和属地劳务需求',evidence:[`${dateOf(previous)} ${headcount(previous)} 人 → ${dateOf(latest)} ${headcount(latest)} 人，下降 ${(drop*100).toFixed(1)}%`],sources:[sourceOf(previous),sourceOf(latest)]});}

  const latestPhotoDate=images.map(dateOf).sort().at(-1);for(const image of images.filter(item=>dateOf(item)===latestPhotoDate&&/停工|无明显施工|无人作业|闲置/i.test(`${item.scene} ${item.aiSummary} ${(item.visibleFacts||[]).join(' ')}`))){const scope=image.relatedWorkshop||'未关联区域';add({key:`stoppage:${scope}`,category:'施工停滞',scope,title:`${scope}可能停滞`,severity:'medium',factType:'inference',status:'active',sourceDate:dateOf(image),firstSeen:dateOf(image),basis:'最新现场照片可见事实与场景分类',impact:'可能存在资源不足或作业面等待',action:'结合当日日报和连续照片人工确认',evidence:[image.aiSummary||image.scene||'照片显示无明显施工'],sources:[sourceOf(image)]});}

  for(const finding of crossAnalyze({reports,progress,shipments,mappings,asOf,projectId}))add({key:`inference:cross:${finding.title}`,category:categoryOf(finding.title),scope:'项目',title:finding.title,severity:finding.severity||'medium',factType:'inference',status:'active',sourceDate:asOf,firstSeen:asOf,basis:finding.basis,impact:'多来源组合显示潜在项目制约',action:finding.confirmation,evidence:finding.facts,sources:[]});
  for(const risk of shipmentIntelligence({shipments,reports,progress,mappings,asOf}).risks)add({...risk,key:risk.key,category:'设备到货',status:'active',sourceDate:risk.sources.map(source=>source.date).filter(Boolean).sort().at(-1)||asOf,firstSeen:risk.sources.map(source=>source.date).filter(Boolean).sort()[0]||asOf,responsibility:'采购/物流'});
  const items=[...risks.values()].sort((a,b)=>(a.status==='resolved')-(b.status==='resolved')||severityRank[b.severity]-severityRank[a.severity]||String(b.sourceDate).localeCompare(String(a.sourceDate)));
  return {items,counts:{total:items.length,active:items.filter(item=>item.status==='active').length,resolved:items.filter(item=>item.status==='resolved').length,high:items.filter(item=>item.status==='active'&&item.severity==='high').length,medium:items.filter(item=>item.status==='active'&&item.severity==='medium').length,low:items.filter(item=>item.status==='active'&&item.severity==='low').length},asOf};
}
