import {createHash} from 'node:crypto';
import {rest} from './project-auth.js';
import {reviewImageEvidence} from '../src/evidence-auto-review.js';
import {verifiedPhotoRecordCorrection} from '../src/evidence-association.js';

export async function reviewEvidence({imageIds=[],restImpl=rest,now=new Date(),limit=100}={}){
  const read=async(table,select,filter='')=>{const rows=[];for(let offset=0;;offset+=500){const page=await restImpl(`/rest/v1/${table}?project_id=eq.khayrat&select=${select}&order=${table==='image_evidence'?'image_id':'id'}&offset=${offset}&limit=500${filter}`);rows.push(...page);if(page.length<500)return rows;if(offset>=20000)throw Error('Review data size limit');}};
  const [images,reportRows,mappingRows]=await Promise.all([read('image_evidence','image_id,payload,updated_at',imageIds.length?`&image_id=in.(${imageIds.map(encodeURIComponent).join(',')})`:''),read('daily_reports','payload'),read('crosswalk_mappings','payload')]);
  const context={records:reportRows.map(r=>r.payload),mappings:mappingRows.map(r=>r.payload)},summary={checked:0,updated:0,passed:0,pending:0,unchanged:0,deferred:0,concurrent:0};
  for(const row of images){
    const p=row.payload,correction=verifiedPhotoRecordCorrection(p,context.records,context.mappings);
    const candidate=correction?{...p,relatedRecordId:correction.record.id,relatedRecordKey:correction.key,
      association:{...(p.association||{}),method:'verified-source-paragraph',verifiedRecordId:correction.record.id,needsReview:true},
      automaticReview:undefined}:p;
    const review=reviewImageEvidence(candidate,context);if(!review&&!correction)continue;summary.checked++;
    const visual=candidate.automaticAnalysis||candidate;
    const inputHash=createHash('sha256').update(JSON.stringify({review,visibleFacts:visual.visibleFacts,activities:visual.activities,crossValidation:visual.crossValidation,association:candidate.association,relatedDate:candidate.relatedDate,relatedWorkshop:candidate.relatedWorkshop,relatedRecordId:candidate.relatedRecordId})).digest('hex');
    if(!correction&&p.automaticReview?.inputHash===inputHash){summary.unchanged++;continue;}
    if(summary.updated>=limit){summary.deferred++;continue;}
    if(!row.updated_at){summary.concurrent++;continue;}
    const automaticReview=review?{...review,inputHash,reviewedAt:now.toISOString(),method:'source-text-rules'}:null;
    const payload={...candidate,automaticReview,
      ...(correction?{associationHistory:[...(p.associationHistory||[]),{
        at:now.toISOString(),previousRecordId:correction.previousRecordId,
        verifiedRecordId:correction.record.id,reason:correction.reason,
        sourceFile:p.sourceFile,pageNumber:p.pageNumber
      }]}:{}),
      automaticReviewHistory:[...(p.automaticReviewHistory||[]),...(p.automaticReview?[p.automaticReview]:[])]};
    // Compare-and-swap protects original metadata, new AI results and human
    // calibration saved since this read. An unchanged result performs no write.
    const saved=await restImpl(`/rest/v1/image_evidence?project_id=eq.khayrat&image_id=eq.${encodeURIComponent(row.image_id)}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({payload,updated_at:now.toISOString(),...(correction?{report_id:correction.record.id}:{})})});
    if(!saved?.length){summary.concurrent++;continue;}
    summary.updated++;summary[review?.status==='passed'?'passed':'pending']++;
  }
  return summary;
}
