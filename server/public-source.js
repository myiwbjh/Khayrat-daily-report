import {rest} from './project-auth.js';
import {publicReportAllowed} from './public-dashboard.js';

import {PHOTO_AUTO_PUBLICATION} from './photo-publication.js';
const PROJECT_ID='khayrat';
const baghdadDate=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);

async function readPayloads(table,{restImpl=rest,query=''}={}){
  const rows=[];
  for(let offset=0;;offset+=500){
    const page=await restImpl(`/rest/v1/${table}?project_id=eq.${PROJECT_ID}${query}&select=${table==='image_evidence'?'payload,created_at,report_id':'payload'}&order=${table==='image_evidence'?'image_id':'id'}&offset=${offset}&limit=500`);
    rows.push(...page.map(row=>table==='image_evidence'?row:row.payload));
    if(page.length<500)return rows;
    if(offset>=20000)throw Error('Public data size limit');
  }
}

// Only a completed, activated workbook batch is authoritative. A measurement's
// current_version flag describes its snapshot role, not whether its import won activation.
export async function readActivePublicProgress({restImpl=rest}={}){
  const batches=await restImpl(`/rest/v1/progress_import_batches?project_id=eq.${PROJECT_ID}&current_version=eq.true&import_status=eq.complete&select=id,metadata,quality_status&order=imported_at.desc&limit=2`);
  if(batches.length>1)throw Error('Ambiguous active progress import batch');
  const id=batches[0]?.id;
  if(!id)return [];
  const rows=await readPayloads('progress_measurements',{restImpl,query:`&import_batch_id=eq.${encodeURIComponent(id)}&current_version=eq.true`}),batch=batches[0];
  return rows.map(row=>row.workbookMeta?{...row,workbookMeta:{...row.workbookMeta,batch:{...row.workbookMeta.batch,qualityStatus:batch.quality_status},reviewDecisions:batch.metadata?.reviewDecisions||row.workbookMeta.reviewDecisions||[]}}:row);
}

function milestones(rows){
  return rows.map(row=>({id:row.id,name:row.name,date:row.milestone_date,datePrecision:row.date_precision,description:row.description,sortOrder:row.sort_order,circleColor:row.circle_color,beforeLineStyle:row.before_line_style,beforeLineColor:row.before_line_color,afterLineStyle:row.after_line_style,afterLineColor:row.after_line_color}));
}

export function latestPublicReportDate(reports,today=baghdadDate(new Date())){
  return reports.filter(publicReportAllowed).map(report=>report.date).filter(date=>date<=today).sort().at(-1)||today;
}

export async function readPublicSource({restImpl=rest}={}){
  const [reports,progress,images,shipments,mappings,milestoneRows]=await Promise.all([
    readPayloads('daily_reports',{restImpl}),
    readActivePublicProgress({restImpl}),
    readPayloads('image_evidence',{restImpl,query:`&or=(and(payload->>publicApproved.eq.true,payload->>manualReviewed.eq.true),and(payload->>relatedDate.gt.${PHOTO_AUTO_PUBLICATION.reportDateAfter},payload->>visionEnabled.eq.true))`}),
    readPayloads('equipment_shipments',{restImpl}),
    readPayloads('crosswalk_mappings',{restImpl}),
    restImpl(`/rest/v1/project_milestones?project_id=eq.${PROJECT_ID}&deleted_at=is.null&select=id,name,milestone_date,date_precision,description,sort_order,circle_color,before_line_style,before_line_color,after_line_style,after_line_color&order=milestone_date.asc,sort_order.asc,name.asc`)
  ]);
  return {reports,progress,images,shipments,mappings,milestones:milestones(milestoneRows)};
}

export async function readLatestPublicReportDate({restImpl=rest}={}){
  for(let offset=0;offset<=20000;offset+=100){
    const rows=await restImpl(`/rest/v1/daily_reports?project_id=eq.${PROJECT_ID}&select=payload&order=report_date.desc&offset=${offset}&limit=100`),reports=rows.map(row=>row.payload),today=baghdadDate(new Date()),match=reports.find(report=>publicReportAllowed(report)&&report.date<=today);
    if(match)return match.date;
    if(rows.length<100)break;
  }
  return '';
}
