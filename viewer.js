import {analyzeRecords,filterRecords} from './src/analytics.js';
import {latestWorkshopStates} from './src/workshop-status.js';
import {compareReports} from './src/comparison.js';
import {summarizeProgress,crossAnalyze} from './src/project-data.js';
import {renderWorkforceChart} from './src/workforce-chart.js';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const pct=v=>Number.isFinite(v)?`${v.toFixed(1)}%`:'待核';
const display=v=>v==null||v===''?'未报告':String(v);
const sections=new Map();
let data=null,beforeDate='',afterDate='';
const names={overview:'工程总览',reports:'日报明细',compare:'日报对比',images:'图片证据',workshops:'车间最新施工状态',progress:'WBS / S Curve',people:'人员统计',equipment:'设备跟踪',crosswalk:'Crosswalk',risks:'风险与制约',evidence:'停工证据'};
function section(id){const s=node('section',null,'view');s.id=`view-${id}`;sections.set(id,s);$('pages').append(s);return s;}
function panel(parent,title){const p=node('section',null,'panel');p.append(node('h2',title));parent.append(p);return p;}
function table(parent,headers,rows,{id,empty='暂无记录'}={}){const wrap=node('div',null,'table-scroll'),t=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');if(id)body.id=id;headers.forEach(h=>hr.append(node('th',h)));head.append(hr);for(const cells of rows){const tr=node('tr');cells.forEach(v=>{const td=node('td');td.append(v instanceof Node?v:node('span',display(v)));tr.append(td);});body.append(tr);}if(!rows.length){const tr=node('tr'),td=node('td',empty);td.colSpan=headers.length;tr.append(td);body.append(tr);}t.append(head,body);wrap.append(t);parent.append(wrap);}
function metric(parent,title,value,note){const m=node('article',null,'metric');m.append(node('span',title),node('strong',value));if(note)m.append(node('p',note,'muted'));parent.append(m);}
function chart(parent,points,keys,labels,{percent=true}={}){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 280');svg.classList.add('chart');svg.setAttribute('role','img');svg.setAttribute('aria-label',labels.join('与')+'趋势');
 const max=percent?100:Math.max(1,...points.flatMap(p=>keys.map(k=>Number.isFinite(p[k])?p[k]:0))),x=i=>48+i*820/Math.max(1,points.length-1),y=v=>238-v/max*208;
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(text)e.textContent=text;svg.append(e);return e;};
 for(let i=0;i<=4;i++){const v=max*i/4;add('line',{x1:48,x2:868,y1:y(v),y2:y(v),stroke:'#e0e7e4'});add('text',{x:0,y:y(v)+4},`${Math.round(v)}${percent?'%':''}`);}
 keys.forEach((k,ki)=>{let path='',open=false;points.forEach((p,i)=>{if(!Number.isFinite(p[k])){open=false;return;}path+=`${open?'L':'M'} ${x(i)} ${y(p[k])} `;open=true;const dot=add('circle',{cx:x(i),cy:y(p[k]),r:3,fill:ki?'#14896e':'#8293a0'});const title=document.createElementNS(ns,'title');title.textContent=`${p.month||p.date} · ${labels[ki]} ${percent?pct(p[k]):p[k]}`;dot.append(title);});add('path',{d:path,fill:'none',stroke:ki?'#14896e':'#8293a0','stroke-width':3});});
 points.forEach((p,i)=>{if(i===0||i===points.length-1||i===Math.floor(points.length/2))add('text',{x:x(i),y:265,'text-anchor':'middle'},p.month||p.date);});parent.append(svg);const legend=node('p',null,'chart-legend');labels.forEach(l=>legend.append(node('span',l)));parent.append(legend);
}
function workshops(parent,rows=data.workshops||[]){table(parent,['车间','最新日期','施工内容 / 工序','当前状态'],rows.map(w=>[w.workshop,w.date,[...(w.processes||[]),...(w.activities||[])].join('；'),(w.statuses||[]).join(' / ')]),{id:parent.id==='view-workshops'?'workshops':undefined});}
function reportsTable(parent,rows){table(parent,['日期','车间','工序','施工内容','状态','中方 / 属地','人员口径','当日 / 累计工程量','复核状态'],rows.map(r=>[r.date,r.workshop,r.process,r.constructionContent,r.status,`${display(r.chineseStaff)} / ${display(r.localStaff)}`,r.staffScope,`${display(r.dailyConcrete)} / ${display(r.cumulativeConcrete)} ${r.workUnit||''}`,r.needsReview?'待复核':'' ]));}
function show(){const id=location.hash.slice(1) in names?location.hash.slice(1):'overview';$('pageTitle').textContent=names[id];for(const [key,s] of sections)s.hidden=key!==id;document.querySelectorAll('nav a').forEach(a=>{if(a.hash===`#${id}`)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});}
function render(){
 $('pages').replaceChildren();sections.clear();const cutoff=$('dateFilter').value||data.asOf,asOf=$('progressAsOf').value||data.asOf;
 const reports=filterRecords(data.reports||[],{date:cutoff,workshop:$('workshopFilter').value,process:$('processFilter').value});
 const reportRows=(data.reports||[]).filter(r=>(!r.date||r.date<=cutoff)&&(!$('workshopFilter').value||r.workshop===$('workshopFilter').value)&&(!$('processFilter').value||r.process===$('processFilter').value));
 const analytics=analyzeRecords(reports),p=summarizeProgress(data.progressRecords||[],{asOf}),hasRows=Boolean(data.progressRecords?.length),progress=hasRows?p:data.progress||{};
 const workforce=(analytics.workforce?.length?analytics.workforce:data.workforce||[]).filter(r=>r.date<=cutoff),latest=workforce.at(-1),overview=section('overview'),metrics=node('div',null,'metrics');overview.append(metrics);
 const provisional=progress.decisionReady===false,prefix=provisional?'暂定 ':'';if(provisional)overview.prepend(node('p',`${progress.decisionReason||'进度数据尚未通过复核'}；以下进度不可作为正式决策依据。`,'notice danger'));
 metric(metrics,'WBS 计划累计',prefix+pct(progress.planned));metric(metrics,'WBS 实际累计',prefix+pct(progress.actual),Number.isFinite(progress.planned)&&Number.isFinite(progress.actual)?`偏差 ${(progress.actual-progress.planned).toFixed(1)} 个百分点`:'');metric(metrics,'项目总人数',latest?.total??'待核',latest?`中方 ${latest.chinese??'待核'} · 属地 ${latest.local??'待核'} · ${latest.date}`:'待数据录入');metric(metrics,'日报记录',String(reportRows.length),`已批准公开照片 ${data.photos?.length||0} 张`);
 chart(panel(overview,'S Curve · WBS 正式进度'),progress.timeline||[],['planned','actual'],['计划','实际']);
 workshops(panel(overview,'主要车间最新施工状态'),data.reports?latestWorkshopStates(reportRows):data.workshops||[]);table(panel(overview,'人员统计'),['日期','中方','属地','合计','复核状态'],workforce.map(r=>[r.date,r.chinese,r.local,r.total,r.needsReview?'待复核':'已按报告口径统计']));
 const reportView=section('reports');reportView.append(node('p',`${reportRows.length} 条记录 · 日报施工事实不作为 WBS 正式进度`,'muted'));reportsTable(reportView,reportRows);
 const compare=section('compare'),controls=node('div',null,'controls'),dates=[...new Set(reports.map(r=>r.date))].sort();
 for(const [id,title,value] of [['beforeDate','前期日期',beforeDate||dates.at(-2)],['afterDate','后期日期',afterDate||dates.at(-1)]]){const label=node('label',title),select=node('select');select.id=id;dates.forEach(d=>{const option=node('option',d);option.value=d;select.append(option);});select.value=value||'';select.onchange=()=>{beforeDate=$('beforeDate').value;afterDate=$('afterDate').value;render();};label.append(select);controls.append(label);}compare.append(controls);
 const comparison=compareReports(reports,{beforeDate:beforeDate||dates.at(-2),afterDate:afterDate||dates.at(-1)});comparison.warnings.forEach(w=>compare.append(node('p',w,'notice')));
 table(compare,['车间 / 工序','前期施工内容','后期施工内容','施工状态变化','判断','待确认'],comparison.rows.map(r=>[`${r.workshop} · ${r.process}`,r.before?.constructionContent,r.after?.constructionContent,r.statusChange,r.classification,r.notes?.join('；')]));
 const photos=section('images'),gallery=node('div',null,'image-gallery');photos.append(node('p','仅展示已人工复核、明确批准公开且有效关联日报的施工照片。'));
 const allowedPhotos=(data.photos||[]).filter(r=>r.date<=cutoff&&(!$('workshopFilter').value||r.workshop===$('workshopFilter').value));
 if(!allowedPhotos.length)photos.append(node('p','暂无已批准公开的施工照片','notice'));
 for(const photo of allowedPhotos){const figure=node('figure'),img=node('img');img.src=`/api/public-photo?id=${encodeURIComponent(photo.imageId)}`;img.alt=photo.caption||'施工照片';img.loading='lazy';const details=node('details'),summary=node('summary','查看照片详情');details.append(summary,node('p',`${photo.date} · ${photo.workshop} · ${photo.caption||''}`));figure.append(img,details);gallery.append(figure);}photos.append(gallery);
 const workshopView=section('workshops');workshops(workshopView,data.reports?latestWorkshopStates(reportRows):data.workshops||[]);
 const progressView=section('progress');progressView.append(node('p',`计划 ${prefix+pct(progress.planned)} · 实际 ${prefix+pct(progress.actual)} · ${progress.qualityStatus||'按当前 WBS 基准计算'}`,provisional?'notice danger':''));chart(panel(progressView,'S Curve · 计划 / 实际累计'),progress.timeline||[],['planned','actual'],['计划','实际']);
 table(panel(progressView,'专业进度'),['专业','专业内部计划完成率','专业内部实际完成率','对项目贡献'],(p.disciplines||[]).map(r=>[r.name,pct(r.plannedCompletion),pct(r.actualCompletion),pct(r.contributionToProject)]));
 table(panel(progressView,'WBS 明细 · 月末口径'),['WBS','工作项','专业','月份','权重','计划累计','实际累计','计划总量','跟踪总量','复核状态'],(p.latest||[]).map(r=>[r.wbs,r.item,r.discipline,r.month,r.weight,pct(r.plannedCumulativePct),pct(r.actualCumulativePct),`${display(r.baselineTotal??r.total)} ${r.unit||''}`,`${display(r.trackingTotal)} ${r.unit||''}`,r.quantityMismatch?'To Be Verified':r.stale?'数据过期':'按当前基准计算']),{empty:hasRows?'该日期暂无完整月末数据':'暂无 WBS 明细；需发布最新完整看板'});
 for(const issue of p.qualityIssues||[])progressView.append(node('p',`${issue.wbs} ${issue.item||''}：计划基准 ${issue.baselineTotal} / 实际跟踪 ${issue.trackingTotal} ${issue.unit||''} · To Be Verified`,'notice'));
 const people=section('people'),peoplePanel=panel(people,'人员投入变化');peoplePanel.insertAdjacentHTML('beforeend',renderWorkforceChart(workforce));table(people,['日期','中方','属地','合计','复核状态'],workforce.map(r=>[r.date,r.chinese,r.local,r.total,r.needsReview?'待复核':'已按报告口径统计']));
 const equipment=section('equipment');table(panel(equipment,'日报设备状态'),['设备','最新状态','车间'],(analytics.equipment||[]).map(r=>[r.name,r.status,r.workshop]));
 table(panel(equipment,'设备物流 / 发运批次'),['设备类别','设备','发运批次','数量','ETA','到港','清关','现场到货','状态','安装区域'],(data.shipments||[]).map(r=>[r.category,r.equipmentName,r.shipmentBatch,`${display(r.quantity)} ${r.unit||''}`,r.eta,r.arrivalDate,r.customsStatus,r.siteArrivalDate,r.status,r.installationArea]),{empty:'设备物流尚未录入真实数据'});
 const crosswalk=section('crosswalk');table(crosswalk,['来源类型','来源值','目标类型','目标值','关系','备注'],(data.mappings||[]).map(r=>[r.sourceType,r.sourceValue,r.targetType,r.targetValue,r.relation,r.note]),{empty:'Crosswalk 尚未录入映射数据'});
 const findings=crossAnalyze({reports,progress:data.progressRecords||[],shipments:data.shipments||[],mappings:data.mappings||[],asOf}),risks=section('risks');
 for(const risk of analytics.risks||[]){const card=node('article',null,'risk-card');card.append(node('h3',risk.title),node('p',`${risk.date} · ${risk.detail}`));risks.append(card);}for(const f of findings){const card=node('article',null,'risk-card');card.append(node('h3',f.title),node('p','规则推断 · 待人工确认'),node('p',f.facts.join('；')),node('p',f.confirmation));risks.append(card);}if(!risks.children.length)risks.append(node('p','当前筛选范围暂无已报告风险或规则预警'));
 const evidence=section('evidence');table(evidence,['车间','工序','起始日期','结束日期','有效日报日','证据内容'],(analytics.stoppages||[]).map(r=>[r.workshop,r.process,r.startDate,r.endDate,r.days,r.evidence.map(e=>`${e.date}：${e.status||''} ${e.constructionContent||''}`).join('；')]),{empty:'暂无达到连续停工规则的证据；没有人员不自动等同于停工'});
 show();
}
window.addEventListener('hashchange',show);
try{const response=await fetch('/api/public-dashboard',{cache:'no-store'});if(!response.ok)throw Error('公开看板暂时不可用，请稍后重试');data=await response.json();if(!data.published){$('publication').textContent='尚未发布公开项目状态';}else{
 const stale=data.validUntil&&Date.now()>Date.parse(data.validUntil);$('publication').className=stale?'notice danger':'';$('publication').textContent=stale?`公开快照已过期（有效期至 ${new Date(data.validUntil).toLocaleString('zh-CN',{timeZone:'Asia/Baghdad'})}）。请登录项目系统查看实时数据，不宜用此快照作当前决策。`:`数据截至 ${data.asOf} · 发布于 ${new Date(data.publishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Baghdad'})}（伊拉克时间）· 有效至 ${new Date(data.validUntil||data.publishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Baghdad'})} · 只读`;
 $('filters').hidden=false;for(const id of ['dateFilter','progressAsOf']){$(id).value=data.asOf;$(id).max=data.asOf;}
 for(const [id,field] of [['workshopFilter','workshop'],['processFilter','process']]){const values=[...new Set((data.reports||[]).map(r=>r[field]).filter(Boolean))].sort();for(const v of values){const o=node('option',v);o.value=v;$(id).append(o);}}
 for(const id of ['dateFilter','progressAsOf','workshopFilter','processFilter'])$(id).onchange=()=>{beforeDate='';afterDate='';render();};render();
}}catch(error){$('publication').textContent=error.message;}
