import {createAuthSession} from './src/auth.js';
import {compareReports} from './src/comparison.js';
import {evidenceOf,withProvenance} from './src/report-model.js';
import { analyzeRecords, parseCSV, normalizeRows, filterRecords, exportCSV, SAMPLE_RECORDS } from './src/analytics.js';
import { parseXLSX } from './src/xlsx.js';
import { ReportStore, EvidenceStore, businessKey } from './src/storage.js';
import { createTemplateXLSX } from './src/xlsx-writer.js';
import { parsePDFDocument } from './src/pdf.js';
import { ImageAnalysisProvider,findEvidenceConflicts } from './src/image-analysis.js';
import { waitForVisionSlot } from './src/vision-pacing.js';
import { ProjectDatabase } from './src/database.js';
import { loadCloudConfig, SupabaseCloudRepository } from './src/cloud.js';
import { OCRProvider } from './src/pdfjs-adapter.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const store = new ReportStore();
const evidenceStore = new EvidenceStore();
const database = new ProjectDatabase();
let records = store.all();
let period = 'day';
let demoMode = false;
let pendingImport = null;
let cloud = null;
let auth=null;
let visionBusy=false;
let visionController=null,lastVisionCallAt=0;
const adapters = {
  csv: async file => ({ records: normalizeRows(parseCSV(await file.text()), file.webkitRelativePath||file.name,{allowIncomplete:true}), images: [] }),
  xlsx: async file => ({ records: normalizeRows(await parseXLSX(await file.arrayBuffer()), file.webkitRelativePath||file.name,{allowIncomplete:true}), images: [] }),
  pdf: async file => parsePDFDocument(await file.arrayBuffer(), file.name),
  // Extension point for a future Google Drive transport; downloaded files reuse these adapters.
};
async function syncDatabase(){try{await database.replace(store.all(),evidenceStore.all());}catch(error){console.warn('IndexedDB sync failed',error);}}
try{const snapshot=await database.load();if(snapshot.records.length||snapshot.images.length){store.write(snapshot.records);evidenceStore.setCache(snapshot.images);records=snapshot.records;}else await syncDatabase();}catch(error){console.warn('IndexedDB unavailable; using localStorage fallback',error);}
function updateCloudStatus(session){
  if(cloud)cloud.token=session?.access_token||'';
  $('#cloudStatus').textContent=!cloud?.configured?'本机模式 · 未配置云数据库':session?'已自动登录 · 云端连接':'云端已配置 · 点击登录';
  $('#signOutButton').hidden=!session;refreshVisionStatus();
}
async function hydrateCloud(){
  if(!cloud?.token)return;
  const snapshot=await cloud.loadProject();store.mergeRemote(snapshot.records);evidenceStore.merge(snapshot.images);records=store.all();
  await hydrateImages();await syncDatabase();populateFilters();render();renderHistory();renderImages();
}
async function hydrateImages(){for(const image of evidenceStore.all())if(image.objectPath)try{image.signedUrl=await cloud.signedUrl(image.objectPath);}catch{image.signedUrl='';}}
try{
  const config=await loadCloudConfig();cloud=new SupabaseCloudRepository(config);updateCloudStatus(null);
  if(cloud.configured){
    auth=await createAuthSession(config);cloud.auth=auth;auth.subscribe(updateCloudStatus);
    try{await auth.initialize();}catch(error){$('#cloudStatus').textContent='登录状态暂时无法验证 · 点击重试';}
    // No automatic legacy-file migration or other cloud writes on startup.
    if(cloud.token)try{await hydrateCloud();}catch(error){$('#cloudStatus').textContent='已登录 · 云端读取失败，点击重试';}
  }
}catch{$('#cloudStatus').textContent='本机模式 · 云端配置不可用';}
$('#cloudStatus').onclick=async()=>{
  if(!cloud?.configured)return toast('部署环境尚未配置 Supabase',true);
  if(cloud.token){try{await hydrateCloud();toast('云端数据已读取');}catch(error){toast(error.message,true);}return;}
  $('#loginError').textContent='';$('#loginDialog').showModal();
};
$('#loginForm').onsubmit=async event=>{event.preventDefault();const button=$('#sendLogin');button.disabled=true;try{await cloud.requestMagicLink($('#loginEmail').value,location.origin+location.pathname);$('#loginError').textContent='登录链接已发送。首次验证后，此浏览器将自动恢复登录。';}catch(error){$('#loginError').textContent=error.message;}finally{button.disabled=false;}};
$('#cancelLogin').onclick=()=>$('#loginDialog').close();
$('#signOutButton').onclick=async()=>{try{await auth.signOut();for(const image of evidenceStore.all())delete image.signedUrl;renderImages();toast('已退出登录；此浏览器保存的日报仍保留');}catch(error){toast(error.message,true);}};


function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function populateFilters() {
  const currentWorkshop = $('#workshopFilter').value, currentProcess = $('#processFilter').value;
  const options = (values, empty) => `<option value="">${empty}</option>` + [...new Set(values.filter(Boolean))].sort().map(v => `<option>${escapeHTML(v)}</option>`).join('');
  $('#workshopFilter').innerHTML = options(records.map(r => r.workshop), '全部车间');
  $('#processFilter').innerHTML = options(records.map(r => r.process), '全部工序');
  $('#workshopFilter').value = currentWorkshop; $('#processFilter').value = currentProcess;
  if (records.length && !$('#dateFilter').value) $('#dateFilter').value = records.map(r => r.date).sort().at(-1);
  $('#workshopList').innerHTML = [...new Set(records.map(r => r.workshop).filter(Boolean))].map(v => `<option value="${escapeHTML(v)}">`).join('');
  $('#processList').innerHTML = [...new Set(records.map(r => r.process).filter(Boolean))].map(v => `<option value="${escapeHTML(v)}">`).join('');
}

function escapeHTML(value = '') { const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML; }
const signedNumber=value=>value==null?'未报告':`${value>=0?'+':''}${Number(value.toFixed(3))}`;
function renderComparison(){
  const dates=[...new Set(records.map(r=>r.date).filter(Boolean))].sort(),before=$('#compareBefore'),after=$('#compareAfter');
  const oldBefore=before.value,oldAfter=after.value,options=dates.map(d=>`<option>${escapeHTML(d)}</option>`).join('');
  before.innerHTML=after.innerHTML=options;after.value=dates.includes(oldAfter)?oldAfter:dates.at(-1)||'';before.value=dates.includes(oldBefore)?oldBefore:dates.filter(d=>d<after.value).at(-1)||'';
  const comparison=compareReports(records,{beforeDate:before.value,afterDate:after.value});
  $('#compareWarnings').textContent=comparison.warnings.join(' ');
  $('#comparisonRows').innerHTML=comparison.rows.map(row=>`<article class="comparison-card"><h3>${escapeHTML(row.workshop||'未报告')} · ${escapeHTML(row.process||'未报告')} ${escapeHTML(row.activityId)} <span class="tag">${row.classification}</span></h3><p>${escapeHTML(row.statusChange||'无法匹配')}</p><p>人数变化：中方 ${signedNumber(row.changes.chineseStaff)} / 属地 ${signedNumber(row.changes.localStaff)}；当日工程量变化 ${signedNumber(row.changes.dailyQuantity)} ${escapeHTML(row.unit||'')}；累计工程量变化 ${signedNumber(row.changes.cumulativeQuantity)} ${escapeHTML(row.unit||'')}</p><p>施工内容：${escapeHTML(row.before?.constructionContent||'未报告')} → ${escapeHTML(row.after?.constructionContent||'未报告')}</p><p>设备状态：${escapeHTML(row.before?.equipmentStatus||'未报告')} → ${escapeHTML(row.after?.equipmentStatus||'未报告')}</p><p>问题：${escapeHTML(row.before?.risk||'未报告')} → ${escapeHTML(row.after?.risk||'未报告')}</p><p class="negative">${escapeHTML(row.notes.join('；'))}</p><details><summary>两份日报来源和原文</summary>${row.evidence.map(e=>`<blockquote><b>${escapeHTML(e.date)} · ${escapeHTML(e.sourceFile)}${e.pageNumber?' · 第 '+e.pageNumber+' 页':''}</b><p>${escapeHTML(e.excerpt)}</p></blockquote>`).join('')}</details></article>`).join('')||'<p>暂无可对比数据</p>';
}
$('#compareBefore').onchange=renderComparison;$('#compareAfter').onchange=renderComparison;
function pct(value) { return value == null ? '—' : `${value.toFixed(1)}%`; }
function delta(value) { return value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`; }
function statusClass(value = '') { return /停工|滞后|受阻|未到货|待清关|延误/.test(value) ? 'danger' : /进行|准备|运输|已发运/.test(value) ? 'warning' : 'good'; }
function imagesFor(record) { const key=businessKey(record); return evidenceStore.all().filter(image=>!image.ignored&&(image.relatedRecordId===record.id||image.relatedRecordKey===key||(!image.relatedRecordId&&image.association?.status!=='unassociated'&&businessKey({date:image.relatedDate,workshop:image.relatedWorkshop,process:image.relatedProcess})===key))); }

function renderChart(points) {
  if (!points.length) return '<div class="mini-empty">无可用时间序列</div>';
  const width = 700, height = 210, pad = 24, max = Math.max(100, ...points.flatMap(p => [p.planned || 0, p.actual || 0]));
  const x = i => pad + i * (width - pad * 2) / Math.max(1, points.length - 1), y = v => height - pad - (v || 0) / max * (height - pad * 2);
  const path = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="计划和实际进度趋势"><g class="grid-lines">${[0,25,50,75,100].map(v => `<line x1="${pad}" y1="${y(v)}" x2="${width-pad}" y2="${y(v)}"/><text x="0" y="${y(v)+3}">${v}%</text>`).join('')}</g><path class="plan-line" d="${path('planned')}"/><path class="actual-line" d="${path('actual')}"/>${points.map((p,i)=>`<circle class="actual-dot" cx="${x(i)}" cy="${y(p.actual)}" r="3"><title>${p.date}: 实际 ${pct(p.actual)}</title></circle>`).join('')}</svg><div class="x-labels">${points.map((p,i)=> i===0||i===points.length-1||i===Math.floor(points.length/2)?`<span style="left:${x(i)/width*100}%">${p.date.slice(5)}</span>`:'').join('')}</div>`;
}

function render() {
  const filtered = filterRecords(records, { date: $('#dateFilter').value, workshop: $('#workshopFilter').value, process: $('#processFilter').value });
  $('#recordCount').textContent = `${filtered.length} 条原始记录`;
  $('#emptyState').hidden = records.length > 0; $('#dashboard').hidden = records.length === 0; $('#demoBanner').hidden = !demoMode;
  $('#dataStatus').textContent = demoMode ? '示例数据 · 非项目实绩' : records.length ? `${records.length} 条记录已载入` : '尚未导入数据';
  renderComparison();
  if (!records.length) return;
  const a = analyzeRecords(filtered, period);
  $('#plannedKpi').textContent = pct(a.kpis.planned); $('#actualKpi').textContent = pct(a.kpis.actual);
  $('#plannedNote').textContent = a.latestDate ? `截至 ${a.latestDate}` : '等待数据';
  $('#varianceNote').textContent = a.kpis.variance == null ? '缺少计划或实际值' : `计划偏差 ${delta(a.kpis.variance)}`;
  $('#concreteKpi').textContent = a.quantityGroups.length === 0 ? '—' : a.quantityGroups.length === 1 ? `${a.quantityGroups[0].daily?.toFixed(2) ?? '—'} / ${Number.isFinite(a.quantityGroups[0].cumulative)?a.quantityGroups[0].cumulative.toFixed(2):'—'}` : `${a.quantityGroups.length} 组`;
  $('#concreteNote').textContent = a.quantityGroups.length === 1 ? `${a.quantityGroups[0].workshop} · ${a.quantityGroups[0].unit}` : a.quantityGroups.length > 1 ? '按车间、工序和单位分别统计' : '暂无工程量数据';
  $('#peopleKpi').textContent = a.kpis.totalStaff ?? '—'; $('#peopleNote').textContent = `中方 ${a.kpis.chineseStaff ?? '—'} · 属地 ${a.kpis.localStaff ?? '—'} · 较上期 ${a.kpis.staffDelta == null ? '—' : (a.kpis.staffDelta >= 0 ? '+' : '') + a.kpis.staffDelta}`;
  $('#stoppageKpi').textContent = a.stoppages.length;
  $('#trendChart').innerHTML = renderChart(a.timeline); $('#chartCaption').textContent = `${period === 'day' ? '每日' : period === 'week' ? '每周' : '每月'}聚合 · ${a.timeline.length} 个数据点`;
  $('#workforceChart').innerHTML = a.workforce.length ? a.workforce.slice(-8).map(p => `<div class="staff-row"><span>${p.date.slice(5)}</span><div><i class="cn" style="width:${Math.min(100,p.chinese/Math.max(1,a.maxStaff)*100)}%"></i><i class="local" style="width:${Math.min(100,p.local/Math.max(1,a.maxStaff)*100)}%"></i></div><b>${p.chinese!=null&&p.local!=null?p.chinese+p.local:'—'}</b></div>`).join('') + '<div class="staff-legend"><i></i>中方人员 <i></i>属地人员</div>' : '<div class="mini-empty">暂无人员数据</div>';
  $('#workshopRows').innerHTML = a.workshops.length ? a.workshops.map(w => {const photos=evidenceStore.all().filter(i=>!i.ignored&&i.relatedWorkshop===w.workshop&&i.relatedProcess===w.process).length;return `<tr><td><b>${escapeHTML(w.workshop)}</b><small>${escapeHTML(w.process || '未填写工序')} ${photos?`· 📷 ${photos}`:''}</small></td><td>${pct(w.planned)}</td><td><span class="bar"><i style="width:${w.actual || 0}%"></i></span>${pct(w.actual)}</td><td class="${(w.variance||0)<0?'negative':'positive'}">${delta(w.variance)}</td><td>${delta(w.change)}</td><td><span class="tag ${statusClass(w.status)}">${escapeHTML(w.status || '未标注')}</span></td></tr>`;}).join('') : '<tr><td colspan="6" class="mini-empty">筛选范围内无车间数据</td></tr>';
  $('#equipmentList').innerHTML = a.equipment.length ? a.equipment.map(e => {const photos=evidenceStore.all().filter(i=>!i.ignored&&i.relatedWorkshop===e.workshop&&/设备到货|安装准备/.test(i.scene||'')).length;return `<div><span class="equipment-icon">◇</span><span><b>${escapeHTML(e.name)}</b><small>${escapeHTML(e.workshop)} · ${escapeHTML(e.note || '无补充记录')} ${photos?`· 📷 ${photos}`:''}</small></span><em class="tag ${statusClass(e.status)}">${escapeHTML(e.status)}</em></div>`;}).join('') : '<div class="mini-empty">暂无设备状态记录</div>';
  $('#riskCount').textContent = a.risks.length; $('#riskList').innerHTML = a.risks.length ? a.risks.map(r => {const photos=evidenceStore.all().filter(i=>!i.ignored&&i.relatedDate===r.date&&r.detail.includes(i.relatedWorkshop)).length;return `<div><span>!</span><p><b>${escapeHTML(r.title)}</b><small>${escapeHTML(r.detail)} ${photos?`· 📷 ${photos} 张关联证据`:''}</small><em>${escapeHTML(r.date)} · ${escapeHTML(r.reportName)}</em></p></div>`;}).join('') : '<div class="mini-empty success">当前筛选范围内未识别到风险</div>';
  $('#evidenceList').innerHTML = a.stoppages.length ? a.stoppages.map(s => `<details><summary><span><b>${escapeHTML(s.workshop)} · ${escapeHTML(s.process)}</b><small>${s.startDate} 至 ${s.endDate} · 连续 ${s.days} 个有效日报日</small></span><strong>查看 ${s.evidence.length} 条日报证据</strong></summary>${s.evidence.map(e => {const photos=imagesFor(e);return `<blockquote><b>${escapeHTML(e.reportName)} · ${e.date}</b><p>${escapeHTML(e.rawRecord || '状态：' + e.status)}</p>${photos.length?`<button class="row-action evidence-jump" data-image="${photos[0].imageId}">📷 ${photos.length} 张图片证据</button>`:''}</blockquote>`;}).join('')}</details>`).join('') : '<div class="mini-empty success">未发现满足规则的连续停工</div>';
  $$('.evidence-jump').forEach(button=>button.onclick=()=>openImage(button.dataset.image));
}

async function importFiles(files) {
  files=[...files].filter(file=>/\.(csv|xlsx|pdf)$/i.test(file.name));const messages = [], imported = [], extractedImages=[];
  const hasPDF=files.some(file=>/\.pdf$/i.test(file.name));if(hasPDF&&cloud?.configured&&!cloud.token){toast(!cloud?.configured?'PDF 云端导入需要先配置 Supabase':'请先点击页头云端状态并完成登录，再导入 PDF',true);return;}
  for (const file of files) {
    try { const ext = file.name.split('.').pop().toLowerCase(),sourceName=file.webkitRelativePath||file.name; if (!adapters[ext]) throw new Error('暂不支持此文件类型'); const allowOCR=$('#ocrConsent').checked&&Boolean(cloud?.config.ocrEnabled),adapter=ext==='pdf'?async()=>parsePDFDocument(await file.arrayBuffer(),sourceName,{allowOCR,ocrProvider:allowOCR?new OCRProvider({endpoint:'/api/ocr',consent:true,accessToken:cloud?.token||''}):null}):adapters[ext],result = await adapter(file); imported.push(...result.records); extractedImages.push(...result.images); messages.push(`${sourceName}: ${result.records.length} 条记录，${result.images.length} 张图片${result.diagnostics?.warnings?.length?'，'+result.diagnostics.warnings.join(''):''}`); }
    catch (error) { messages.push(`${file.name}: 导入失败（${error.message}）`); }
  }
  const existingRecords=new Map(store.all().map(record=>[businessKey(record),record])),seen=new Set(),preview=imported.map(record=>{const key=businessKey(record),duplicate=existingRecords.has(key)||seen.has(key);seen.add(key);record.id=record.id||crypto.randomUUID();return {record,duplicate};});
  const newRecords=preview.filter(x=>!x.duplicate).map(x=>x.record);
  const importId=crypto.randomUUID();
  for(const record of newRecords)record.originalFileId=`${importId}/${record.sourceFile||record.source}`;
  const existingImages=new Set(evidenceStore.all().map(i=>i.imageId)),newImages=extractedImages.filter(i=>!existingImages.has(i.imageId));
  for(const image of newImages){const related=newRecords.find(r=>businessKey(r)===image.relatedRecordKey)||existingRecords.get(image.relatedRecordKey);if(related)image.relatedRecordId=related.id;}
  pendingImport={importId,fileObjects:[...files],files:[...files].map(f=>f.webkitRelativePath||f.name),records:newRecords,images:newImages,messages,hasPDF,cloudSave:Boolean(cloud?.configured&&cloud.token),hasErrors:messages.some(x=>x.includes('导入失败'))};
  $('#importSummary').textContent=`解析 ${imported.length} 条记录、${extractedImages.length} 张图片；${preview.filter(x=>x.duplicate).length} 条重复将跳过；${messages.filter(x=>x.includes('导入失败')).length} 个文件失败。`;
  $('#importMessages').textContent=messages.join('\n');
  $('#confirmImport').disabled=pendingImport.hasErrors||(!imported.length&&!extractedImages.length);
  $('#importPreviewRows').innerHTML=preview.slice(0,100).map(({record,duplicate})=>`<tr><td>${escapeHTML(record.sourceFile||record.source)}${record.pageNumber?` · 第 ${record.pageNumber} 页`:''}<details><summary>原文与复核</summary><p>${escapeHTML(record.sourceExcerpt||record.rawRecord||'')}</p><small>${record.needsReview?'待复核：'+escapeHTML(record.reviewFields.join(', ')):'已识别明确字段，仍请核对原文'}</small></details></td><td>${record.date||'<span class="negative">待复核</span>'}</td><td>${escapeHTML(record.workshop||'待复核')} / ${escapeHTML(record.process||'待复核')}</td><td>${escapeHTML(record.status||'—')}</td><td><span class="tag ${duplicate?'warning':'good'}">${duplicate?'重复跳过':'新增'}</span></td></tr>`).join('')||'<tr><td colspan="5" class="mini-empty">没有可导入的结构化记录</td></tr>';$('#uploadProgress').hidden=true;$('#confirmImport').textContent='确认上传并导入';$('#importDialog').showModal();
}
$('#cancelImport').onclick=()=>{pendingImport=null;$('#fileInput').value='';$('#folderInput').value='';$('#importDialog').close();toast('已取消，原有数据未修改');};
$('#confirmImport').onclick=async()=>{if(!pendingImport)return;const batch=pendingImport,importId=batch.importId,pdfs=batch.fileObjects;if(!batch.records.length&&!batch.images.length){pendingImport=null;$('#fileInput').value='';$('#folderInput').value='';$('#importDialog').close();toast('该日报已导入：记录与图片未重复保存');return;}if(batch.cloudSave&&!cloud?.token)return toast('云端身份已失效，请重新登录后重试',true);const button=$('#confirmImport'),progress=$('#uploadProgress'),bar=$('#uploadProgressBar'),label=$('#uploadProgressText'),total=Math.max(1,pdfs.length+batch.images.length);let completed=0;const update=item=>{completed++;progress.hidden=false;bar.style.width=`${Math.min(100,completed/total*100)}%`;label.textContent=item.error?`${item.name} 上传失败：${item.error}`:`正在上传 ${completed}/${total}：${item.name}`;};button.disabled=true;$('#cancelImport').disabled=true;try{let uploadPaths=[];if(batch.cloudSave){const originals=await cloud.uploadOriginals(pdfs,importId,update),pictures=await cloud.uploadEvidenceImages(batch.images,importId,update),failures=[...originals.failures,...pictures.failures];uploadPaths=[...originals.paths,...pictures.paths];if(failures.length)throw new Error(`${failures.length} 个文件上传失败，可点击重试；已成功部分不会重复统计`);for(let index=0;index<pdfs.length;index++){const name=pdfs[index].webkitRelativePath||pdfs[index].name;for(const record of batch.records)if((record.sourceFile||record.source)===name)record.originalObjectPath=originals.paths[index];for(const image of batch.images)if(image.sourceFile===name)image.originalObjectPath=originals.paths[index];}
for(const image of batch.images)if(image.objectPath)image.signedUrl=await cloud.signedUrl(image.objectPath);await cloud.saveBatch(batch.records,batch.images,{importId,files:batch.files,uploadPaths});for(const image of batch.images)delete image.dataUrl;}else{await database.saveOriginals(batch.fileObjects,importId);for(const image of batch.images)image.localPreview=true;}const result=store.merge(batch.records),imageResult=evidenceStore.merge(batch.images);records=result.records;await syncDatabase();await database.addImport({importId,createdAt:new Date().toISOString(),files:batch.files,added:result.added,skipped:result.skipped,images:imageResult.added,uploadPaths,status:'complete',errors:[]}).catch(()=>{});demoMode=false;$('#importLog').textContent=[...batch.messages,`新增 ${result.added} 条，重复跳过 ${result.skipped} 条，新增图片 ${imageResult.added} 张${batch.cloudSave?'；云端保存完成':'；仅本机保存'}`].join('；');pendingImport=null;$('#fileInput').value='';$('#folderInput').value='';$('#importDialog').close();populateFilters();render();renderHistory();renderImages();toast(`导入完成：${result.added} 条日报，${imageResult.added} 张图片`);}catch(error){await database.addImport({importId,createdAt:new Date().toISOString(),files:batch.files,status:'failed',error:error.message}).catch(()=>{});progress.hidden=false;label.textContent=`上传未完成：${error.message}`;button.textContent='重试失败上传';toast(error.message,true);}finally{button.disabled=false;$('#cancelImport').disabled=false;}};

$$('.import-trigger').forEach(b => b.onclick = () => $('#fileInput').click()); $('#importTop').onclick = () => { location.hash = 'import'; $('#fileInput').click(); };
$('#fileInput').onchange = event => importFiles([...event.target.files]);
$('#folderImportButton').onclick=()=>$('#folderInput').click();$('#folderInput').onchange=event=>importFiles([...event.target.files].filter(file=>/\.pdf$/i.test(file.name)));
$$('.period-switch button').forEach(b => b.onclick = () => { $$('.period-switch button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); period=b.dataset.period; render(); });
['dateFilter','workshopFilter','processFilter'].forEach(id => $(`#${id}`).onchange = render);
$('#clearFilters').onclick = () => { $('#dateFilter').value = records.map(r=>r.date).sort().at(-1)||''; $('#workshopFilter').value=''; $('#processFilter').value=''; render(); };
$('#demoButton').onclick = () => { records = SAMPLE_RECORDS.map(x=>({...x})); demoMode=true; populateFilters(); render(); toast('已载入明确标注的示例数据，不会写入本地存储'); };
$('#clearData').onclick = () => { records=store.all(); demoMode=false; populateFilters(); render(); };
$('#exportButton').onclick = () => { if(!records.length) return toast('没有可导出的数据',true); const filtered=filterRecords(records,{date:$('#dateFilter').value,workshop:$('#workshopFilter').value,process:$('#processFilter').value}); const blob=new Blob(['\ufeff'+exportCSV(filtered)],{type:'text/csv;charset=utf-8'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`khayrat-analysis-${$('#dateFilter').value||'all'}.csv`; a.click(); URL.revokeObjectURL(a.href); };
$('#templateButton').onclick = () => { const header='日报名称,日期,车间,工序,活动编号,WBS权重,计划进度,实际进度,实际完成工作量,累计完成量,工作量单位,人员口径,工种,中方人员,属地人员,设备名称,设备到货情况,制约因素,施工状态,备注,施工内容\n'; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+header],{type:'text/csv'})); a.download='khayrat-daily-report-template.csv'; a.click(); };
const menu=()=>{$('#sidebar').classList.toggle('open');$('#overlay').classList.toggle('show')}; $('#menuButton').onclick=menu; $('#overlay').onclick=menu;

function formRecord() {
  const values = Object.fromEntries(new FormData($('#reportForm')));const existing=store.all().find(r=>r.id===values.id); const numeric = ['chineseStaff','localStaff','wbsWeight','plannedProgress','actualProgress','dailyConcrete','cumulativeConcrete'];
  numeric.forEach(field => values[field] = values[field] === '' ? null : Number(values[field]));
  return { ...existing,...values,reviewFields:[],needsReview:false,reportName: `手工日报-${values.date}`, source: '浏览器手工录入' };
}
function resetForm() { $('#reportForm').reset(); $('#reportForm').elements.id.value=''; $('#reportForm').elements.createdAt.value=''; $('#formTitle').textContent='新增日报记录'; $('#cancelEdit').hidden=true; $('#duplicateWarning').hidden=true; $$('[data-error]').forEach(x=>x.textContent=''); $('#reportForm').elements.date.value=new Date().toISOString().slice(0,10); }
function renderHistory() {
  let rows=[...store.all()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')), keyword=$('#historyKeyword').value.trim().toLowerCase(), start=$('#historyStart').value, end=$('#historyEnd').value;
  rows=rows.filter(r=>(!keyword||[r.workshop,r.process,r.rawRecord,r.risk].some(v=>String(v||'').toLowerCase().includes(keyword)))&&(!start||r.date>=start)&&(!end||r.date<=end));
  $('#localCount').textContent=`${store.all().length} 条`; $('#historyRows').innerHTML=rows.length?rows.map(r=>{const photos=imagesFor(r);return `<tr><td>${escapeHTML(r.date||'待复核')}</td><td><b>${escapeHTML(r.workshop)}</b><small>${escapeHTML(r.process)} ${r.activityId?`· ${escapeHTML(r.activityId)}`:''} ${r.sourceType==='pdf'?`· PDF 第 ${r.pageNumber} 页`:''}</small></td><td>中 ${r.chineseStaff??'—'} / 属 ${r.localStaff??'—'}</td><td>${r.dailyConcrete??'—'} ${escapeHTML(r.workUnit||'')}</td><td><span class="tag ${statusClass(r.status)}">${escapeHTML(r.status||'未标注')}</span></td><td>${escapeHTML(r.equipmentStatus||'—')} ${photos.length?`<button class="row-action" data-image="${photos[0].imageId}">📷 ${photos.length}</button>`:''}</td><td><button class="row-action" data-source="${escapeHTML(r.id)}">来源</button><button class="row-action" data-edit="${r.id}">编辑</button><button class="row-action danger-text" data-delete="${r.id}">删除</button></td></tr>`;}).join(''):'<tr><td colspan="7" class="mini-empty">没有符合条件的本地日报</td></tr>';
  $$('[data-source]').forEach(button=>button.onclick=()=>openSource(button.dataset.source)); $$('[data-edit]').forEach(button=>button.onclick=()=>editRecord(button.dataset.edit)); $$('[data-delete]').forEach(button=>button.onclick=()=>deleteRecord(button.dataset.delete)); $$('[data-image]').forEach(button=>button.onclick=()=>openImage(button.dataset.image));
}
function openSource(id){const record=store.all().find(r=>r.id===id);if(!record)return;const evidence=evidenceOf(record);$('#sourceDetails').textContent=`${evidence.sourceFile} · ${evidence.pageNumber?'第 '+evidence.pageNumber+' 页':'第 '+(evidence.sourceRow||'?')+' 行'}\n提取方式：${record.extractionMethod||'结构化输入'}\n${record.needsReview?'待复核：'+record.reviewFields.join(', '):'请核对原文'}\n\n${evidence.excerpt}\n\n${JSON.stringify({personnelStatistics:record.personnelStatistics,activities:record.activities,quantities:record.quantities,sourceLocation:record.sourceLocation,dateSource:record.dateSource},null,2)}`;$('#downloadOriginal').hidden=!record.originalObjectPath&&!record.originalFileId;$('#downloadOriginal').onclick=async()=>{try{let url;if(record.originalObjectPath)url=await cloud.signedUrl(record.originalObjectPath);else{const original=await database.original(record.originalFileId);if(!original?.blob)throw new Error('原始文件不可用，请从来源重新导入');url=URL.createObjectURL(original.blob);}const a=document.createElement('a');a.href=url;a.download=evidence.sourceFile.split('/').at(-1);a.target='_blank';a.rel='noopener';a.click();if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,true);}};$('#sourceDialog').showModal();}
$('#closeSource').onclick=()=>$('#sourceDialog').close();
function editRecord(id) { const record=store.all().find(r=>r.id===id); if(!record)return; for(const [key,value] of Object.entries(record))if($('#reportForm').elements[key])$('#reportForm').elements[key].value=value??''; $('#formTitle').textContent=`编辑日报 · ${record.date}`; $('#cancelEdit').hidden=false; $('#duplicateWarning').hidden=true; location.hash='entry'; $('#reportForm').scrollIntoView({behavior:'smooth'}); }
function deleteRecord(id) { const record=store.all().find(r=>r.id===id); if(!record||!confirm(`确定删除 ${record.date} ${record.workshop} / ${record.process} 的日报吗？`))return; store.remove(id); records=store.all(); syncDatabase(); populateFilters(); render(); renderHistory(); toast('日报已删除'); }
$('#reportForm').onsubmit=async event=>{event.preventDefault();const record=formRecord();$$('[data-error]').forEach(x=>x.textContent='');const result=store.save(record);if(!result.ok){if(result.duplicate){$('#duplicateWarning').innerHTML=`<b>发现重复记录</b>：${escapeHTML(result.duplicate.date)} 已存在相同活动。请编辑原记录或填写不同活动编号。`;$('#duplicateWarning').hidden=false;}else Object.entries(result.errors).forEach(([key,value])=>{const node=$(`[data-error="${key}"]`);if(node)node.textContent=value;});return;}records=store.all();demoMode=false;await syncDatabase();populateFilters();render();renderHistory();resetForm();if(cloud?.token){try{await cloud.saveBatch([result.record],[],{importId:crypto.randomUUID(),files:[result.record.sourceFile||result.record.source],uploadPaths:[]});toast('日报已保存到本机和云端');}catch(error){toast(`本机已保存，云端保存失败：${error.message}`,true);}}else toast('日报已保存到当前浏览器 IndexedDB');};
$('#clearReportForm').onclick=resetForm; $('#cancelEdit').onclick=resetForm;
['historyKeyword','historyStart','historyEnd'].forEach(id=>$(`#${id}`).oninput=renderHistory); $('#historyReset').onclick=()=>{$('#historyKeyword').value='';$('#historyStart').value='';$('#historyEnd').value='';renderHistory();};
$('#backupButton').onclick=()=>{const backup=JSON.parse(store.backup());backup.images=evidenceStore.all().map(({dataUrl,signedUrl,...metadata})=>metadata);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));a.download=`khayrat-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast(`本地数据备份已下载（含 ${backup.images.length} 张图片证据）`);};
$('#restoreButton').onclick=()=>$('#restoreInput').click(); $('#restoreInput').onchange=async event=>{try{const text=await event.target.files[0].text(),data=JSON.parse(text),result=store.restore(text),imageResult=evidenceStore.merge(Array.isArray(data.images)?data.images:[]);records=store.all();await syncDatabase();demoMode=false;populateFilters();render();renderHistory();renderImages();toast(`恢复完成：新增 ${result.added} 条日报、${imageResult.added} 张图片，重复 ${result.skipped}，无效 ${result.invalid}`);}catch(error){toast(error.message,true);}};
function downloadXLSX(){const a=document.createElement('a');a.href=URL.createObjectURL(createTemplateXLSX());a.download='Khayrat工程日报标准模板.xlsx';a.click();URL.revokeObjectURL(a.href);toast('Excel 模板已生成');} $('#excelTemplateButton').onclick=downloadXLSX;
function renderImages() {
  const all=evidenceStore.all(),date=$('#imageDate').value,workshop=$('#imageWorkshop').value,process=$('#imageProcess').value,source=$('#imageSource').value.toLowerCase(),critical=$('#criticalOnly').checked;
  const options=(values,label)=>`<option value="">${label}</option>`+[...new Set(values.filter(Boolean))].sort().map(v=>`<option>${escapeHTML(v)}</option>`).join('');const oldW=workshop,oldP=process;$('#imageWorkshop').innerHTML=options(all.map(i=>i.relatedWorkshop),'全部车间');$('#imageProcess').innerHTML=options(all.map(i=>i.relatedProcess),'全部工序');$('#imageWorkshop').value=oldW;$('#imageProcess').value=oldP;
  const filtered=all.filter(i=>(!date||i.relatedDate===date)&&(!workshop||i.relatedWorkshop===workshop)&&(!process||i.relatedProcess===process)&&(!source||i.sourceFile.toLowerCase().includes(source))&&(!critical||i.critical));$('#imageStorageCount').textContent=`${all.length} 张`;
  $('#imageGallery').innerHTML=filtered.length?filtered.map(image=>{const record=store.all().find(r=>r.id===image.relatedRecordId)||store.all().find(r=>businessKey(r)===image.relatedRecordKey),conflicts=record?findEvidenceConflicts(record,[image]):[];return `<article class="image-card ${image.ignored?'ignored':''}" data-open-image="${image.imageId}"><div class="thumb"><img src="${image.signedUrl||image.dataUrl||''}" alt="${escapeHTML(image.caption||'PDF现场图片')}" loading="lazy">${image.critical?'<b>关键证据</b>':''}</div><div><span class="evidence-label">直接证据</span><h3>${escapeHTML(image.visionEnabled||image.manualReviewed?image.scene||'无法判断':'待视觉识别')}</h3><p>${escapeHTML(image.relatedWorkshop||'未关联车间')} · ${escapeHTML(image.relatedProcess||'未关联工序')}</p><small>${escapeHTML(image.sourceFile)} · 第 ${image.pageNumber} 页 · 图 ${image.imageIndex}</small><div class="tag-row">${(image.tags||[]).map(t=>`<em>${escapeHTML(t)}</em>`).join('')}</div>${conflicts.length?`<strong class="conflict">待人工复核：${escapeHTML(conflicts[0].reason)}</strong>`:''}</div></article>`;}).join(''):'<div class="empty-state compact"><h2>暂无图片证据</h2><p>导入包含 JPEG/JPX 嵌入图片的 PDF 日报后，图片会显示在这里。</p></div>';
  $$('[data-open-image]').forEach(card=>card.onclick=()=>openImage(card.dataset.openImage));
}
function refreshVisionStatus(){
  const config=cloud?.config;
  $('#visionStatus').textContent=config?.visionEnabled?`${config.visionProvider||'OpenAI'} 视觉服务已配置；勾选授权后可分析。${config.visionCostNotice||''}${config.visionMinIntervalMs?' 每张间隔约一分钟，可停止后续分析。':''}`:'视觉服务尚未启用：等待负责人确认外部图片传输和服务费用。';
  $('#visionConsentText').textContent=config?.visionEnabled?`授权将所选照片及对应原文发送至 ${config.visionProvider||'OpenAI'}（${config.visionModel||'gpt-4.1-mini'}）。${config.visionPrivacyNotice||''}`:'视觉服务未配置；请先确认接收平台和数据处理规则。';
  $('#analyzeImages').disabled=visionBusy||!cloud?.config.visionEnabled||!cloud?.token;
  $('#visionConsent').disabled=visionBusy||!config?.visionEnabled;
  $('#stopVision').disabled=!visionBusy;
  $('#ocrConsent').disabled=!cloud?.config.ocrEnabled;
}
function openImage(imageId){
  const image=evidenceStore.all().find(i=>i.imageId===imageId);if(!image)return;
  $('#imageFull').src=image.signedUrl||image.dataUrl||'';
  $('#directEvidence').textContent=`PDF 原始嵌入图片；${image.sourceFile}，第 ${image.pageNumber} 页，图 ${image.imageIndex}。关联：${image.association?.status||'旧版结果待复核'}`;
  $('#imageTextFacts').textContent=image.sourceExcerpt||image.nearbyText||'未关联，不能用整页文字代替';
  $('#imageVisibleFacts').textContent=(image.visibleFacts||[]).join('；')||'未进行像素分析';
  $('#imageCrossValidation').textContent=image.crossValidation?`${image.crossValidation.status}：${image.crossValidation.reason}`:'尚未交叉验证';
  $('#inferenceSummary').textContent=[image.aiSummary,...image.inferences||[],...image.limitations||[]].filter(Boolean).join('；')+`（模型置信度 ${Math.round((image.confidence||0)*100)}%，需人工复核）`;
  $('#imageProvenance').textContent=JSON.stringify({bbox:image.bbox,components:image.components,association:image.association,activities:image.relatedActivities,model:image.model,usage:image.usage,analyzedAt:image.analyzedAt,manualReview:image.manualReview},null,2);
  $('#analyzeImage').disabled=visionBusy||!cloud?.config.visionEnabled||!cloud?.token||!image.objectPath;
  const form=$('#imageForm');for(const key of ['imageId','relatedDate','relatedWorkshop','relatedProcess','scene','evidenceType','caption'])form.elements[key].value=image[key]||'';
  form.elements.tags.value=(image.tags||[]).join(', ');form.elements.reviewedVisibleFacts.value=(image.visibleFacts||[]).join('\n');form.elements.reviewedInferences.value=(image.inferences||[]).join('\n');form.elements.critical.checked=!!image.critical;form.elements.ignored.checked=!!image.ignored;
  form.elements.relatedRecordId.innerHTML='<option value="">未关联（请选择明确的日报记录）</option>'+store.all().filter(r=>r.recordType!=='personnel-summary').map(r=>`<option value="${r.id}">${escapeHTML(r.date)} · ${escapeHTML(r.workshop)} / ${escapeHTML(r.process)}</option>`).join('');
  form.elements.relatedRecordId.value=image.relatedRecordId||'';
  $('#imageOrigin').textContent=`来源：${image.sourceFile} · PDF 第 ${image.pageNumber} 页 · 图 ${image.imageIndex}`;
  if(!$('#imageDialog').open)$('#imageDialog').showModal();
}
async function persistEvidence(changed){
  if(cloud?.configured){if(!cloud.token)throw new Error('请先登录再保存云端图片复核');if(!changed.objectPath)throw new Error('图片尚未上传，先完成导入');await cloud.saveEvidence([changed]);}
  evidenceStore.update(changed.imageId,changed);await syncDatabase();renderImages();render();renderHistory();
}
$('#imageForm').elements.relatedRecordId.onchange=event=>{const r=store.all().find(r=>r.id===event.target.value);if(r)for(const key of ['relatedDate','relatedWorkshop','relatedProcess'])$('#imageForm').elements[key].value=r[{relatedDate:'date',relatedWorkshop:'workshop',relatedProcess:'process'}[key]]||'';};
$('#imageForm').onsubmit=async event=>{
  event.preventDefault();if(visionBusy)return toast('分析进行中，请完成后再保存复核',true);const form=event.currentTarget,button=form.querySelector('[type=submit]'),old=evidenceStore.all().find(i=>i.imageId===form.elements.imageId.value),record=store.all().find(r=>r.id===form.elements.relatedRecordId.value);
  const manualReview={reviewerId:cloud?.configured?auth?.session?.user?.id||'unverified':'local-reviewer',at:new Date().toISOString(),scene:form.elements.scene.value,caption:form.elements.caption.value,relatedRecordId:record?.id||'',confirmed:true};
  const changed={...old,cloudSyncPending:false,originalAnalysis:old.originalAnalysis||{visibleFacts:old.visibleFacts,inferences:old.inferences,confidence:old.confidence,scene:old.scene},visibleFacts:form.elements.reviewedVisibleFacts.value.split('\n').map(x=>x.trim()).filter(Boolean),inferences:form.elements.reviewedInferences.value.split('\n').map(x=>x.trim()).filter(Boolean),originalAssociation:old.originalAssociation||old.association,association:{status:record?'manually-linked':'unassociated',method:'manual',needsReview:false},relatedDate:record?.date||form.elements.relatedDate.value,relatedWorkshop:record?.workshop||form.elements.relatedWorkshop.value,relatedProcess:form.elements.relatedProcess.value||record?.process||'',relatedRecordId:record?.id||'',relatedRecordKey:record?businessKey(record):'',sourceExcerpt:record?.sourceExcerpt||'',nearbyText:record?.sourceExcerpt||'',scene:manualReview.scene,tags:form.elements.tags.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),evidenceType:form.elements.evidenceType.value,caption:manualReview.caption,critical:form.elements.critical.checked,ignored:form.elements.ignored.checked,manualReviewed:true,reviewRecommended:false,manualReview};
  // Reassociation invalidates previous model/text cross-validation without destroying it.
  if(old.relatedRecordId!==changed.relatedRecordId){changed.previousCrossValidation=old.crossValidation;changed.crossValidation=null;changed.reviewRecommended=!!old.visionEnabled;}
  button.disabled=true;try{await persistEvidence(changed);$('#imageDialog').close();toast(cloud?.configured?'图片复核已保存至云端':'图片复核已保存至本机');}catch(error){toast(error.message,true);}finally{button.disabled=false;}
};
async function analyzePhotos(images){
  if(visionBusy)return toast('图片分析进行中，请稍后',true);
  if(!$('#visionConsent').checked)return toast('请先勾选照片和对应原文的外部传输授权',true);
  if(!cloud?.config.visionEnabled||!cloud?.token)return toast('视觉服务尚未获得负责人批准或需要登录',true);
  if(!images.length)return toast('没有待分析且已保存云端的图片');
  visionBusy=true;visionController=new AbortController();refreshVisionStatus();$('#analyzeImage').disabled=true;
  let completed=0;try{const session=await auth.current(),provider=new ImageAnalysisProvider({endpoint:'/api/vision',consent:true,provider:cloud.config.visionProviderId||'',accessToken:session?.access_token||''});
    for(const image of images){const wait=Math.max(0,(cloud.config.visionMinIntervalMs||0)-(Date.now()-lastVisionCallAt));if(wait)$('#visionStatus').textContent=`已完成 ${completed} / ${images.length} 张；等待免费服务调用间隔，可停止后续分析。`;await waitForVisionSlot(wait,visionController.signal);provider.accessToken=(await auth.current())?.access_token||'';if(visionController.signal.aborted)throw new Error('已停止图片分析');lastVisionCallAt=Date.now();const analysis=await provider.analyze(image),changed={...image,...analysis,automaticAnalysis:analysis,manualReview:null,reviewHistory:[...image.reviewHistory||[],image.manualReview].filter(Boolean)};try{await persistEvidence(changed);}catch(error){evidenceStore.update(image.imageId,{...changed,cloudSyncPending:true});await syncDatabase();throw new Error('分析结果已保留本机，云端保存失败；可保存人工复核重试，避免再次调用模型。 '+error.message);}completed++;$('#visionStatus').textContent=`已完成 ${completed} / ${images.length} 张；请人工核对可见事实与工序关联。`;}
    if($('#imageDialog').open)openImage($('#imageForm').elements.imageId.value);
  }catch(error){toast(`完成 ${completed} 张；${error.message}`,true);}finally{visionBusy=false;refreshVisionStatus();$('#analyzeImage').disabled=!cloud?.config.visionEnabled||!cloud?.token;}
}
$('#analyzeImages').onclick=()=>analyzePhotos(evidenceStore.all().filter(i=>!i.ignored&&!i.manualReviewed&&!i.visionEnabled&&i.objectPath).slice(0,33));
$('#stopVision').onclick=()=>{visionController?.abort();$('#visionStatus').textContent='已请求停止后续分析；当前请求若已发送，将保存返回结果。';};
$('#analyzeImage').onclick=()=>analyzePhotos([evidenceStore.all().find(i=>i.imageId===$('#imageForm').elements.imageId.value)].filter(Boolean));
refreshVisionStatus();
$('#closeImageDialog').onclick=()=>$('#imageDialog').close();['imageDate','imageWorkshop','imageProcess','imageSource','criticalOnly'].forEach(id=>$(`#${id}`).oninput=renderImages);$('#imageReset').onclick=()=>{$('#imageDate').value='';$('#imageWorkshop').value='';$('#imageProcess').value='';$('#imageSource').value='';$('#criticalOnly').checked=false;renderImages();};
$$('[data-view]').forEach(link=>link.onclick=event=>{event.preventDefault();$$('[data-view]').forEach(x=>x.classList.remove('active'));link.classList.add('active');$$('.page-view').forEach(view=>view.hidden=view.id!==link.dataset.view);if(link.dataset.view==='entryView')renderHistory();location.hash=link.getAttribute('href');if($('#sidebar').classList.contains('open'))menu();});
resetForm(); populateFilters(); render(); renderHistory(); renderImages();
if(location.hash==='#compare')document.querySelector('[data-view="compareView"]').click();else if (location.hash === '#entry') document.querySelector('[data-view="entryView"]').click(); else if(location.hash==='#images')document.querySelector('[data-view="imagesView"]').click();
