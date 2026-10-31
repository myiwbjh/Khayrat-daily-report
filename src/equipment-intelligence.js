import {standardWorkshop} from './workshop-status.js';

const text=value=>String(value??'').trim();
const compact=value=>text(value).normalize('NFKC').replace(/[\s　]+/g,'').toLowerCase();
const dateOf=row=>row.periodEnd||row.date||row.month||row.siteArrivalDate||row.arrivalDate||row.eta||'';
const sourceOf=row=>({date:dateOf(row),file:row.sourceFile||row.source||'系统数据',page:row.pageNumber||null,row:row.sourceRow||null,excerpt:row.sourceExcerpt||row.rawRecord||row.remark||''});
const shipmentText=row=>[row.category,row.equipmentName,row.componentName,row.packedItem,row.specification,row.remark,...(row.itemDetails||[]).flatMap(item=>[item.itemName,item.specification])].map(compact).join(' ');

const explicitRules=[
  {test:/水泥磨(?!电气)|cementmill/,workshop:'水泥磨',use:'水泥粉磨系统',wbs:'2.1'},
  {test:/n2500.*选粉机|选粉机.*n2500/,workshop:'水泥磨',use:'选粉系统',wbs:'2.1'},
  {test:/包装机|卸包机|清包机|散装机|高台装车机|装车机附件|气动转弯溜子/,workshop:'水泥包装及散装车间',use:'包装、散装及装车系统',wbs:'2.1'},
  {test:/klt空压机|储气罐/,workshop:'空压机',use:'压缩空气系统',wbs:'2.1'},
  {test:/水泥库胶带斗提|水泥库.*斗提|库底卸料装置/,workshop:'水泥库',use:'水泥储存及库底输送系统',wbs:'2.1'}
];

function mappedValue(row,mappings,targetType){
  const candidates=[['equipment_item',row.equipmentName],['equipment_item',row.componentName],['equipment_category',row.category],['installation_area',row.installationArea]];
  for(const [sourceType,value] of candidates){if(!value)continue;const found=mappings.find(item=>compact(item.sourceType)===compact(sourceType)&&compact(item.sourceValue)===compact(value)&&compact(item.targetType)===compact(targetType));if(found?.targetValue)return {value:text(found.targetValue),source:found};}
  return null;
}

export function equipmentAssociation(row,mappings=[]){
  const mappedWorkshop=mappedValue(row,mappings,'workshop'),mappedUse=mappedValue(row,mappings,'use'),mappedWbs=mappedValue(row,mappings,'wbs');
  if(mappedWorkshop)return {status:'confirmed',workshop:standardWorkshop(mappedWorkshop.value,mappings),use:mappedUse?.value||'',wbs:mappedWbs?.value||'',confidence:'mapped',basis:`已确认映射：${mappedWorkshop.source.sourceValue} → ${mappedWorkshop.value}`};
  const area=standardWorkshop(row.installationArea,mappings);if(area)return {status:'confirmed',workshop:area,use:mappedUse?.value||'',wbs:mappedWbs?.value||'',confidence:'source',basis:'箱单明确提供安装区域'};
  const value=shipmentText(row),rule=explicitRules.find(item=>item.test.test(value));
  if(rule)return {...rule,workshop:standardWorkshop(rule.workshop,mappings),status:'confirmed',confidence:'explicit-name',basis:'设备名称明确指向工艺系统；未使用泛化类别猜测'};
  return {status:'pending',workshop:'',use:'',wbs:'',confidence:'none',basis:'名称/规格/设计映射不足，待确认'};
}

export function shipmentLifecycle(row,asOf=new Date().toISOString().slice(0,10)){
  const value=compact(`${row.status||''} ${row.customsStatus||''}`),site=row.siteArrivalDate||'',eta=row.eta||row.arrivalDate||'';
  if(site||/现场到货|已到场|delivered|^site$/.test(value))return {state:'arrived',label:'已到场',date:site||row.arrivalDate||''};
  if(row.arrivalDate)return {state:'approaching',label:'实际到港，现场到货待确认',date:row.arrivalDate};
  if(row.expectedSiteDate)return {state:'approaching',label:`预计 ${row.expectedSiteDate} 到场`,date:row.expectedSiteDate};
  if(/已发运|运输中|在途|到港|清关|shipped|transit|shipping|port|customs/.test(value))return {state:'approaching',label:text(row.status||row.customsStatus)||'运输中',date:eta||row.shippingDate||''};
  if(eta){const days=Math.ceil((new Date(`${eta}T00:00:00Z`)-new Date(`${asOf}T00:00:00Z`))/86400000);if(days<=30)return {state:'approaching',label:`预计 ${eta} 到港`,date:eta};return {state:'planned',label:`ETA ${eta}`,date:eta};}
  return {state:'unknown',label:'运输节点未提供',date:''};
}

export function civilReadiness(association,reports=[],asOf=new Date().toISOString().slice(0,10),mappings=[]){
  if(association.status!=='confirmed'||!association.workshop)return {state:'unknown',label:'待确认车间',date:'',evidence:'无法关联施工证据',source:null};
  const workshop=standardWorkshop(association.workshop,mappings),matches=reports.filter(row=>dateOf(row)&&dateOf(row)<=asOf&&standardWorkshop(row.workshop,mappings)===workshop).sort((a,b)=>dateOf(a).localeCompare(dateOf(b))),latest=matches.at(-1);
  if(!latest)return {state:'unknown',label:'无施工证据',date:'',evidence:'未找到同车间日报/周报',source:null};
  const value=text(`${latest.status||''} ${latest.constructionContent||''} ${latest.rawRecord||''}`),ready=/基础.*(?:完成|验收)|预埋件.*(?:完成|验收)|安装面.*(?:移交|完成)|具备.*安装条件/.test(value),active=/基础|土方|钢筋|模板|混凝土|承台|结构|梁|柱|楼板|脚手架|施工中|进行中/.test(value);
  return {state:ready?'unknown':active?'not-ready':'unknown',label:ready?'基础完成描述 · 安装条件待确认':active?'土建尚在施工':'准备状态不明确',date:dateOf(latest),evidence:value.slice(0,220)||'来源未提供施工内容',source:sourceOf(latest)};
}

export function shipmentIntelligence({shipments=[],reports=[],mappings=[],asOf=new Date().toISOString().slice(0,10)}={}){
  const items=shipments.map(row=>{const association=equipmentAssociation(row,mappings),lifecycle=shipmentLifecycle(row,asOf),civil=civilReadiness(association,reports,asOf,mappings);return {...row,association,lifecycle,civil,riskIds:[]};}),risks=[];
  const add=risk=>{risk.id=`logistics:${encodeURIComponent(risk.key)}`;risks.push(risk);for(const row of items.filter(risk.matches))row.riskIds.push(risk.id);};
  const batches=[...new Set(items.map(row=>row.shipmentBatch||'未标批次'))];
  for(const batch of batches){const rows=items.filter(row=>(row.shipmentBatch||'未标批次')===batch),unknown=rows.filter(row=>row.lifecycle.state==='unknown');if(!unknown.length)continue;add({key:`batch-lifecycle:${batch}`,title:`${batch} 物流节点不足，无法核对安装窗口`,scope:batch,severity:'medium',factType:'unconfirmed',basis:'箱单已识别，但未提供发运、ETA、到港、清关或现场到货节点',impact:'无法确认设备到货与土建、吊装机具、安装人员及施工计划是否匹配',action:'由采购/物流补录发运、ETA、到港、清关和现场到货计划后自动复算',evidence:[`${unknown.length} 条箱单记录缺少可核验物流节点`],sources:unknown.slice(0,4).map(sourceOf),matches:row=>(row.shipmentBatch||'未标批次')===batch&&row.lifecycle.state==='unknown'});}
  const workshops=[...new Set(items.filter(row=>row.association.status==='confirmed').map(row=>row.association.workshop))];
  for(const workshop of workshops){const rows=items.filter(row=>row.association.workshop===workshop),arrived=rows.filter(row=>row.lifecycle.state==='arrived'&&row.civil.state==='not-ready'),approaching=rows.filter(row=>row.lifecycle.state==='approaching'&&row.civil.state==='not-ready'),unknown=rows.filter(row=>row.lifecycle.state==='unknown'&&row.civil.state==='not-ready');let selected=arrived,factType='confirmed',severity='high',title=`${workshop} 设备已到场但土建条件未完成`;
    if(!selected.length){selected=approaching;factType='inference';severity='medium';title=`${workshop} 设备将到场但土建条件未完成`;}
    if(!selected.length){selected=unknown;factType='unconfirmed';severity='low';title=`${workshop} 土建尚在施工，设备到货窗口待确认`;}
    if(!selected.length)continue;const civil=selected.find(row=>row.civil.source)?.civil;add({key:`civil:${workshop}:${factType}`,title,scope:workshop,severity,factType,basis:factType==='unconfirmed'?'设备已在箱单中，施工证据显示土建尚在进行，但物流节点缺失':'设备物流节点与同车间最新日报/周报施工状态交叉判断',impact:factType==='confirmed'?'可能造成堆存、二次倒运或安装等待':'到货与安装窗口可能错配，当前不能作为已发生事实',action:'物流确认到货节点；土建确认基础、预埋和作业面移交；安装单位确认吊装机具、人员及计划',evidence:[`${selected.length} 条关联设备`,civil?`${civil.date}：${civil.evidence}`:'未找到施工证据'],sources:[...selected.slice(0,3).map(sourceOf),...(civil?.source?[civil.source]:[])],matches:row=>selected.includes(row)});}
  const pending=items.filter(row=>row.association.status==='pending');
  if(items.length&&!mappings.some(row=>/required_quantity|需求数量|bom/i.test(`${row.sourceType} ${row.targetType} ${row.note}`)))add({key:'quantity-baseline',title:'设备材料数量缺少施工需求基准',scope:'项目',severity:'low',factType:'unconfirmed',basis:'箱单数量已汇总，但当前 WBS/映射未提供可比 BOM 或安装需求数量',impact:'不能判定箱单数量与施工需求是否存在差异',action:'补充经确认的设计/BOM需求数量及版本，系统仅重算受影响设备',evidence:[`${items.length} 条箱单记录；未发现可核验需求数量基准`],sources:[],matches:()=>false});
  return {items,risks,counts:{total:items.length,associated:items.length-pending.length,pending:pending.length,risks:risks.length,confirmedConflicts:risks.filter(row=>row.factType==='confirmed').length,potentialConflicts:risks.filter(row=>row.factType==='inference').length,informationGaps:risks.filter(row=>row.factType==='unconfirmed').length}};
}
