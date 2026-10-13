import {latestWorkshopStates,standardWorkshop} from './src/workshop-status.js';
import {createAuthSession} from './src/auth.js';
import {compareReports} from './src/comparison.js';
import {evidenceOf,withProvenance} from './src/report-model.js';
import { analyzeRecords, parseCSV, normalizeRows, filterRecords, exportCSV, SAMPLE_RECORDS } from './src/analytics.js';
import { parseXLSX,parseKhayratProgressWorkbook } from './src/xlsx.js';
import { ReportStore, EvidenceStore, businessKey } from './src/storage.js';
import { createTemplateXLSX } from './src/xlsx-writer.js';
import { parsePDFDocument } from './src/pdf.js';
import { ImageAnalysisProvider,evidenceReviewState,findEvidenceConflicts,imageUploadTime,sortImageEvidence,summarizeImageEvidence } from './src/image-analysis.js';
import {analyzeWorkshopStoppageEvidence} from './src/stoppage-evidence.js';
import { waitForVisionSlot } from './src/vision-pacing.js';
import { ProjectDatabase } from './src/database.js';
import { loadCloudConfig, SupabaseCloudRepository } from './src/cloud.js';
import { OCRProvider,extractReportDateWithPDFJS } from './src/pdfjs-adapter.js';
import {associateReportDate,backfillStoredReportDates} from './src/date-association.js';
import {normalizeProgressRows,normalizeShipmentRows,normalizeCrosswalkRows,analyzeProgress,summarizeProgress,currentProgressRows,crossAnalyze,PROGRESS_HEADERS,SHIPMENT_HEADERS,CROSSWALK_HEADERS} from './src/project-data.js';
import {renderWorkforceChart} from './src/workforce-chart.js';
import {renderProgressChart} from './src/progress-chart.js';
import {renderLatestPhotoGallery} from './src/latest-gallery.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('#progressAsOf').value=today;$('#progressAsOf').max=today;
function progressCutoff(){const selected=$('#progressAsOf').value||today;return selected>today?today:selected;}
const store = new ReportStore();
const evidenceStore = new EvidenceStore();
let database = new ProjectDatabase();
let records = [];
let projectId='khayrat',cacheUser='',scopeVersion=0,scopeReady=Promise.resolve();
let progressRecords=[],shipmentRecords=[],crosswalkMappings=[];
let period = 'day';
let demoMode = false;
let pendingImport = null;
let cloud = null;
let auth=null;
let memberRole="",isAdmin=false;
function canEdit(){return !cloud?.configured||memberRole==="editor"||isAdmin;}
function assertEditor(){if(!canEdit())throw new Error("当前账号仅允许查看，需 Editor 权限");}
function refreshPermissions(){document.documentElement.dataset.projectRole=canEdit()?"editor":"reader";$("#publishPublic").hidden=!canEdit();$("#manageMembers").hidden=!isAdmin;}

let loginController=null;
let visionBusy=false;
let visionController=null,lastVisionCallAt=0;
const IMAGE_PAGE_SIZE=20;
let imagePage=1,imagePreviewGeneration=0;
const imageUrlCache=new Map();let thumbnailObserver=null,thumbActive=0;const thumbQueue=[];
function limited(task){return new Promise((resolve,reject)=>{thumbQueue.push({task,resolve,reject});pumpThumbs();});}
function pumpThumbs(){while(thumbActive<3&&thumbQueue.length){const item=thumbQueue.shift();thumbActive++;item.task().then(item.resolve,item.reject).finally(()=>{thumbActive--;pumpThumbs();});}}
async function evidenceUrl(image,kind='thumb'){
  if(image.dataUrl)return image.dataUrl;if(!image.objectPath||!cloud?.token)return '';
  const ttl=kind==='thumb'?900:300,key=`${kind}:${image.objectPath}`,cached=imageUrlCache.get(key);if(cached?.expiresAt>Date.now()+30000)return cached.url;
  const transform=kind==='thumb'?{width:480,height:320,resize:'contain',quality:65}:null,url=await limited(()=>cloud.signedUrl(image.objectPath,ttl,transform));imageUrlCache.set(key,{url,expiresAt:Date.now()+ttl*1000});return url;
}
async function setImageSource(node,url){if(!url)throw new Error('图片地址不可用');await new Promise((resolve,reject)=>{node.onload=()=>resolve();node.onerror=()=>reject(new Error('图片加载失败'));node.src=url;});node.onload=null;node.onerror=null;}
async function loadThumb(node){if(!node||node.dataset.loaded)return;const image=evidenceStore.all().find(item=>item.imageId===node.dataset.thumbImage);if(!image)return;const frame=node.closest('.thumb');node.dataset.loaded='loading';frame?.classList.remove('load-failed');try{await setImageSource(node,await evidenceUrl(image));node.dataset.loaded='true';frame?.classList.add('loaded');frame?.querySelector('.thumb-retry')?.setAttribute('hidden','');}catch{node.onload=null;node.onerror=null;node.dataset.loaded='';frame?.classList.remove('loaded');frame?.classList.add('load-failed');frame?.querySelector('.thumb-retry')?.removeAttribute('hidden');}}
function observeThumbs(root=document){thumbnailObserver?.disconnect();const nodes=[...root.querySelectorAll('img[data-thumb-image]')];if(!nodes.length)return;if('IntersectionObserver'in window){thumbnailObserver=new IntersectionObserver(entries=>entries.filter(entry=>entry.isIntersecting).forEach(entry=>{thumbnailObserver.unobserve(entry.target);loadThumb(entry.target);}),{rootMargin:'240px'});nodes.forEach(node=>thumbnailObserver.observe(node));}else nodes.slice(0,4).forEach(loadThumb);}
const adapters = {
  csv: async file => ({ records: normalizeRows(parseCSV(await file.text()), file.webkitRelativePath||file.name,{allowIncomplete:true}), images: [] }),
  xlsx: async file => ({ records: normalizeRows(await parseXLSX(await file.arrayBuffer()), file.webkitRelativePath||file.name,{allowIncomplete:true}), images: [] }),
  pdf: async file => parsePDFDocument(await file.arrayBuffer(), file.name),
  // Extension point for a future Google Drive transport; downloaded files reuse these adapters.
};
async function syncDatabase(){try{await database.replace(store.all(),evidenceStore.all());}catch(error){console.warn('IndexedDB sync failed',error);}}
async function selectCacheScope(userId){
  if(cacheUser===userId)return scopeReady;
  cacheUser=userId;const version=++scopeVersion;$('#dateFilter').value='';
  store.setScope(projectId,userId);evidenceStore.setScope(projectId,userId);database=new ProjectDatabase();database.setScope(projectId,userId);
  records=[];progressRecords=[];shipmentRecords=[];crosswalkMappings=[];pendingImport=null;
  demoMode=false;visionController?.abort();$('#visionConsent').checked=false;
  for(const dialog of ['#imageDialog','#sourceDialog','#importDialog'])if($(dialog).open)$(dialog).close();
  $('#reportForm').reset();populateFilters();render();renderHistory();renderImages();
  scopeReady=(async()=>{const snapshot=await database.load();if(version!==scopeVersion)return;
    store.mergeRemote(snapshot.records);const ids=new Set(snapshot.images.map(i=>i.imageId));evidenceStore.setCache([...snapshot.images,...evidenceStore.all().filter(i=>!ids.has(i.imageId))]);records=store.all();
    progressRecords=snapshot.progress||[];shipmentRecords=snapshot.shipments||[];crosswalkMappings=snapshot.mappings||[];
    populateFilters();render();renderHistory();renderImages();
  })().catch(()=>{if(version===scopeVersion){records=store.all();populateFilters();render();renderHistory();renderImages();}});
  return scopeReady;
}
function updateCloudStatus(session){
  if(cloud?.userId!==(session?.user?.id||'')){memberRole='';isAdmin=false;}refreshPermissions();
  if(cloud){const userId=session?.user?.id||'';if(cloud.userId!==userId)cloud=new SupabaseCloudRepository(cloud.config,{auth,userId});cloud.token=session?.access_token||'';}
  if(cloud?.configured)selectCacheScope(session?.user?.id||'signed-out');
  $('#cloudStatus').textContent=!cloud?.configured?'本机模式 · 未配置云数据库':session?'已自动登录 · 云端连接':'云端已配置 · 点击登录';
  $('#signOutButton').hidden=!session;$('#setPasswordButton').hidden=!session;refreshVisionStatus();
}
async function backfillMissingReportDates(snapshot,repo){
  const beforeImages=new Map(snapshot.images.map(image=>[image.imageId,image.relatedDate||''])),beforeRecords=new Map(snapshot.records.map(record=>[record.id,record.date||'']));backfillStoredReportDates(snapshot.records,snapshot.images);if(canEdit())for(const sourceFile of [...new Set(snapshot.images.filter(image=>!image.relatedDate).map(image=>image.sourceFile).filter(Boolean))]){const sourceRecords=snapshot.records.filter(record=>(record.sourceFile||record.source)===sourceFile),sourceImages=snapshot.images.filter(image=>image.sourceFile===sourceFile),path=sourceRecords.find(record=>record.originalObjectPath)?.originalObjectPath||sourceImages.find(image=>image.originalObjectPath)?.originalObjectPath;if(!path)continue;try{const dateResult=await extractReportDateWithPDFJS(await repo.downloadOriginal(path),sourceFile);associateReportDate(snapshot.records,snapshot.images,dateResult,{sourceFile,method:'original-pdf-full-text'});}catch(error){console.warn(`日报日期回填失败：${sourceFile}`,error);}}
  const changedRecords=snapshot.records.filter(record=>(beforeRecords.get(record.id)||'')!==(record.date||'')),changedImages=snapshot.images.filter(image=>(beforeImages.get(image.imageId)||'')!==(image.relatedDate||''));if(canEdit()&&(changedRecords.length||changedImages.length))await repo.saveDateBackfill(changedRecords,changedImages);snapshot.dateBackfill={filledImages:changedImages.length,filledRecords:changedRecords.length,unresolvedImages:snapshot.images.filter(image=>!image.relatedDate).length,recordIds:changedRecords.map(record=>record.id)};
}
async function hydrateCloud(){
  if(!cloud?.token)return;
  const version=scopeVersion,repo=cloud;await scopeReady;const membership=await repo.request(`/rest/v1/project_members?project_id=eq.${encodeURIComponent(projectId)}&select=role,is_admin`);const members=await membership.json();if(version!==scopeVersion)return;memberRole=members[0]?.role||"";isAdmin=members[0]?.is_admin===true;refreshPermissions();if(!memberRole){records=[];progressRecords=[];shipmentRecords=[];crosswalkMappings=[];evidenceStore.setCache([]);store.cache=[];populateFilters();render();renderHistory();renderImages();throw new Error("邮箱尚未获得项目授权");}const snapshot=await repo.loadProject();if(version!==scopeVersion)return;await backfillMissingReportDates(snapshot,repo);if(snapshot.dateBackfill?.recordIds?.length){const changed=new Map(snapshot.records.filter(record=>snapshot.dateBackfill.recordIds.includes(record.id)).map(record=>[record.id,record]));store.write(store.all().map(record=>changed.has(record.id)?{...record,...changed.get(record.id)}:record));}store.mergeRemote(snapshot.records);evidenceStore.mergeRemote(snapshot.images);records=store.all();const missing=new Set(snapshot.unavailableTables||[]);if(!missing.has('progress_measurements'))progressRecords=snapshot.progress||[];if(!missing.has('equipment_shipments'))shipmentRecords=snapshot.shipments||[];if(!missing.has('crosswalk_mappings'))crosswalkMappings=snapshot.mappings||[];await Promise.all([database.replaceProjectData('progress',progressRecords),database.replaceProjectData('shipments',shipmentRecords),database.replaceProjectData('mappings',crosswalkMappings)]);
  await hydrateImages();await syncDatabase();populateFilters();render();renderHistory();renderImages();
}
async function hydrateImages(){for(const image of evidenceStore.all()){image.signedUrl='';image.loadError='';}imagePage=1;imagePreviewGeneration++;}
$('#cloudStatus').onclick=async()=>{
  if(!cloud?.configured)return toast('部署环境尚未配置 Supabase',true);
  if(cloud.token){try{await hydrateCloud();toast('云端数据已读取');}catch(error){toast(error.message,true);}return;}
  $('#loginError').textContent='';$('#verifyLoginError').textContent='';$('#passwordLoginError').textContent='';clearLoginSecrets();$('#loginDialog').showModal();
};
$('#loginForm').onsubmit=async event=>{event.preventDefault();const button=$('#sendLogin');button.disabled=true;try{await cloud.requestMagicLink($('#loginEmail').value,location.origin+location.pathname);$('#verifyLoginEmail').value=$('#loginEmail').value;$('#loginError').textContent='邮件已发送。请在需要登录的同一浏览器打开链接，或复制尚未打开的链接，在下方验证。其他浏览器的登录不会同步到这里。';}catch{$('#loginError').textContent='登录邮件未能发送；可能达到邮件限额，请稍后重试。';}finally{button.disabled=false;}};
function clearLoginSecrets(){$('#loginLink').value='';$('#loginPassword').value='';}
function cancelLogin(){loginController?.abort();clearLoginSecrets();}
async function submitLogin(event,kind){
  event.preventDefault();if(loginController)return;
  const controller=new AbortController();loginController=controller;
  const isPassword=kind==='password',errorNode=$(isPassword?'#passwordLoginError':'#verifyLoginError');
  const secret=$(isPassword?'#loginPassword':'#loginLink').value,email=$(isPassword?'#passwordEmail':'#verifyLoginEmail').value;
  clearLoginSecrets();for(const id of ['#passwordLogin','#verifyLogin','#sendLogin'])$(id).disabled=true;errorNode.textContent='正在登录';
  try{
    if(!auth)throw new Error('登录服务暂不可用，请刷新重试。');
    if(isPassword)await auth.signInWithPassword(email,secret,{signal:controller.signal});
    else await auth.verifyEmailLink(secret,email,{signal:controller.signal});
    if(controller.signal.aborted)return;
    errorNode.textContent='';$('#loginDialog').close();
    try{await hydrateCloud();toast('已登录，云端数据已读取');}catch{toast('已登录，云端数据读取失败，请点击云端状态重试',true);}
  }catch(error){if(!controller.signal.aborted)errorNode.textContent=error.message;}
  finally{loginController=null;for(const id of ['#passwordLogin','#verifyLogin','#sendLogin'])$(id).disabled=false;}
}
$('#passwordLoginForm').onsubmit=event=>submitLogin(event,'password');
$('#verifyLoginForm').onsubmit=event=>submitLogin(event,'email');
$('#cancelLogin').onclick=()=>{cancelLogin();$('#loginDialog').close();};
$('#loginDialog').addEventListener('cancel',cancelLogin);
$('#loginDialog').addEventListener('close',clearLoginSecrets);
function clearNewPasswords(){$('#newLoginPassword').value='';$('#confirmLoginPassword').value='';}
$('#setPasswordButton').onclick=()=>{clearNewPasswords();$('#passwordSetupError').textContent='';$('#passwordSetupDialog').showModal();};
$('#cancelPasswordSetup').onclick=()=>{clearNewPasswords();$('#passwordSetupDialog').close();};
$('#passwordSetupDialog').addEventListener('cancel',event=>{if($('#saveLoginPassword').disabled)event.preventDefault();else clearNewPasswords();});
$('#passwordSetupDialog').addEventListener('close',clearNewPasswords);
$('#passwordSetupForm').onsubmit=async event=>{
  event.preventDefault();const password=$('#newLoginPassword').value,confirmation=$('#confirmLoginPassword').value;clearNewPasswords();
  if(password!==confirmation){$('#passwordSetupError').textContent='两次密码不一致，请重新输入。';return;}
  const button=$('#saveLoginPassword');button.disabled=true;$('#cancelPasswordSetup').disabled=true;
  try{await auth.setPassword(password);$('#passwordSetupDialog').close();toast('密码已设置，以后可用邮箱和密码登录');}
  catch(error){$('#passwordSetupError').textContent=error.message;}
  finally{button.disabled=false;$('#cancelPasswordSetup').disabled=false;}
};
$('#signOutButton').onclick=async()=>{try{await auth.signOut();for(const image of evidenceStore.all())delete image.signedUrl;renderImages();toast('已退出登录；缓存已隔离并保留');}catch(error){toast(error.message,true);}};


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
function signedNumber(value){return value==null?'未报告':`${value>=0?'+':''}${Number(value.toFixed(3))}`;}
function renderComparison(){
  const dates=[...new Set(records.map(r=>r.date).filter(Boolean))].sort(),before=$('#compareBefore'),after=$('#compareAfter');
  const oldBefore=before.value,oldAfter=after.value,options=dates.map(d=>`<option>${escapeHTML(d)}</option>`).join('');
  before.innerHTML=after.innerHTML=options;after.value=dates.includes(oldAfter)?oldAfter:dates.at(-1)||'';before.value=dates.includes(oldBefore)?oldBefore:dates.filter(d=>d<after.value).at(-1)||'';
  const comparison=compareReports(records,{beforeDate:before.value,afterDate:after.value,images:evidenceStore.all()});
  $('#compareWarnings').textContent=comparison.warnings.join(' ');
  const photoColumn=(photos,date)=>`<section class="comparison-photo-column"><b>${escapeHTML(date)}</b><div>${photos.map(image=>`<button type="button" class="comparison-photo" data-image="${escapeHTML(image.imageId)}"><span class="thumb"><img data-thumb-image="${escapeHTML(image.imageId)}" alt="${escapeHTML(image.caption||`${date} 现场照片`)}" loading="lazy" decoding="async"></span><small>${escapeHTML(image.relatedProcess||'未标注工序')}</small></button>`).join('')||'<p class="comparison-photo-empty">该车间当日无照片</p>'}</div></section>`;
  $('#comparisonRows').innerHTML=comparison.rows.map(row=>`<details class="comparison-card"><summary><span><b>${escapeHTML(row.workshop||'未报告')}</b><small>${escapeHTML(row.statusChange)} · 照片 ${row.photoCount} 张</small></span><em class="tag">${escapeHTML(row.classification)}</em></summary><div class="comparison-detail"><div class="comparison-change"><b>变化摘要</b><span>中方 ${signedNumber(row.changes.chineseStaff)}</span><span>属地 ${signedNumber(row.changes.localStaff)}</span><span>当日工程量 ${signedNumber(row.changes.dailyQuantity)} ${escapeHTML(row.unit||'')}</span><span>累计工程量 ${signedNumber(row.changes.cumulativeQuantity)} ${escapeHTML(row.unit||'')}</span></div><section class="comparison-side before"><h3><span>前期</span>${escapeHTML(comparison.beforeDate)}</h3><dl><dt>工序</dt><dd>${escapeHTML(row.processes.before.join('；')||'未报告')}</dd><dt>施工内容（PDF 原文）</dt><dd>${escapeHTML(row.before.constructionContent||'未报告')}</dd><dt>设备状态</dt><dd>${escapeHTML(row.before.equipmentStatus||'未报告')}</dd><dt>问题</dt><dd>${escapeHTML(row.before.risk||'未报告')}</dd></dl>${photoColumn(row.photos.before,comparison.beforeDate)}</section><section class="comparison-side after"><h3><span>后期</span>${escapeHTML(comparison.afterDate)}</h3><dl><dt>工序</dt><dd>${escapeHTML(row.processes.after.join('；')||'未报告')}</dd><dt>施工内容（PDF 原文）</dt><dd>${escapeHTML(row.after.constructionContent||'未报告')}</dd><dt>设备状态</dt><dd>${escapeHTML(row.after.equipmentStatus||'未报告')}</dd><dt>问题</dt><dd>${escapeHTML(row.after.risk||'未报告')}</dd></dl>${photoColumn(row.photos.after,comparison.afterDate)}</section>${row.notes.length?`<p class="comparison-alert"><b>事实差异 / 信息不足：</b>${escapeHTML(row.notes.join('；'))}</p>`:''}<details><summary>查看两份日报来源和原文</summary>${row.evidence.map(e=>`<blockquote><b>${escapeHTML(e.date)} · ${escapeHTML(e.sourceFile)}${e.pageNumber?' · 第 '+e.pageNumber+' 页':''}</b><p>${escapeHTML(e.excerpt)}</p></blockquote>`).join('')}</details></div></details>`).join('')||'<div class="empty-state compact"><h2>暂无可对比数据</h2><p>请选择两个不同的日报日期。</p></div>';
  $$('.comparison-card').forEach(card=>card.addEventListener('toggle',()=>{if(card.open&&!card.dataset.photosLoaded){card.dataset.photosLoaded='true';observeThumbs(card);}}));$$('.comparison-photo').forEach(button=>button.onclick=event=>{event.stopPropagation();openImage(button.dataset.image);});
}
$('#compareBefore').onchange=renderComparison;$('#compareAfter').onchange=renderComparison;
function pct(value) { return value == null ? '—' : `${value.toFixed(1)}%`; }
function delta(value) { return value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`; }
function statusClass(value = '') { return /停工|滞后|受阻|未到货|待清关|延误/.test(value) ? 'danger' : /进行|准备|运输|已发运/.test(value) ? 'warning' : 'good'; }
function warningMeta(status = '') {
  if (/确认停工/.test(status)) return { label: '确认', level: 'danger' };
  if (/高度疑似停工/.test(status)) return { label: '高', level: 'danger' };
  if (/疑似停滞/.test(status)) return { label: '中', level: 'warning' };
  if (/等待施工|未开展施工|数据不足/.test(status)) return { label: '数据不足', level: 'warning' };
  return { label: '正常', level: 'good' };
}
function imagesFor(record,images=evidenceStore.all()) { const key=businessKey(record); return images.filter(image=>!image.ignored&&(image.relatedRecordId===record.id||image.relatedRecordKey===key||(!image.relatedRecordId&&image.association?.status!=='unassociated'&&businessKey({date:image.relatedDate,workshop:image.relatedWorkshop,process:image.relatedProcess})===key))); }

function render() {
  renderProjectData();
  const filtered = filterRecords(records, { date: $('#dateFilter').value, workshop: $('#workshopFilter').value, process: $('#processFilter').value });
  $('#recordCount').textContent = `${filtered.length} 条原始记录`;
  $('#emptyState').hidden = records.length > 0 || progressRecords.length > 0; $('#dashboard').hidden = records.length === 0 && progressRecords.length === 0; $('#demoBanner').hidden = !demoMode;
  $('#dataStatus').textContent = demoMode ? '示例数据 · 非项目实绩' : records.length ? `${records.length} 条记录已载入` : '尚未导入数据';
  renderComparison();
  if (!records.length && !progressRecords.length) return;
  const a = analyzeRecords(filtered, period),allImages=evidenceStore.all(),activeImages=allImages.filter(image=>!image.ignored);
  const evidenceScope={date:$('#dateFilter').value,workshop:$('#workshopFilter').value,process:$('#processFilter').value},latestReportDate=[...new Set(records.map(r=>r.date).filter(Boolean))].sort().at(-1)||'',latestPhotos=[...new Map(activeImages.filter(image=>!image.decorative&&!image.logoConfirmed&&image.relatedDate===latestReportDate).map(image=>[`${standardWorkshop(image.relatedWorkshop)}|${image.contentSignature||image.visualFingerprint||image.pixelHash||image.imageId}`,image])).values()],photo=summarizeImageEvidence(latestPhotos),stoppageEvidence=analyzeWorkshopStoppageEvidence(records,activeImages,evidenceScope);
  const photoFailures=latestPhotos.filter(image=>image.analysisError||image.loadError||image.analysisStatus==='failed').length,photoWorkshops=[...new Set(latestPhotos.map(image=>standardWorkshop(image.relatedWorkshop)||'未关联车间'))].map(name=>[name,latestPhotos.filter(item=>(standardWorkshop(item.relatedWorkshop)||'未关联车间')===name).length]);
  const projectProgress=summarizeProgress(progressRecords,{asOf:progressCutoff()}),hasProjectProgress=projectProgress.selected.length>0;
  $('#plannedKpi').textContent = pct(hasProjectProgress?projectProgress.planned:null); $('#actualKpi').textContent = pct(hasProjectProgress?projectProgress.actual:null);
  $('#plannedNote').textContent = hasProjectProgress?`${projectProgress.selected[0]?.planVersion||'WBS'} · 月末口径 · 截至 ${projectProgress.cutoff}${projectProgress.actual==null?' · 数据缺失/过期待复核':''}`:a.latestDate?`截至 ${a.latestDate}`:'等待数据';
  const projectVariance=hasProjectProgress?projectProgress.variance:null;$('#varianceNote').textContent = projectVariance == null ? '缺少计划或实际值' : `计划偏差 ${delta(projectVariance)}${hasProjectProgress?' · 来源：进度/WBS':''}`;
  $('#concreteKpi').textContent = hasProjectProgress?`${pct(projectProgress.plannedMonthly)} / ${pct(projectProgress.actualMonthly)}`:a.quantityGroups.length === 0 ? '—' : a.quantityGroups.length === 1 ? `${a.quantityGroups[0].daily?.toFixed(2) ?? '—'} / ${Number.isFinite(a.quantityGroups[0].cumulative)?a.quantityGroups[0].cumulative.toFixed(2):'—'}` : `${a.quantityGroups.length} 组`;
  $('#concreteNote').textContent = hasProjectProgress?'本期计划 / 实际完成率 · WBS 基准口径':a.quantityGroups.length === 1 ? `${a.quantityGroups[0].workshop} · ${a.quantityGroups[0].unit}` : a.quantityGroups.length > 1 ? '按车间、工序和单位分别统计' : '暂无工程量数据';
  $('#peopleKpi').textContent = a.kpis.totalStaff ?? '—'; $('#peopleNote').textContent = `中方 ${a.kpis.chineseStaff ?? '—'} · 属地 ${a.kpis.localStaff ?? '—'} · 较上期 ${a.kpis.staffDelta == null ? '—' : (a.kpis.staffDelta >= 0 ? '+' : '') + a.kpis.staffDelta}${a.kpis.staffNeedsReview?' · ⚠ PDF 原文合计不一致':''}`;
  $('#stoppageKpi').textContent = stoppageEvidence.filter(item=>/疑似停滞|高度疑似停工|确认停工/.test(item.current.status)).length;
  $('#photoKpi').textContent = `${photo.analyzed}/${photo.total}`;$('#photoNote').textContent=`${latestReportDate||'暂无日报'} · 已识别 / 当日有效照片 · 历史照片在图片证据查询`;
  $('#photoEvidenceSummary').innerHTML=latestReportDate?`<div class="photo-summary"><b>${escapeHTML(latestReportDate)}</b><span>总数 ${photo.total}</span><span>已识别 ${photo.analyzed}</span><span>失败 ${photoFailures}</span></div><div class="scene-summary">${photoWorkshops.map(([workshop,count])=>`<span class="tag">${escapeHTML(workshop)} ${count}</span>`).join('')||'<span>最新日报暂无关联照片</span>'}</div>`:'<div class="mini-empty">尚无日报日期</div>';
  renderLatestPhotoGallery($('#photoEvidenceSummary'),latestPhotos,{token:cloud?.token||'',openImage});
  const curve=hasProjectProgress?projectProgress.timeline.map(p=>({date:p.month,planned:p.planned,actual:p.actual,plannedMonthly:p.plannedMonthly,actualMonthly:p.actualMonthly})):a.timeline;$('#trendChart').innerHTML = renderProgressChart(curve); $('#chartCaption').textContent = hasProjectProgress?`累计左轴 · 月度右轴（独立线性刻度）· ${curve.length} 个月${projectProgress.issues?.includes('cumulative-over-100')?' · 累计超过 100% 来自原始计划，坐标轴已按原值扩展':''}`:`${period === 'day' ? '每日' : period === 'week' ? '每周' : '每月'}聚合 · 日报临时数据`;
  $('#workforceChart').innerHTML = renderWorkforceChart(a.workforce);
  const selectedDate=$('#dateFilter').value,selectedWorkshop=$('#workshopFilter').value,selectedProcess=$('#processFilter').value;
  const workshopScopeRecords=records.filter(r=>(!selectedDate||r.date<=selectedDate)&&(!selectedWorkshop||standardWorkshop(r.workshop)===standardWorkshop(selectedWorkshop))&&(!selectedProcess||r.process===selectedProcess));
  const latestStates=latestWorkshopStates(workshopScopeRecords),stoppageByWorkshop=new Map(stoppageEvidence.map(item=>[item.workshop,item]));
  $('#workshopRows').innerHTML=latestStates.length?latestStates.map(w=>{
    const item=stoppageByWorkshop.get(w.workshop),current=item?.current||{status:'数据不足',days:0,reasons:[],photoIds:[]},warning=warningMeta(current.status),status=w.statuses.join(' / ')||'未标注';
    const stagnationDays=/疑似停滞|高度疑似停工|确认停工/.test(current.status)?current.days:0;
    const evidencePhotoIds=new Set(current.photoIds||[]),photos=activeImages.filter(image=>standardWorkshop(image.relatedWorkshop)===w.workshop&&((!image.relatedDate||image.relatedDate===w.date)||evidencePhotoIds.has(image.imageId)));
    const linkedPhotos=[...new Map(photos.map(image=>[image.imageId,image])).values()],history=item?.history||[];
    return `<details class="workshop-status-row" data-workshop="${escapeHTML(w.workshop)}" ${warning.level==='danger'?'open':''}><summary><span class="workshop-cell workshop-name" data-label="车间"><b>${escapeHTML(w.workshop)}</b></span><span class="workshop-cell" data-label="最新日期">${escapeHTML(w.date||'日期缺失')}</span><span class="workshop-cell workshop-activity" data-label="施工内容">${escapeHTML(w.activities.join('；')||'—')}</span><span class="workshop-cell" data-label="工序">${escapeHTML(w.processes.join('；')||'未填写')}</span><span class="workshop-cell" data-label="状态"><em class="tag ${statusClass(status)}">${escapeHTML(status)}</em></span><span class="workshop-cell" data-label="连续停滞">${stagnationDays} 个日报日</span><span class="workshop-cell" data-label="预警等级"><em class="tag ${warning.level}">${escapeHTML(warning.label)} · ${escapeHTML(current.status)}</em></span><span class="workshop-cell" data-label="关联照片">${linkedPhotos.length?`📷 ${linkedPhotos.length}`:'—'}</span></summary><div class="workshop-detail"><div class="evidence-reasons">${(current.reasons||[]).map(reason=>`<span>${escapeHTML(reason)}</span>`).join('')||'<span>暂无异常证据</span>'}</div>${current.recoveredFrom?`<p class="evidence-process">已恢复施工；历史 ${escapeHTML(current.recoveredFrom.status)} ${escapeHTML(current.recoveredFrom.startDate)} 至 ${escapeHTML(current.recoveredFrom.endDate)}</p>`:''}${history.length?`<div class="evidence-chain"><b>连续停滞证据链</b>${history.map(segment=>`<span>${escapeHTML(segment.status)} · ${escapeHTML(segment.startDate)} 至 ${escapeHTML(segment.endDate)} · ${segment.days} 个有效日报日${segment.reasons?.length?` · ${escapeHTML(segment.reasons.join('；'))}`:''}</span>`).join('')}</div>`:''}${linkedPhotos.slice(0,6).map(image=>`<button class="row-action evidence-jump" data-image="${escapeHTML(image.imageId)}">📷 查看 ${escapeHTML(image.relatedDate||w.date||'日期缺失')} 照片</button>`).join('')}</div></details>`;
  }).join(''):'<div class="mini-empty">筛选范围内无车间数据</div>';
  $$('.evidence-jump').forEach(button=>button.onclick=()=>openImage(button.dataset.image));
}

function renderProjectData(){
  const summary=summarizeProgress(progressRecords,{asOf:progressCutoff()}),current=currentProgressRows(progressRecords),wbsCount=new Set(current.map(row=>row.wbs)).size,batchCount=new Set(progressRecords.filter(row=>row.importBatchId).map(row=>row.importBatchId)).size,meta=current.find(row=>row.workbookMeta)?.workbookMeta;
  $('#progressCount').textContent=current.some(row=>row.sourceType==='progress-workbook')?`${wbsCount} 个 WBS · ${batchCount} 个快照`:`${current.length} 条`;$('#shipmentCount').textContent=`${shipmentRecords.length} 条`;$('#mappingCount').textContent=`${crosswalkMappings.length} 条`;
  const temporaryBaselines=[...new Map(current.filter(row=>row.managementBaselineTotal!=null).map(row=>[row.managementBaselineLabel,`${row.managementBaselineLabel} ${row.managementBaselineTotal} ${row.unit}`])).values()];
  $('#progressVersionSummary').innerHTML=current.length?`<b>${escapeHTML(current[0]?.planVersion||'自定义版本')}</b><span>当前计划：${pct(summary.planned)}　当前实际：${pct(summary.actual)}　偏差：${delta(summary.variance)}</span><small>${meta?`Sheet：${escapeHTML(meta.batch.currentPlanSheet)} / ${escapeHTML(meta.batch.actualSheet)} · Hash ${escapeHTML(meta.batch.fileHash.slice(0,12))}… · 导入 ${escapeHTML(current[0]?.importedAt||meta.batch.importedAt)} · ${escapeHTML(meta.batch.qualityStatus)}`:'标准化 WBS 数据'}</small>${temporaryBaselines.length?`<small>来源文件含临时管理基准：${temporaryBaselines.map(escapeHTML).join('；')}；图表统一按最新 WBS 原计划总量加权，避免临时分母导致累计超过 100%（不修改 Excel 原始数量及历史版本）。</small>`:''}${summary.versionDiff?`<small>版本比较：${escapeHTML(summary.versionDiff.previous.fileHash?.slice(0,12)||'无 Hash')}…（${escapeHTML(summary.versionDiff.previous.importedAt||'无导入时间')}）→ ${escapeHTML(summary.versionDiff.current.fileHash?.slice(0,12)||'无 Hash')}…（${escapeHTML(summary.versionDiff.current.importedAt||'无导入时间')}）；WBS 新增 ${summary.versionDiff.wbsAdded.length} / 移除 ${summary.versionDiff.wbsRemoved.length}；实际 ${delta(summary.versionDiff.actualChange)}；总量调整 ${summary.versionDiff.quantityAdjusted.length} 项，权重调整 ${summary.versionDiff.weightAdjusted.length} 项，计划调整 ${summary.versionDiff.planAdjusted.length} 项。</small>`:meta?.planComparison?.from?`<small>文件内 ${escapeHTML(meta.planComparison.from)} → ${escapeHTML(meta.planComparison.to)}：总量调整 ${meta.planComparison.quantityAdjusted.length} 项，权重调整 ${meta.planComparison.weightAdjusted.length} 项，计划调整 ${meta.planComparison.scheduleAdjusted.length} 项。</small>`:'<small>首个导入快照，暂无上次上传版本可比较。</small>'}`:'<span>尚未导入工程量/WBS 数据</span>';
  $('#disciplineProgress').innerHTML=summary.disciplines.map(item=>`<article><b>${escapeHTML(item.name)}</b><span>专业完成率 ${pct(item.actualCompletion)}</span><small>Contribution to Project ${pct(item.contributionToProject)} · 计划 ${pct(item.plannedCompletion)}</small></article>`).join('')||'<p class="mini-empty">暂无专业进度</p>';
  $('#laggingWbsRows').innerHTML=summary.lagging.map(row=>`<tr><td><b>${escapeHTML(row.wbs)} ${escapeHTML(row.item)}</b><small>${escapeHTML(row.discipline||'未分类')}</small></td><td>${pct(row.plannedCumulativePct)}</td><td>${pct(row.actualCumulativePct)}</td><td class="negative">${delta(row.variance)}</td><td>${pct(row.contributionToProject)}</td></tr>`).join('')||'<tr><td colspan="5" class="mini-empty">暂无可比 WBS</td></tr>';
  const issueValue=value=>value==null?'—':Number.isFinite(value)?Number(value.toFixed(4)):String(value),issueLine=item=>`${escapeHTML(item.wbs||'未指定 WBS')} ${escapeHTML(item.item||'')}：${escapeHTML(item.reason||'数量差异')}；差异 ${escapeHTML(issueValue(item.difference))} ${escapeHTML(item.unit||'')}；Excel 计划 ${escapeHTML(issueValue(item.excelPlanTotal??item.baselineTotal))} / 实际跟踪 ${escapeHTML(issueValue(item.trackingTotal))} / WBS 分期汇总 ${escapeHTML(issueValue(item.wbsPlannedTotal))} / 临时基准 ${escapeHTML(issueValue(item.managementBaselineTotal))} ${escapeHTML(item.unit||'')}；<b>待复核</b>`;
  $('#progressQuality').innerHTML=summary.qualityIssues.length?`<details open><summary><b>待复核差异 ${summary.qualityIssues.length} 项</b></summary><ul>${summary.qualityIssues.map(item=>`<li>${issueLine(item)}</li>`).join('')}</ul></details>`:current.length?'Excel 计划、实际跟踪、WBS 汇总及管理基准未发现差异。':'';
  const findings=crossAnalyze({reports:records,progress:progressRecords,shipments:shipmentRecords,mappings:crosswalkMappings,projectId,asOf:progressCutoff()});
  $('#crossAnalysis').innerHTML=findings.length?`<h3>交叉判断</h3>${findings.map(f=>`<article class="cross-finding"><span class="evidence-label">AI 推断 · ${escapeHTML(f.severity)}</span><h3>${escapeHTML(f.title)}</h3><p><b>原始事实：</b>${f.facts.map(escapeHTML).join('；')}</p><p><b>系统计算：</b>${escapeHTML(f.basis)}</p><p><b>待人工确认：</b>${escapeHTML(f.confirmation)}</p></article>`).join('')}`:'<p class="mini-empty">当前没有满足交叉预警规则的组合；原始事实、系统计算、AI 推断与待确认项会分开展示。</p>';
}

async function rowsFromFile(file){const ext=file.name.split('.').pop().toLowerCase();if(ext==='csv')return parseCSV(await file.text());if(ext==='xlsx')return parseXLSX(await file.arrayBuffer());throw new Error('仅支持 CSV / XLSX');}
async function importProjectData(type,file){
  if(!canEdit())return toast('需 Editor 权限',true);
  if(!file)return;const normalizers={progress:normalizeProgressRows,shipments:normalizeShipmentRows,mappings:normalizeCrosswalkRows},current={progress:progressRecords,shipments:shipmentRecords,mappings:crosswalkMappings};
  try{if(cloud?.configured&&!cloud.token)throw new Error('请先登录，再导入需要保存到云端的项目数据');await scopeReady;const version=scopeVersion,repo=cloud;
    if(type==='progress'&&/\.xlsx$/i.test(file.name)){
      let parsed;try{const buffer=await file.arrayBuffer();parsed=await parseKhayratProgressWorkbook(buffer,file.name,projectId);}catch(error){if(!/未识别到/.test(error.message))throw error;parsed=null;}
      if(parsed){if(repo?.configured){const saved=await repo.saveProgressWorkbook(file,parsed);if(saved.duplicate){toast('该工程量文件 Hash 已存在，未重复累计；当前版本保持不变');return;}}else{if(progressRecords.some(row=>row.fileHash===parsed.batch.fileHash)){toast('该工程量文件 Hash 已存在，未重复累计；当前版本保持不变');return;}const auditId=crypto.randomUUID();await database.saveOriginals([file],parsed.batch.id);await database.addImport({importId:auditId,createdAt:parsed.batch.importedAt,files:[file.name],type:'progress-workbook',fileHash:parsed.batch.fileHash,progressBatchId:parsed.batch.id,status:'complete'});}if(version!==scopeVersion)throw new Error('登录身份已改变，请重新导入');const retained=progressRecords.map(row=>row.sourceType==='progress-workbook'?{...row,batchCurrentVersion:row.importBatchId===parsed.batch.id,batchImportStatus:row.batchImportStatus||'complete'}:row),activated=parsed.records.map(row=>({...row,batchCurrentVersion:true,batchImportStatus:'complete'})),merged=[...new Map([...retained,...activated].map(row=>[row.id,row])).values()];await database.replaceProjectData('progress',merged);progressRecords=merged;render();toast(`已切换到最新工程量版本：${parsed.batch.currentPlanVersion} · ${new Set(parsed.currentRecords.map(row=>row.wbs)).size} 个 WBS；历史版本已保留`);return;}
    }
    const rows=normalizers[type](await rowsFromFile(file),file.name,projectId);if(version!==scopeVersion)throw new Error('登录身份已改变，请重新导入');if(!rows.length)throw new Error('没有识别到有效数据，请核对列名');const merged=[...new Map([...current[type],...rows].map(row=>[row.id,row])).values()];if(repo?.configured)await repo.saveProjectData(type,rows,{sourceFile:file.name});if(version!==scopeVersion)throw new Error('登录身份已改变，请重新导入');await database.replaceProjectData(type,merged);if(type==='progress')progressRecords=merged;else if(type==='shipments')shipmentRecords=merged;else crosswalkMappings=merged;render();toast(`已导入 ${rows.length} 条${type==='progress'?'进度/WBS':type==='shipments'?'设备物流':'映射'}数据`);}catch(error){toast(error.message,true);}finally{$(`#${type==='progress'?'progress':type==='shipments'?'shipment':'mapping'}Input`).value='';}
}
$('#progressImportButton').onclick=()=>$('#progressInput').click();$('#shipmentImportButton').onclick=()=>$('#shipmentInput').click();$('#mappingImportButton').onclick=()=>$('#mappingInput').click();
function handleProjectFile(type,event){const file=event.target.files[0];event.target.value='';return importProjectData(type,file);}
$('#progressInput').onchange=e=>handleProjectFile('progress',e);$('#shipmentInput').onchange=e=>handleProjectFile('shipments',e);$('#mappingInput').onchange=e=>handleProjectFile('mappings',e);
$$('[data-template]').forEach(button=>button.onclick=()=>{const headers={progress:PROGRESS_HEADERS,shipments:SHIPMENT_HEADERS,mappings:CROSSWALK_HEADERS}[button.dataset.template],a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+headers.join(',')+'\n'],{type:'text/csv;charset=utf-8'}));a.download=`khayrat-${button.dataset.template}-template.csv`;a.click();URL.revokeObjectURL(a.href);});

async function importFiles(files) {
  if(!canEdit())return toast("需 Editor 权限",true);
  files=[...files].filter(file=>/\.(csv|xlsx|pdf)$/i.test(file.name));const messages = [], imported = [], extractedImages=[];
  const hasPDF=files.some(file=>/\.pdf$/i.test(file.name));if(hasPDF&&cloud?.configured&&!cloud.token){toast(!cloud?.configured?'PDF 云端导入需要先配置 Supabase':'请先点击页头云端状态并完成登录，再导入 PDF',true);return;}
  for (const file of files) {
    try { const ext = file.name.split('.').pop().toLowerCase(),sourceName=file.webkitRelativePath||file.name; if (!adapters[ext]) throw new Error('暂不支持此文件类型'); const allowOCR=$('#ocrConsent').checked&&Boolean(cloud?.config.ocrEnabled),adapter=ext==='pdf'?async()=>parsePDFDocument(await file.arrayBuffer(),sourceName,{allowOCR,ocrProvider:allowOCR?new OCRProvider({endpoint:'/api/ocr',consent:true,accessToken:cloud?.token||''}):null}):adapters[ext],result = await adapter(file); for(const r of result.records){r.projectId=projectId;if(projectId!=='khayrat'&&r.id)r.id=`${projectId}:${r.id}`;}for(const i of result.images){i.projectId=projectId;if(projectId!=='khayrat'){i.imageId=`${projectId}:${i.imageId}`;if(i.relatedRecordId)i.relatedRecordId=`${projectId}:${i.relatedRecordId}`;}}imported.push(...result.records); extractedImages.push(...result.images); messages.push(`${sourceName}: ${result.records.length} 条记录，${result.images.length} 张有效图片${result.diagnostics?.decorativeImages?`，已排除 ${result.diagnostics.decorativeImages} 张页眉/页脚装饰图`:''}${result.diagnostics?.warnings?.length?'，'+result.diagnostics.warnings.join(''):''}`); }
    catch (error) { messages.push(`${file.name}: 导入失败（${error.message}）`); }
  }
  const existingRecords=new Map(store.all().map(record=>[businessKey(record),record])),seen=new Set(),preview=imported.map(record=>{const key=businessKey(record),duplicate=existingRecords.has(key)||seen.has(key);seen.add(key);record.id=record.id||crypto.randomUUID();return {record,duplicate};});
  const newRecords=preview.filter(x=>!x.duplicate).map(x=>x.record);
  const importId=crypto.randomUUID();
  for(const record of newRecords)record.originalFileId=`${importId}/${record.sourceFile||record.source}`;
  const existingImages=new Set(evidenceStore.all().map(i=>i.imageId)),newImages=extractedImages.filter(i=>!existingImages.has(i.imageId));
  const uploadedAt=new Date().toISOString();for(const image of newImages){image.uploadedAt=image.uploadedAt||uploadedAt;const related=newRecords.find(r=>businessKey(r)===image.relatedRecordKey)||existingRecords.get(image.relatedRecordKey);if(related)image.relatedRecordId=related.id;}
  pendingImport={scopeVersion,importId,fileObjects:[...files],files:[...files].map(f=>f.webkitRelativePath||f.name),records:newRecords,images:newImages,messages,hasPDF,cloudSave:Boolean(cloud?.configured&&cloud.token),autoAnalyze:Boolean($('#analyzeAfterImport').checked&&cloud?.config.visionEnabled&&cloud?.token),hasErrors:messages.some(x=>x.includes('导入失败'))};
  $('#importSummary').textContent=`解析 ${imported.length} 条记录、${extractedImages.length} 张有效施工图片；${preview.filter(x=>x.duplicate).length} 条重复将跳过；${messages.filter(x=>x.includes('导入失败')).length} 个文件失败。${pendingImport.autoAnalyze?' 上传后将自动分析图片。':''}`;
  $('#importMessages').textContent=messages.join('\n');
  $('#confirmImport').disabled=pendingImport.hasErrors||(!imported.length&&!extractedImages.length);
  $('#importPreviewRows').innerHTML=preview.slice(0,100).map(({record,duplicate})=>`<tr><td>${escapeHTML(record.sourceFile||record.source)}${record.pageNumber?` · 第 ${record.pageNumber} 页`:''}<details><summary>PDF 原文</summary><p>${escapeHTML(record.sourceExcerpt||record.rawRecord||'')}</p><small>${record.needsReview?'原文字段异常：'+escapeHTML(record.reviewFields.join(', ')):'已识别明确字段；展示仍以原文为准'}</small></details></td><td>${record.date||'<span class="negative">未识别</span>'}</td><td>${escapeHTML(record.workshop||'未识别')} / ${escapeHTML(record.process||'未识别')}</td><td>${escapeHTML(record.status||'—')}</td><td><span class="tag ${duplicate?'warning':'good'}">${duplicate?'重复跳过':'新增'}</span></td></tr>`).join('')||'<tr><td colspan="5" class="mini-empty">没有可导入的结构化记录</td></tr>';$('#uploadProgress').hidden=true;$('#confirmImport').textContent='确认上传并导入';$('#importDialog').showModal();
}
$('#cancelImport').onclick=()=>{pendingImport=null;$('#fileInput').value='';$('#folderInput').value='';$('#importDialog').close();toast('已取消，原有数据未修改');};
$('#confirmImport').onclick=async()=>{if(!canEdit())return toast('需 Editor 权限',true);if(!pendingImport)return;if(pendingImport.scopeVersion!==scopeVersion)return toast('登录身份已改变，请重新导入',true);const batch=pendingImport,uploadCloud=cloud,uploadDatabase=database,importId=batch.importId,pdfs=batch.fileObjects,analyzeQueue=batch.autoAnalyze?[...batch.images].slice(0,33):[];if(!batch.records.length&&!batch.images.length){pendingImport=null;$('#fileInput').value='';$('#folderInput').value='';$('#importDialog').close();toast('该日报已导入：记录与图片未重复保存');return;}if(batch.cloudSave&&!cloud?.token)return toast('云端身份已失效，请重新登录后重试',true);const button=$('#confirmImport'),progress=$('#uploadProgress'),bar=$('#uploadProgressBar'),label=$('#uploadProgressText'),total=Math.max(1,pdfs.length+batch.images.length);let completed=0;const update=item=>{completed++;progress.hidden=false;bar.style.width=`${Math.min(100,completed/total*100)}%`;label.textContent=item.error?`${item.name} 上传失败：${item.error}`:`正在上传 ${completed}/${total}：${item.name}`;};button.disabled=true;$('#cancelImport').disabled=true;try{let uploadPaths=[];if(batch.cloudSave){const originals=await uploadCloud.uploadOriginals(pdfs,importId,update),pictures=await uploadCloud.uploadEvidenceImages(batch.images,importId,update),failures=[...originals.failures,...pictures.failures];uploadPaths=[...originals.paths,...pictures.paths];if(failures.length)throw new Error(`${failures.length} 个文件上传失败，可点击重试；已成功部分不会重复统计`);for(let index=0;index<pdfs.length;index++){const name=pdfs[index].webkitRelativePath||pdfs[index].name;for(const record of batch.records)if((record.sourceFile||record.source)===name)record.originalObjectPath=originals.paths[index];for(const image of batch.images)if(image.sourceFile===name)image.originalObjectPath=originals.paths[index];}
await uploadCloud.saveBatch(batch.records,batch.images,{importId,files:batch.files,uploadPaths});for(const image of batch.images)delete image.dataUrl;}else{await uploadDatabase.saveOriginals(batch.fileObjects,importId);for(const image of batch.images)image.localPreview=true;}if(batch.scopeVersion!==scopeVersion)throw new Error('登录身份已改变，请重新导入');const result=store.merge(batch.records),imageResult=evidenceStore.merge(batch.images);records=result.records;await syncDatabase();await uploadDatabase.addImport({importId,createdAt:new Date().toISOString(),files:batch.files,added:result.added,skipped:result.skipped,images:imageResult.added,uploadPaths,status:'complete',errors:[]}).catch(()=>{});demoMode=false;$('#importLog').textContent=[...batch.messages,`新增 ${result.added} 条，重复跳过 ${result.skipped} 条，新增图片 ${imageResult.added} 张${batch.cloudSave?'；云端保存完成':'；仅本机保存'}`].join('；');pendingImport=null;$('#fileInput').value='';$('#folderInput').value='';$('#importDialog').close();populateFilters();render();renderHistory();renderImages();toast(`导入完成：${result.added} 条日报，${imageResult.added} 张有效图片`);if(analyzeQueue.length){$('#visionConsent').checked=true;analyzePhotos(analyzeQueue);}}catch(error){await uploadDatabase.addImport({importId,createdAt:new Date().toISOString(),files:batch.files,status:'failed',error:error.message}).catch(()=>{});progress.hidden=false;label.textContent=`上传未完成：${error.message}`;button.textContent='重试失败上传';toast(error.message,true);}finally{button.disabled=false;$('#cancelImport').disabled=false;}};

$$('.import-trigger').forEach(b => b.onclick = () => $('#fileInput').click()); $('#importTop').onclick = () => { location.hash = 'import'; $('#fileInput').click(); };
$('#fileInput').onchange = event => importFiles([...event.target.files]);
$('#folderImportButton').onclick=()=>$('#folderInput').click();$('#folderInput').onchange=event=>importFiles([...event.target.files].filter(file=>/\.pdf$/i.test(file.name)));
$$('.period-switch button').forEach(b => b.onclick = () => { $$('.period-switch button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); period=b.dataset.period; render(); });
['dateFilter','progressAsOf','workshopFilter','processFilter'].forEach(id => $(`#${id}`).onchange = render);
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
  const groups=new Map();for(const row of rows){const date=row.date||'日期缺失';if(!groups.has(date))groups.set(date,[]);groups.get(date).push(row);}
  const recordRow=(r,date)=>{const photos=imagesFor(r);return `<tr class="history-record" data-history-date="${escapeHTML(date)}" hidden><td></td><td><b>${escapeHTML(r.workshop)}</b><small>${escapeHTML(r.process)} ${r.activityId?`· ${escapeHTML(r.activityId)}`:''} ${r.sourceType==='pdf'?`· PDF 第 ${r.pageNumber} 页`:''}</small></td><td>中 ${r.chineseStaff??'—'} / 属 ${r.localStaff??'—'}</td><td>${r.dailyConcrete??'—'} ${escapeHTML(r.workUnit||'')}</td><td><span class="tag ${statusClass(r.status)}">${escapeHTML(r.status||'未标注')}</span></td><td>${escapeHTML(r.equipmentStatus||'—')} ${photos.length?`<button class="row-action" data-image="${photos[0].imageId}">📷 ${photos.length}</button>`:''}</td><td><button class="row-action" data-source="${escapeHTML(r.id)}">来源</button><button class="row-action" data-edit="${r.id}">编辑</button><button class="row-action danger-text" data-delete="${r.id}">删除</button></td></tr>`;};
  $('#localCount').textContent=`${store.all().length} 条`; $('#historyRows').innerHTML=rows.length?[...groups].map(([date,items])=>`<tr class="history-date-row"><th colspan="7"><button type="button" data-history-toggle="${escapeHTML(date)}" aria-expanded="false"><span>${escapeHTML(date)}</span><small>${items.length} 条记录</small><i>展开</i></button></th></tr>${items.map(item=>recordRow(item,date)).join('')}`).join(''):'<tr><td colspan="7" class="mini-empty">没有符合条件的本地日报</td></tr>';
  $$('[data-history-toggle]').forEach(button=>button.onclick=()=>{const expanded=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!expanded));button.querySelector('i').textContent=expanded?'展开':'收起';$$('[data-history-date]').filter(row=>row.dataset.historyDate===button.dataset.historyToggle).forEach(row=>row.hidden=expanded);});
  $$('[data-source]').forEach(button=>button.onclick=()=>openSource(button.dataset.source)); $$('[data-edit]').forEach(button=>button.onclick=()=>editRecord(button.dataset.edit)); $$('[data-delete]').forEach(button=>button.onclick=()=>deleteRecord(button.dataset.delete)); $$('[data-image]').forEach(button=>button.onclick=()=>openImage(button.dataset.image));
}
function openSource(id){const record=store.all().find(r=>r.id===id);if(!record)return;const evidence=evidenceOf(record);$('#sourceDetails').textContent=`${evidence.sourceFile} · ${evidence.pageNumber?'第 '+evidence.pageNumber+' 页':'第 '+(evidence.sourceRow||'?')+' 行'}\n提取方式：${record.extractionMethod||'结构化输入'}\n${record.needsReview?'原文字段异常：'+record.reviewFields.join(', '):'PDF 原文为展示依据'}\n\n${evidence.excerpt}\n\n${JSON.stringify({personnelStatistics:record.personnelStatistics,activities:record.activities,quantities:record.quantities,sourceLocation:record.sourceLocation,dateSource:record.dateSource},null,2)}`;$('#downloadOriginal').hidden=!record.originalObjectPath&&!record.originalFileId;$('#downloadOriginal').onclick=async()=>{try{let url;if(record.originalObjectPath)url=await cloud.signedUrl(record.originalObjectPath);else{const original=await database.original(record.originalFileId);if(!original?.blob)throw new Error('原始文件不可用，请从来源重新导入');url=URL.createObjectURL(original.blob);}const a=document.createElement('a');a.href=url;a.download=evidence.sourceFile.split('/').at(-1);a.target='_blank';a.rel='noopener';a.click();if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,true);}};$('#sourceDialog').showModal();}
$('#closeSource').onclick=()=>$('#sourceDialog').close();
function editRecord(id) { if(!canEdit())return; const record=store.all().find(r=>r.id===id); if(!record)return; for(const [key,value] of Object.entries(record))if($('#reportForm').elements[key])$('#reportForm').elements[key].value=value??''; $('#formTitle').textContent=`编辑日报 · ${record.date}`; $('#cancelEdit').hidden=false; $('#duplicateWarning').hidden=true; location.hash='entry'; $('#reportForm').scrollIntoView({behavior:'smooth'}); }
function deleteRecord(id) { if(!canEdit())return; const record=store.all().find(r=>r.id===id); if(!record||!confirm(`确定删除 ${record.date} ${record.workshop} / ${record.process} 的日报吗？`))return; store.remove(id); records=store.all(); syncDatabase(); populateFilters(); render(); renderHistory(); toast('日报已删除'); }
$('#reportForm').onsubmit=async event=>{event.preventDefault();if(!canEdit())return toast('需 Editor 权限',true);const record=formRecord();$$('[data-error]').forEach(x=>x.textContent='');const result=store.save(record);if(!result.ok){if(result.duplicate){$('#duplicateWarning').innerHTML=`<b>发现重复记录</b>：${escapeHTML(result.duplicate.date)} 已存在相同活动。请编辑原记录或填写不同活动编号。`;$('#duplicateWarning').hidden=false;}else Object.entries(result.errors).forEach(([key,value])=>{const node=$(`[data-error="${key}"]`);if(node)node.textContent=value;});return;}records=store.all();demoMode=false;await syncDatabase();populateFilters();render();renderHistory();resetForm();if(cloud?.token){try{await cloud.saveBatch([result.record],[],{importId:crypto.randomUUID(),files:[result.record.sourceFile||result.record.source],uploadPaths:[]});toast('日报已保存到本机和云端');}catch(error){toast(`本机已保存，云端保存失败：${error.message}`,true);}}else toast('日报已保存到当前浏览器 IndexedDB');};
$('#clearReportForm').onclick=resetForm; $('#cancelEdit').onclick=resetForm;
['historyKeyword','historyStart','historyEnd'].forEach(id=>$(`#${id}`).oninput=renderHistory); $('#historyReset').onclick=()=>{$('#historyKeyword').value='';$('#historyStart').value='';$('#historyEnd').value='';renderHistory();};
$('#backupButton').onclick=()=>{const backup=JSON.parse(store.backup());backup.images=evidenceStore.all().map(({dataUrl,signedUrl,...metadata})=>metadata);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));a.download=`khayrat-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast(`本地数据备份已下载（含 ${backup.images.length} 张图片证据）`);};
$('#restoreButton').onclick=()=>$('#restoreInput').click(); $('#restoreInput').onchange=async event=>{if(!canEdit())return toast('需 Editor 权限',true);try{const text=await event.target.files[0].text(),data=JSON.parse(text),result=store.restore(text),imageResult=evidenceStore.merge(Array.isArray(data.images)?data.images:[]);records=store.all();await syncDatabase();demoMode=false;populateFilters();render();renderHistory();renderImages();toast(`恢复完成：新增 ${result.added} 条日报、${imageResult.added} 张图片，重复 ${result.skipped}，无效 ${result.invalid}`);}catch(error){toast(error.message,true);}};
function downloadXLSX(){const a=document.createElement('a');a.href=URL.createObjectURL(createTemplateXLSX());a.download='Khayrat工程日报标准模板.xlsx';a.click();URL.revokeObjectURL(a.href);toast('Excel 模板已生成');} $('#excelTemplateButton').onclick=downloadXLSX;
function renderImages({resetPage=false}={}) {
  const stored=evidenceStore.all(),all=stored.filter(image=>!image.decorative&&!image.logoConfirmed),date=$('#imageDate').value,workshop=$('#imageWorkshop').value,process=$('#imageProcess').value,source=$('#imageSource').value.toLowerCase(),critical=$('#criticalOnly').checked;
  const options=(values,label)=>`<option value="">${label}</option>`+[...new Set(values.filter(Boolean))].sort().map(v=>`<option>${escapeHTML(v)}</option>`).join('');const oldW=workshop,oldP=process;$('#imageWorkshop').innerHTML=options(all.map(i=>i.relatedWorkshop),'全部车间');$('#imageProcess').innerHTML=options(all.map(i=>i.relatedProcess),'全部工序');$('#imageWorkshop').value=oldW;$('#imageProcess').value=oldP;
  const filtered=sortImageEvidence(all.filter(i=>(!date||i.relatedDate===date)&&(!workshop||i.relatedWorkshop===workshop)&&(!process||i.relatedProcess===process)&&(!source||i.sourceFile.toLowerCase().includes(source))&&(!critical||i.critical)));$('#imageStorageCount').textContent=`${all.length} 张`;
  if(resetPage)imagePage=1;const pageCount=Math.max(1,Math.ceil(filtered.length/IMAGE_PAGE_SIZE));imagePage=Math.min(imagePage,pageCount);const pageItems=filtered.slice((imagePage-1)*IMAGE_PAGE_SIZE,imagePage*IMAGE_PAGE_SIZE);imagePreviewGeneration++;
  $('#imagePagination').hidden=filtered.length<=IMAGE_PAGE_SIZE;$('#imagePageStatus').textContent=`第 ${imagePage} / ${pageCount} 页 · 共 ${filtered.length} 张`;$('#imagePrev').disabled=imagePage<=1;$('#imageNext').disabled=imagePage>=pageCount;
  $('#imageGallery').innerHTML=pageItems.length?pageItems.map(image=>{const record=store.all().find(r=>r.id===image.relatedRecordId)||store.all().find(r=>businessKey(r)===image.relatedRecordKey),conflicts=record?findEvidenceConflicts(record,[image]):[],review=evidenceReviewState(image);return `<article class="image-card ${image.ignored?'ignored':''} ${image.relatedDate?'':'missing-date'}" data-open-image="${image.imageId}"><div class="thumb"><img ${image.dataUrl?`src="${image.dataUrl}" data-loaded="true"`:''} data-thumb-image="${escapeHTML(image.imageId)}" alt="${escapeHTML(image.caption||'PDF现场图片')}" loading="lazy" decoding="async"><span>缩略图加载中</span><button type="button" class="thumb-retry" data-retry-thumb="${escapeHTML(image.imageId)}" hidden>加载失败 · 重试</button>${image.critical?'<b>关键证据</b>':''}</div><div><div class="image-card-meta"><span class="evidence-label">${image.relatedDate?escapeHTML(image.relatedDate):'日期缺失 · 待关联'}</span><span class="review-state ${review.tone}">${escapeHTML(review.label)}</span></div><h3>${escapeHTML(image.visionEnabled||image.manualReviewed?image.scene||'无法判断':'待视觉识别')}</h3><p>${escapeHTML(image.relatedWorkshop||'未关联车间')} · ${escapeHTML(image.relatedProcess||'未关联工序')}</p><small>${escapeHTML(image.sourceFile)} · 第 ${image.pageNumber} 页 · 图 ${image.imageIndex}${imageUploadTime(image)?` · 上传 ${escapeHTML(imageUploadTime(image))}`:''}</small><div class="tag-row">${(image.tags||[]).map(t=>`<em>${escapeHTML(t)}</em>`).join('')}</div>${conflicts.length?`<strong class="conflict">${escapeHTML(conflicts[0].label||'待人工核验')}：${escapeHTML(conflicts[0].reason)}</strong>`:''}</div></article>`;}).join(''):'<div class="empty-state compact"><h2>暂无图片证据</h2><p>导入包含 JPEG/JPX 嵌入图片的 PDF 日报后，图片会显示在这里。</p></div>';
  $$('[data-open-image]').forEach(card=>card.onclick=()=>openImage(card.dataset.openImage));
  $$('[data-retry-thumb]').forEach(button=>button.onclick=event=>{event.stopPropagation();const node=button.closest('.thumb').querySelector('img');node.dataset.loaded='';loadThumb(node);});
  if(!$('#imagesView').hidden)observeThumbs($('#imageGallery'));
}
function refreshVisionStatus(){
  const config=cloud?.config;
  $('#visionStatus').textContent=config?.visionEnabled?`${config.visionProvider||'OpenAI'} 视觉服务已配置；勾选授权后可分析。${config.visionCostNotice||''}${config.visionMinIntervalMs?' 每张间隔约一分钟，可停止后续分析。':''}`:'视觉服务尚未启用：等待负责人确认外部图片传输和服务费用。';
  $('#visionConsentText').textContent=config?.visionEnabled?`授权将所选照片及对应原文发送至 ${config.visionProvider||'OpenAI'}（${config.visionModel||'gpt-4.1-mini'}）。${config.visionPrivacyNotice||''} ${config.visionChain?.length>1?'可能按顺序发送至：'+config.visionChain.map(p=>p.name+' / '+p.model).join(' → ')+'。Google 免费层可能用于产品改进及人工审阅；仅限非敏感、非保密资料。':''} 仅使用确认的免费额度，不会自动使用付费服务。`:'视觉服务未配置；请先确认接收平台和数据处理规则。';
  $('#analyzeImages').disabled=visionBusy||!cloud?.config.visionEnabled||!cloud?.token||!canEdit();
  $('#visionConsent').disabled=visionBusy||!config?.visionEnabled||!canEdit();
  $('#stopVision').disabled=!visionBusy;
  $('#ocrConsent').disabled=!cloud?.config.ocrEnabled;$('#analyzeAfterImport').disabled=visionBusy||!config?.visionEnabled||!cloud?.token||!canEdit();$('#analyzeAfterImportText').textContent=config?.visionEnabled?(cloud?.token?`上传后自动分析有效施工图片（${config.visionProvider||'视觉模型'}）`:'登录后可启用上传即分析'):'视觉分析未配置，图片仍会提取并保存';
}
async function openImage(imageId){
  const image=evidenceStore.all().find(i=>i.imageId===imageId);if(!image)return;
  const review=evidenceReviewState(image),record=store.all().find(r=>r.id===image.relatedRecordId)||store.all().find(r=>businessKey(r)===image.relatedRecordKey);
  $('#imageFull').removeAttribute('src');$('#imageFull').alt='高清原图加载中';$('#retryImage').hidden=true;
  $('#directEvidence').textContent=`PDF 原始嵌入图片；${image.sourceFile}，第 ${image.pageNumber} 页，图 ${image.imageIndex}。关联：${image.association?.status||'未关联'}`;
  $('#imageTextFacts').textContent=image.sourceExcerpt||image.nearbyText||'未关联，不能用整页文字代替';
  $('#imageVisibleFacts').textContent=(image.visibleFacts||[]).join('；')||'未进行像素分析';
  $('#imageCrossValidation').textContent=image.crossValidation?`${image.crossValidation.status}：${image.crossValidation.reason}`:'尚未交叉验证';
  $('#imageCalibrationStatus').className=`review-state ${review.tone}`;$('#imageCalibrationStatus').textContent=review.label;
  $('#inferenceSummary').textContent=[image.aiSummary,...image.inferences||[],...image.limitations||[]].filter(Boolean).join('；')+`（模型置信度 ${Math.round((image.confidence||0)*100)}%，仅作原文补充）`;
  $('#imageProvenance').textContent=JSON.stringify({bbox:image.bbox,components:image.components,association:image.association,activities:image.relatedActivities,model:image.model,usage:image.usage,analyzedAt:image.analyzedAt,initialAnalysis:image.initialAnalysis||image.originalAnalysis,latestAutomaticAnalysis:image.automaticAnalysis,manualReview:image.manualReview,calibration:image.calibration,calibrationHistory:image.calibrationHistory},null,2);
  $('#analyzeImage').disabled=visionBusy||!cloud?.config.visionEnabled||!cloud?.token||!image.objectPath;
  const form=$('#imageForm');for(const key of ['imageId','relatedDate','relatedWorkshop','relatedProcess','scene','evidenceType','caption'])form.elements[key].value=image[key]||'';
  form.elements.tags.value=(image.tags||[]).join(', ');form.elements.reviewedVisibleFacts.value=(image.visibleFacts||[]).join('\n');form.elements.reviewedInferences.value=(image.inferences||[]).join('\n');form.elements.critical.checked=!!image.critical;form.elements.ignored.checked=!!image.ignored;form.elements.publicApproved.checked=!!image.publicApproved;form.elements.logoConfirmed.checked=!!image.logoConfirmed;
  form.elements.calibrationDecision.value=image.calibration?.decision||'';form.elements.calibrationNote.value=image.calibration?.note||'';
  form.elements.relatedRecordId.innerHTML='<option value="">未关联（请选择明确的日报记录）</option>'+store.all().filter(r=>r.recordType!=='personnel-summary').map(r=>`<option value="${r.id}">${escapeHTML(r.date)} · ${escapeHTML(r.workshop)} / ${escapeHTML(r.process)}</option>`).join('');
  form.elements.relatedRecordId.value=image.relatedRecordId||'';
  $('#imageOrigin').textContent=`来源：${image.sourceFile} · PDF 第 ${image.pageNumber} 页 · 图 ${image.imageIndex}`;
  $('#viewImageSource').disabled=!record;$('#viewImageSource').onclick=()=>record&&openSource(record.id);
  if(!$('#imageDialog').open)$('#imageDialog').showModal();
  const loadFull=async()=>{try{$('#retryImage').hidden=true;await setImageSource($('#imageFull'),await evidenceUrl(image,'full'));$('#imageFull').alt=image.caption||'PDF现场原图';}catch{$('#imageFull').onload=null;$('#imageFull').onerror=null;$('#imageFull').alt='高清原图加载失败';$('#retryImage').hidden=false;}};$('#retryImage').onclick=loadFull;await loadFull();
}
async function persistEvidence(changed){
  assertEditor();
  const version=scopeVersion,repo=cloud;
  if(cloud?.configured){if(!cloud.token)throw new Error('请先登录再保存云端图片复核');if(!changed.objectPath)throw new Error('图片尚未上传，先完成导入');await repo.saveEvidence([changed]);if(version!==scopeVersion)throw new Error('登录身份已改变，请重新操作');}
  evidenceStore.update(changed.imageId,changed);await syncDatabase();renderImages();render();renderHistory();
}
$('#imageForm').elements.relatedRecordId.onchange=event=>{const r=store.all().find(r=>r.id===event.target.value);if(r)for(const key of ['relatedDate','relatedWorkshop','relatedProcess'])$('#imageForm').elements[key].value=r[{relatedDate:'date',relatedWorkshop:'workshop',relatedProcess:'process'}[key]]||'';};
$('#imageForm').onsubmit=async event=>{
  event.preventDefault();if(!canEdit())return toast('需 Editor 权限',true);if(visionBusy)return toast('分析进行中，请完成后再保存复核',true);const form=event.currentTarget,button=form.querySelector('[type=submit]'),old=evidenceStore.all().find(i=>i.imageId===form.elements.imageId.value),record=store.all().find(r=>r.id===form.elements.relatedRecordId.value);
  const reviewerId=cloud?.configured?(await auth?.current())?.user?.id||'unverified':'local-reviewer',at=new Date().toISOString(),decision=form.elements.calibrationDecision.value,note=form.elements.calibrationNote.value.trim();
  if(!decision||!note)return toast('请选择校准结论并填写依据',true);if(decision==='calibrated'&&!record)return toast('“已校准”需要先关联明确的日报原文',true);
  const manualReview={reviewerId,at,scene:form.elements.scene.value,caption:form.elements.caption.value,relatedRecordId:record?.id||'',confirmed:true},calibration={decision,note,operatorId:reviewerId,at,verificationStatus:['calibrated','acceptable'].includes(decision)?'passed':'open',source:{sourceFile:old.sourceFile,pageNumber:old.pageNumber,imageIndex:old.imageIndex,reportId:record?.id||'',excerpt:record?.sourceExcerpt||old.sourceExcerpt||''}};
  const changed={...old,cloudSyncPending:false,initialAnalysis:old.initialAnalysis||old.originalAnalysis||old.automaticAnalysis||{visibleFacts:old.visibleFacts,inferences:old.inferences,confidence:old.confidence,scene:old.scene,crossValidation:old.crossValidation,provider:old.provider,model:old.model,analyzedAt:old.analyzedAt},originalAnalysis:old.originalAnalysis||{visibleFacts:old.visibleFacts,inferences:old.inferences,confidence:old.confidence,scene:old.scene},visibleFacts:form.elements.reviewedVisibleFacts.value.split('\n').map(x=>x.trim()).filter(Boolean),inferences:form.elements.reviewedInferences.value.split('\n').map(x=>x.trim()).filter(Boolean),originalAssociation:old.originalAssociation||old.association,association:{status:record?'manually-linked':'unassociated',method:'manual',needsReview:!record},relatedDate:record?.date||form.elements.relatedDate.value,relatedWorkshop:record?.workshop||form.elements.relatedWorkshop.value,relatedProcess:form.elements.relatedProcess.value||record?.process||'',relatedRecordId:record?.id||'',relatedRecordKey:record?businessKey(record):'',sourceExcerpt:record?.sourceExcerpt||old.sourceExcerpt||'',nearbyText:record?.sourceExcerpt||old.nearbyText||'',scene:manualReview.scene,tags:form.elements.tags.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),evidenceType:form.elements.evidenceType.value,caption:manualReview.caption,critical:form.elements.critical.checked,ignored:form.elements.ignored.checked,publicApproved:form.elements.publicApproved.checked&&!form.elements.ignored.checked&&!form.elements.logoConfirmed.checked,logoConfirmed:form.elements.logoConfirmed.checked,manualReviewed:true,reviewRecommended:['confirmed-conflict','unresolved'].includes(decision),manualReview,reviewHistory:[...old.reviewHistory||[],old.manualReview].filter(Boolean),calibration,calibrationHistory:[...old.calibrationHistory||[],old.calibration].filter(Boolean)};
  if(old.relatedRecordId!==changed.relatedRecordId){changed.previousCrossValidation=old.crossValidation;changed.crossValidation=null;}
  button.disabled=true;try{await persistEvidence(changed);$('#imageDialog').close();toast(`${evidenceReviewState(changed).label}；重新核验结果已保存`);}catch(error){toast(error.message,true);}finally{button.disabled=false;}
};
async function analyzePhotos(images,{force=false}={}){
  if(!canEdit())return toast("Reader 不允许发起 AI 分析",true);
  images=images.filter(i=>!i.logoConfirmed&&!i.decorative&&!i.ignored&&(force||!i.visionEnabled));
  if(visionBusy)return toast('图片分析进行中，请稍后',true);
  if(!$('#visionConsent').checked)return toast('请先勾选照片和对应原文的外部传输授权',true);
  if(!cloud?.config.visionEnabled||!cloud?.token)return toast('视觉服务尚未获得负责人批准或需要登录',true);
  if(!images.length)return toast('没有待分析且已保存云端的图片');
  visionBusy=true;visionController=new AbortController();refreshVisionStatus();$('#analyzeImage').disabled=true;
  let completed=0;try{const session=await auth.current(),provider=new ImageAnalysisProvider({endpoint:'/api/vision',consent:true,provider:cloud.config.visionProviderId||'',consentScope:cloud.config.visionConsentScope||'',accessToken:session?.access_token||''});
    for(const image of images){const wait=Math.max(0,(cloud.config.visionMinIntervalMs||0)-(Date.now()-lastVisionCallAt));if(wait)$('#visionStatus').textContent=`已完成 ${completed} / ${images.length} 张；等待免费服务调用间隔，可停止后续分析。`;await waitForVisionSlot(wait,visionController.signal);provider.accessToken=(await auth.current())?.access_token||'';if(visionController.signal.aborted)throw new Error('已停止图片分析');lastVisionCallAt=Date.now();const analysis=await provider.analyze(image),reuseCalibration=Boolean(image.calibration?.decision),changed={...image,...analysis,initialAnalysis:image.initialAnalysis||image.automaticAnalysis||analysis,automaticAnalysis:analysis,analysisHistory:[...image.analysisHistory||[],image.automaticAnalysis].filter(Boolean),manualReview:reuseCalibration?image.manualReview:null,manualReviewed:reuseCalibration?true:analysis.manualReviewed,reviewRecommended:reuseCalibration?['confirmed-conflict','unresolved'].includes(image.calibration.decision):analysis.reviewRecommended,reviewHistory:reuseCalibration?[...image.reviewHistory||[]]:[...image.reviewHistory||[],image.manualReview].filter(Boolean)};try{await persistEvidence(changed);}catch(error){evidenceStore.update(image.imageId,{...changed,cloudSyncPending:true});await syncDatabase();throw new Error('分析结果已保留本机，云端保存失败；可保存补充说明后重试，避免再次调用模型。 '+error.message);}completed++;$('#visionStatus').textContent=`已完成 ${completed} / ${images.length} 张；已复用既有校准结论，结果作为 PDF 原文补充保存。`;}
    if($('#imageDialog').open)openImage($('#imageForm').elements.imageId.value);
  }catch(error){toast(`完成 ${completed} 张；${error.message}`,true);}finally{visionBusy=false;refreshVisionStatus();$('#analyzeImage').disabled=!cloud?.config.visionEnabled||!cloud?.token||!canEdit();}
}
$('#analyzeImages').onclick=()=>analyzePhotos(evidenceStore.all().filter(i=>!i.ignored&&!i.manualReviewed&&!i.visionEnabled&&i.objectPath).slice(0,33));
$('#stopVision').onclick=()=>{visionController?.abort();$('#visionStatus').textContent='已请求停止后续分析；当前请求若已发送，将保存返回结果。';};
$('#analyzeImage').onclick=()=>analyzePhotos([evidenceStore.all().find(i=>i.imageId===$('#imageForm').elements.imageId.value)].filter(Boolean),{force:true});
refreshVisionStatus();
$('#closeImageDialog').onclick=()=>$('#imageDialog').close();['imageDate','imageWorkshop','imageProcess','imageSource','criticalOnly'].forEach(id=>$(`#${id}`).oninput=()=>renderImages({resetPage:true}));$('#imageReset').onclick=()=>{$('#imageDate').value='';$('#imageWorkshop').value='';$('#imageProcess').value='';$('#imageSource').value='';$('#criticalOnly').checked=false;renderImages({resetPage:true});};
$('#imagePrev').onclick=()=>{if(imagePage>1){imagePage--;renderImages();}};$('#imageNext').onclick=()=>{imagePage++;renderImages();};
const pageRoutes={overview:{view:'overviewView'},entry:{view:'entryView'},compare:{view:'compareView'},images:{view:'imagesView'},workshops:{view:'workshopsView'},equipment:{view:'equipmentView'},risks:{view:'risksView'},import:{view:'dataView',target:'import'},projectData:{view:'dataView',target:'projectData'},evidence:{view:'workshopsView',canonical:'workshops'}};
function showPage(hash=location.hash,{updateHash=false}={}){
  const fragment=String(hash||'#overview'),authCallback=new URLSearchParams(fragment.replace(/^#/,'')).has('access_token');
  const key=authCallback?'overview':fragment.replace(/^#/,'')||'overview',matched=pageRoutes[key],route=matched||pageRoutes.overview,canonical=route.canonical||(matched?key:'overview');
  $$('.page-view').forEach(view=>view.hidden=view.id!==route.view);
  $$('[data-view]').forEach(link=>link.classList.toggle('active',link.getAttribute('href')===`#${canonical}`));
  if(route.view==='entryView')renderHistory();
  if(route.view==='imagesView')renderImages();
  if(!authCallback&&updateHash&&location.hash!==`#${canonical}`)history.pushState(null,'',`#${canonical}`);
  else if(!authCallback&&(route.canonical||!pageRoutes[key]))history.replaceState(null,'',`#${canonical}`);
  requestAnimationFrame(()=>{const target=route.target&&document.getElementById(route.target);if(target)target.scrollIntoView({block:'start'});else window.scrollTo({top:0});});
  if($('#sidebar').classList.contains('open'))menu();
}
$$('[data-view]').forEach(link=>link.onclick=event=>{event.preventDefault();showPage(link.getAttribute('href'),{updateHash:true});});
window.addEventListener('hashchange',()=>showPage(location.hash));
resetForm(); populateFilters(); render(); renderHistory(); renderImages();
showPage(location.hash);


async function initializeCloud(){
try{
  const config=await loadCloudConfig();projectId=config.projectId||'khayrat';cloud=new SupabaseCloudRepository(config);updateCloudStatus(null);
  if(cloud.configured){
    auth=await createAuthSession(config);cloud.auth=auth;auth.subscribe(updateCloudStatus);
    try{await auth.initialize();}catch(error){$('#cloudStatus').textContent='登录状态暂时无法验证 · 点击重试';}
    // No automatic legacy-file migration or other cloud writes on startup.
    if(cloud.token)try{await hydrateCloud();}catch(error){$('#cloudStatus').textContent='已登录 · 云端读取失败，点击重试';}
  }else await selectCacheScope('offline');
}catch{$('#cloudStatus').textContent='本机模式 · 云端配置不可用';await selectCacheScope('offline');}
}
await initializeCloud();
document.documentElement.dataset.appReady="true";


async function serverAction(path,body,method='POST'){const token=(await auth?.current())?.access_token;if(!token)throw new Error('请先登录');const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw new Error(value.error||'操作失败');return value;}
$('#publishPublic').onclick=async()=>{if(!canEdit()||!confirm('将公开发布当前车间施工状态、人员统计、WBS 进度及明确批准公开的照片。请确认内容可对外展示。'))return;try{const r=await serverAction('/api/public-publish',{confirmPublication:true});toast(`公开看板已发布：${r.workshops} 个车间，${r.photos} 张照片`);}catch(e){toast(e.message,true);}};
$('#manageMembers').onclick=async()=>{if(!isAdmin)return;$('#memberStatus').textContent='';$('#membersDialog').showModal();try{const r=await serverAction('/api/project-members',null,'GET');$('#memberList').textContent=r.members.map(m=>`${m.email||m.user_id} · ${m.user_id} · ${m.role}${m.is_admin?' · 管理员':''}`).join('\n');}catch(e){$('#memberStatus').textContent=e.message;}};
$('#closeMembers').onclick=()=>$('#membersDialog').close();
$('#memberForm').onsubmit=async e=>{e.preventDefault();if(!isAdmin)return;const f=e.currentTarget;try{const r=await serverAction('/api/project-members',{email:f.elements.email.value,userId:f.elements.userId.value||undefined,role:f.elements.role.value,approved:f.elements.approved.checked});$('#memberStatus').textContent='已保存。新账号先通过登录页发送验证邮件，验证后设置密码。';}catch(e){$('#memberStatus').textContent=e.message;}};
$('#removeConfirmedLogo').onclick=async()=>{if(!canEdit())return;const id=$('#imageForm').elements.imageId.value;if(!confirm('仅删除已保存并人工确认的 Logo 图片及其云端 Evidence 记录；原始 PDF 保留。'))return;try{await serverAction('/api/logo-cleanup',{imageId:id,confirmLogo:true});evidenceStore.setCache(evidenceStore.all().filter(i=>i.imageId!==id));await syncDatabase();$('#imageDialog').close();renderImages();render();toast('确认 Logo 已清理，审计记录已保存');}catch(e){toast(e.message,true);}};


