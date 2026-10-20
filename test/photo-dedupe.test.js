import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {imageFingerprint,samePhoto,duplicateCandidate,chooseCanonical,canonicalPayload,duplicatePointerPayload} from '../server/photo-dedupe.js';

async function scene({changed=false,format='png'}={}){const svg=`<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="240" fill="#d8c29b"/><rect x="30" y="80" width="170" height="100" fill="#737b80"/><path d="M30 80 L115 20 L200 80" fill="#324b5a"/><rect x="230" y="${changed?25:120}" width="55" height="${changed?170:60}" fill="${changed?'#d62828':'#3a7d44'}"/></svg>`,pipeline=sharp(Buffer.from(svg));return format==='jpeg'?pipeline.jpeg({quality:72}).toBuffer():pipeline.png().toBuffer();}

test('perceptual fingerprint matches re-encoded pixels but rejects a materially different construction photo',async()=>{
 const png=await scene(),jpeg=await scene({format:'jpeg'}),resized=await sharp(png).resize(426,240,{fit:'fill'}).jpeg({quality:72}).toBuffer(),changed=await scene({changed:true,format:'jpeg'}),a=await imageFingerprint(png,'image/png'),b=await imageFingerprint(jpeg,'image/jpeg'),stretched=await imageFingerprint(resized,'image/jpeg'),c=await imageFingerprint(changed,'image/jpeg');
 assert.equal(a.contentHash===b.contentHash,false);assert.equal(samePhoto(a,b).match,true);assert.equal(samePhoto(a,stretched).match,true);assert.equal(samePhoto(a,c).match,false);
});

test('dedupe requires cross-source, same date and standardized workshop',()=>{
 const daily={imageId:'daily',relatedDate:'2026-10-18',relatedWorkshop:'中控楼'},weekly={imageId:'weekly',sourceType:'weekly-report',relatedDate:'2026-10-18',relatedWorkshop:'中控室',comparisonPeriod:'本周'};
 assert.equal(duplicateCandidate(daily,weekly),true);assert.equal(duplicateCandidate(daily,{...weekly,comparisonPeriod:'上周'}),false);assert.equal(duplicateCandidate(daily,{...weekly,relatedDate:'2026-10-19'}),false);assert.equal(duplicateCandidate(daily,{...weekly,sourceType:undefined}),false);
});

test('canonical record keeps the daily asset, both source associations and one recognition result',()=>{
 const daily={imageId:'daily',sourceFile:'daily.pdf',relatedDate:'2026-10-18',relatedWorkshop:'水泥库',objectPath:'daily.png',visionEnabled:true,aiSummary:'daily result'},weekly={imageId:'weekly',sourceType:'weekly-report',sourceFile:'weekly.pptx',pageNumber:22,comparisonPeriod:'本周',relatedDate:'2026-10-18',relatedWorkshop:'水泥库',objectPath:'weekly.jpg',visionEnabled:true,aiSummary:'weekly result'},match={method:'perceptual',perceptualDistance:2,differenceDistance:3};
 assert.equal(chooseCanonical(weekly,daily).imageId,'daily');const canonical=canonicalPayload(daily,weekly,match),pointer=duplicatePointerPayload(weekly,daily,match);assert.equal(canonical.sourceAssociations.length,2);assert.equal(canonical.aiSummary,'daily result');assert.equal(pointer.duplicateOf,'daily');assert.equal(pointer.objectPath,undefined);assert.equal(pointer.ignored,true);
});
