import {analyzeRecords} from '../src/analytics.js';
import {summarizeProgress} from '../src/project-data.js';
const text=(v,n=1000)=>String(v||'').slice(0,n);
export function publicPhotoAllowed(row){const p=row?.payload||row;return p?.publicApproved===true&&p.manualReviewed===true&&!p.ignored&&!p.decorative&&p.logoConfirmed!==true&&['施工中','材料堆放','安装准备','已完成区域','设备到货'].includes(p.scene)&&Boolean(p.relatedRecordId)&&Boolean(p.relatedDate)&&Boolean(p.relatedWorkshop);}
export function publicProjection(reports,progress,images,{asOf=new Date().toISOString().slice(0,10)}={}){
 const a=analyzeRecords(reports.filter(r=>r.date&&r.date<=asOf));const w=summarizeProgress(progress,{asOf});
 return {schemaVersion:1,asOf,workshops:a.workshops.map(r=>({workshop:text(r.workshop,120),date:r.date,processes:r.processes.map(x=>text(x,120)),activities:r.activities.map(x=>text(x)),statuses:r.statuses.map(x=>text(x,120))})),workforce:a.workforce.map(({date,chinese,local,total,needsReview})=>({date,chinese,local,total,needsReview})),progress:{planned:w.planned??null,actual:w.actual??null,timeline:(w.timeline||[]).map(({month,planned,actual})=>({month,planned,actual})),qualityStatus:w.qualityIssues?.length?'To Be Verified':'已按当前 WBS 基准计算'},photos:images.filter(publicPhotoAllowed).map(i=>({imageId:i.imageId,date:i.relatedDate,workshop:text(i.relatedWorkshop,120),caption:text(i.caption,300)}))};
}
