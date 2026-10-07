import {analyzeRecords} from '../src/analytics.js';
import {summarizeProgress} from '../src/project-data.js';
const text=(v,n=1000)=>String(v||'').slice(0,n);
// Allowlisted business fields only; never copy paths, raw documents or authorization data.
const pick=(row,fields)=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,Array.isArray(row[k])?row[k].filter(v=>typeof v==='string').map(v=>text(v)):typeof row[k]==='string'?text(row[k],4000):typeof row[k]==='number'||typeof row[k]==='boolean'||row[k]===null?row[k]:null]));
const reportFields='date workshop process constructionContent status risk activityId recordType staffScope trade chineseStaff localStaff totalStaff dailyConcrete cumulativeConcrete workUnit equipmentName equipmentStatus needsReview reviewFields'.split(' ');
const progressFields='wbs item discipline parentWbs level isLeaf month weight total unit plannedMonthlyQuantity actualMonthlyQuantity plannedMonthlyPct actualMonthlyPct plannedCumulativePct actualCumulativePct baselineTotal trackingTotal quantityMismatch sourceType snapshotRole planVersion importedAt needsReview reviewFields'.split(' ');
const shipmentFields='category equipmentName supplier packageLot shipmentBatch quantity unit weight weightUnit shippingDate pol pod eta arrivalDate customsStatus siteArrivalDate status installationArea needsReview reviewFields'.split(' ');
const mappingFields='sourceType sourceValue targetType targetValue relation note'.split(' ');
export function publicPhotoAllowed(row){const p=row?.payload||row;return p?.publicApproved===true&&p.manualReviewed===true&&!p.ignored&&!p.decorative&&p.logoConfirmed!==true&&['施工中','材料堆放','安装准备','已完成区域','设备到货'].includes(p.scene)&&Boolean(p.relatedRecordId)&&Boolean(p.relatedDate)&&Boolean(p.relatedWorkshop);}
export function publicProjection(reports,progress,images,{asOf=new Date().toISOString().slice(0,10),shipments=[],mappings=[]}={}){
 const a=analyzeRecords(reports.filter(r=>r.date&&r.date<=asOf));const w=summarizeProgress(progress,{asOf});
 const batches=new Map();
 const progressRecords=progress.map((r,i)=>{const batch=r.importBatchId||r.fileHash||r.sourceFile||'default';if(!batches.has(batch))batches.set(batch,`snapshot-${batches.size+1}`);return {...pick(r,progressFields),id:`wbs-${i+1}`,importBatchId:batches.get(batch)};});
 const reportRecords=reports.filter(r=>r.date&&r.date<=asOf).map((r,i)=>({...pick(r,reportFields),id:`report-${i+1}`,...(r.personnelStatistics?{personnelStatistics:pick(r.personnelStatistics,['scope','timeBasis','issues'])}:{})}));
 return {schemaVersion:2,asOf,reports:reportRecords,progressRecords,shipments:shipments.map(r=>pick(r,shipmentFields)),mappings:mappings.map(r=>pick(r,mappingFields)),workshops:a.workshops.map(r=>({workshop:text(r.workshop,120),date:r.date,processes:r.processes.map(x=>text(x,120)),activities:r.activities.map(x=>text(x)),statuses:r.statuses.map(x=>text(x,120))})),workforce:a.workforce.map(({date,chinese,local,total,needsReview})=>({date,chinese,local,total,needsReview})),progress:{planned:w.planned??null,actual:w.actual??null,timeline:(w.timeline||[]).map(({month,planned,actual})=>({month,planned,actual})),qualityStatus:w.qualityIssues?.length?'To Be Verified':'已按当前 WBS 基准计算'},photos:images.filter(publicPhotoAllowed).map(i=>({imageId:i.imageId,date:i.relatedDate,workshop:text(i.relatedWorkshop,120),caption:text(i.caption,300)}))};
}
