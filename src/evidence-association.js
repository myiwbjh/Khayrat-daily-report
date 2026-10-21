import {businessKey} from './storage.js';
import {standardWorkshop} from './workshop-status.js';

// Historical comparison evidence is never a current-period photo.
export const isHistoricalWeeklyPhoto = image =>
  image?.sourceType === 'weekly-report' && image.comparisonPeriod === '上周';

const sameDocument = (image,record) =>
  Boolean(image?.sourceFile && record?.sourceFile && image.sourceFile===record.sourceFile) &&
  !(image.originalObjectPath && record.originalObjectPath && image.originalObjectPath!==record.originalObjectPath);
const compact = value => String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();

export function matchesPhotoReport(image,record,mappings=[]){
  if(!image||!record||image.ignored||isHistoricalWeeklyPhoto(image))return false;
  if(!image.relatedDate||image.relatedDate!==record.date||!image.relatedWorkshop||!record.workshop)return false;
  if(standardWorkshop(image.relatedWorkshop,mappings)!==standardWorkshop(record.workshop,mappings))return false;
  if(!sameDocument(image,record))return false;
  return image.relatedRecordId===record.id || Boolean(image.relatedRecordKey&&image.relatedRecordKey===businessKey(record));
}

// Repair a unique, same-document, same-date/page/workshop VERBATIM
// source-paragraph match only. Never infer links from AI or whole-page text,
// nor override manual review/calibration or historical comparison evidence.
export function verifiedPhotoRecordCorrection(image,records=[],mappings=[]){
  if(!image||image.ignored||image.decorative||image.logoConfirmed||
     image.sourceType==='weekly-report'||image.historicalEvidence||
     image.manualReviewed||image.calibration?.decision)return null;
  if(!image.relatedDate||!image.relatedWorkshop||!Number.isInteger(Number(image.pageNumber)))return null;
  const anchors=[image.sourceExcerpt,image.association?.excerpt].map(compact).filter(Boolean);
  if(!anchors.length)return null;
  const workshop=standardWorkshop(image.relatedWorkshop,mappings);
  if(!workshop||/未关联|未知|全项目/.test(workshop))return null;
  const candidates=records.filter(record=>
    record.recordType!=='personnel-summary' &&
    record.sourceType!=='weekly-report' && sameDocument(image,record) &&
    record.date===image.relatedDate && Number(record.pageNumber)===Number(image.pageNumber) &&
    standardWorkshop(record.workshop,mappings)===workshop &&
    compact(record.sourceExcerpt) &&
    anchors.some(anchor=>anchor===compact(record.sourceExcerpt) ||
      anchor.endsWith('所属段落：'+compact(record.sourceExcerpt)))
  );
  if(candidates.length!==1)return null;
  const record=candidates[0],key=businessKey(record);
  if(record.id===image.relatedRecordId&&key===image.relatedRecordKey)return null;
  return {record,key,previousRecordId:image.relatedRecordId||'',
    reason:'同原件、日期、页码、车间及原文段落唯一匹配'};
}
