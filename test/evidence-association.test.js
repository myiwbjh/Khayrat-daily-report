import test from 'node:test';
import assert from 'node:assert/strict';
import {businessKey} from '../src/storage.js';
import {isHistoricalWeeklyPhoto,matchesPhotoReport,verifiedPhotoRecordCorrection} from '../src/evidence-association.js';
import {evidenceStatus} from '../src/evidence-status.js';
import {latestValidPhotoSelection} from '../src/latest-gallery.js';
import {publicPhotoAllowed} from '../server/public-dashboard.js';

const record={id:'right-id',sourceFile:'daily.pdf',originalObjectPath:'private/daily.pdf',
  date:'2026-10-18',pageNumber:2,workshop:'水泥库',process:'模板安装',
  activityId:'section-4',sourceExcerpt:'4. 水泥库：环梁模板正在安装。'};
const photo={imageId:'photo-1',sourceFile:record.sourceFile,originalObjectPath:record.originalObjectPath,
  pageNumber:2,relatedDate:record.date,relatedWorkshop:record.workshop,
  relatedProcess:record.process,relatedRecordId:'wrong-id',
  relatedRecordKey:'wrong-key',sourceExcerpt:record.sourceExcerpt,
  association:{status:'linked-workshop',needsReview:true}};

test('unique source paragraph safely corrects an obsolete link',()=>{
  const before=structuredClone(photo),result=verifiedPhotoRecordCorrection(photo,[record]);
  assert.equal(result.record.id,record.id);
  assert.equal(result.key,businessKey(record));
  assert.deepEqual(photo,before);
  assert.equal(verifiedPhotoRecordCorrection({...photo,manualReviewed:true},[record]),null);
  assert.equal(verifiedPhotoRecordCorrection({...photo,calibration:{decision:'acceptable'}},[record]),null);
});
test('ambiguous, missing, mismatched or title-only source never auto-links',()=>{
  assert.equal(verifiedPhotoRecordCorrection(photo,[record,{...record,id:'other-id'}]),null);
  assert.equal(verifiedPhotoRecordCorrection({...photo,sourceExcerpt:''},[record]),null);
  assert.equal(verifiedPhotoRecordCorrection({...photo,pageNumber:3},[record]),null);
  assert.equal(verifiedPhotoRecordCorrection({...photo,relatedDate:'2026-10-11'},[record]),null);
  assert.equal(verifiedPhotoRecordCorrection({...photo,relatedWorkshop:''},[record]),null);
  assert.equal(verifiedPhotoRecordCorrection({...photo,originalObjectPath:'private/other.pdf'},[record]),null);
});
test('wrong record IDs cannot attach photos to other workshops',()=>{
  const wrong={...record,id:'wrong-id',workshop:'污水处理'};
  assert.equal(matchesPhotoReport(photo,wrong),false);
  assert.equal(matchesPhotoReport({...photo,relatedRecordId:record.id},record),true);
});
test('historical weekly photos are excluded despite missing legacy ignored flag',()=>{
  const old={...photo,sourceType:'weekly-report',comparisonPeriod:'上周',ignored:false,
    manualReviewed:true,publicApproved:true,scene:'施工中'};
  assert.equal(isHistoricalWeeklyPhoto(old),true);
  assert.equal(evidenceStatus(old),'excluded');
  assert.equal(matchesPhotoReport({...old,relatedRecordId:record.id},record),false);
  assert.equal(latestValidPhotoSelection([old],old.relatedDate).photos.length,0);
  assert.equal(publicPhotoAllowed(old),false);
});
