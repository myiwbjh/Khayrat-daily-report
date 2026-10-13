import {documentDate} from './pdf-layout.js';
import {businessKey} from './storage.js';
import {withProvenance} from './report-model.js';

const sourceOf=item=>String(item?.sourceFile||item?.source||'');

export function associateReportDate(records,images,dateResult,{sourceFile='',method='pdf-full-text'}={}){
  if(!dateResult?.date)return {records,images,filledImages:0,filledRecords:0,unresolvedImages:images.filter(image=>!image.relatedDate).length};
  const date=dateResult.date,sourceRecords=records.filter(record=>!sourceFile||sourceOf(record)===sourceFile),recordById=new Map(sourceRecords.map(record=>[record.id,record]));let filledRecords=0,filledImages=0;
  for(let index=0;index<records.length;index++){
    const record=records[index];if(sourceFile&&sourceOf(record)!==sourceFile)continue;
    const changed=record.date!==date;if(changed)filledRecords++;
    const reviewFields=(record.reviewFields||[]).filter(field=>field!=='date');
    records[index]=withProvenance({...record,...(changed&&record.date?{originalExtractedDate:record.date}:{}),date,dateSource:dateResult.candidates,dateAssociation:{method,reason:dateResult.reason,updatedAt:new Date().toISOString()},reviewFields});
  }
  const refreshedById=new Map(records.filter(record=>!sourceFile||sourceOf(record)===sourceFile).map(record=>[record.id,record]));
  for(const image of images){if(sourceFile&&sourceOf(image)!==sourceFile)continue;const wasMissing=!image.relatedDate;if(wasMissing)filledImages++;const record=refreshedById.get(image.relatedRecordId)||recordById.get(image.relatedRecordId)||records.find(item=>sourceOf(item)===sourceOf(image)&&image.relatedRecordKey&&businessKey(item)===image.relatedRecordKey);image.relatedDate=date;image.relatedRecordKey=record?businessKey(record):image.relatedRecordKey||'';if(record){image.relatedRecordId=record.id;image.relatedWorkshop=image.relatedWorkshop||record.workshop||'';image.relatedProcess=image.relatedProcess||record.process||'';}image.dateAssociation={method,reason:dateResult.reason,sourceCandidates:dateResult.candidates,updatedAt:new Date().toISOString()};}
  return {records,images,filledImages,filledRecords,unresolvedImages:images.filter(image=>(!sourceFile||sourceOf(image)===sourceFile)&&!image.relatedDate).length};
}

export function backfillStoredReportDates(records,images){
  let filledImages=0,filledRecords=0;const sources=new Set([...records,...images].map(sourceOf).filter(Boolean));
  for(const sourceFile of sources){const sourceRecords=records.filter(record=>sourceOf(record)===sourceFile),sourceImages=images.filter(image=>sourceOf(image)===sourceFile);if(!sourceImages.some(image=>!image.relatedDate)&&!sourceRecords.some(record=>!record.date))continue;const knownDates=[...new Set([...sourceRecords.filter(record=>record.date&&!record.reviewFields?.includes('date')).map(record=>record.date),...sourceImages.map(image=>image.relatedDate).filter(Boolean)])];let dateResult;if(knownDates.length===1)dateResult={date:knownDates[0],candidates:[{date:knownDates[0],kind:'stored-report-date'}],reason:'stored-report-date'};else{const layout=sourceRecords.find(record=>record.documentLayout)?.documentLayout||sourceImages.find(image=>image.documentLayout)?.documentLayout;if(layout?.length)dateResult=documentDate(layout,{sourceFile});}if(!dateResult?.date)continue;const result=associateReportDate(records,images,dateResult,{sourceFile,method:dateResult.reason==='stored-report-date'?'stored-report-date':'stored-pdf-full-text'});filledImages+=result.filledImages;filledRecords+=result.filledRecords;}
  return {records,images,filledImages,filledRecords,unresolvedImages:images.filter(image=>!image.relatedDate).length};
}
