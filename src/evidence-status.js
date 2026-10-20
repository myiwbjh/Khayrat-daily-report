import {SCENES} from './image-analysis.js';
// Shared by member browsing and the allowlisted public projection. No model calls.
export function hasValidVisualResult(image={}){
  return [image.automaticAnalysis,image.initialAnalysis,image.originalAnalysis,image].some(result=>result&&result.provider!=='text-only'&&(result.visionEnabled===true||result!==image&&image.visionEnabled===true)&&SCENES.includes(result.scene)&&Array.isArray(result.visibleFacts)&&Array.isArray(result.inferences));
}
export function evidenceStatus(image={}){
  if(image.decorative||image.logoConfirmed||image.ignored)return 'excluded';
  if(image.association?.status==='published'&&['unrecognized','review','recognized'].includes(image.publicEvidenceStatus))return image.publicEvidenceStatus;
  if(!hasValidVisualResult(image))return 'unrecognized';
  const decision=image.calibration?.decision;
  // A confirmed conflict remains a risk, but its human review is complete.
  if(['calibrated','acceptable','confirmed-conflict'].includes(decision))return 'recognized';
  if(decision==='unresolved')return 'review';
  if(image.manualReviewed&&image.manualReview?.confirmed)return 'recognized';
  const association=image.association||{};
  return image.crossValidation?.status==='potential-conflict'||association.needsReview===true||['unassociated','ambiguous','conflict'].includes(association.status)||!image.relatedDate||!image.relatedWorkshop||!(image.relatedRecordId||image.relatedRecordKey)||image.dateAssociation?.needsReview===true||image.reviewFields?.some(field=>['date','workshop','association'].includes(field))?'review':'recognized';
}
export function evidenceStatusCounts(images){
  const counts={all:0,unrecognized:0,review:0,recognized:0,excluded:0,failed:0};
  for(const image of images){if(image.decorative||image.logoConfirmed)continue;counts.all++;const status=evidenceStatus(image);counts[status]++;if(status==='unrecognized'&&image.analysisStatus==='failed')counts.failed++;}
  return counts;
}
export function canRecognizeEvidence(image){return evidenceStatus(image)==='unrecognized'&&Boolean(image.objectPath)&&!['pending','running'].includes(image.analysisStatus);}
