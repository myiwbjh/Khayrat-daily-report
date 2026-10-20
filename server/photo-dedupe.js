import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {standardWorkshop} from '../src/workshop-status.js';

const ANALYSIS_FIELDS=['scene','visibleFacts','activities','equipment','materials','structures','stage','inferences','limitations','summary','aiSummary','confidence','crossValidation','tags','evidenceType','reviewRecommended','manualReviewed','visionEnabled','provider','model','usage','analyzedAt','cached','fallback','attempts','automaticAnalysis','initialAnalysis','originalAnalysis'];
const clean=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
export const photoSourceKind=image=>image?.sourceType==='weekly-report'?'weekly':'daily';
export const hammingHex=(left='',right='')=>{if(!left||left.length!==right.length)return Infinity;let distance=0;for(let i=0;i<left.length;i++){let value=parseInt(left[i],16)^parseInt(right[i],16);while(value){distance+=value&1;value>>=1;}}return distance;};
const bitsToHex=bits=>{let value='';for(let i=0;i<bits.length;i+=4)value+=parseInt(bits.slice(i,i+4).join(''),2).toString(16);return value;};
const dctHash=pixels=>{const size=32,low=8,coefficients=[];for(let v=0;v<low;v++)for(let u=0;u<low;u++){let sum=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)sum+=pixels[y*size+x]*Math.cos((2*x+1)*u*Math.PI/(2*size))*Math.cos((2*y+1)*v*Math.PI/(2*size));coefficients.push(sum);}const values=coefficients.slice(1),median=[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];return bitsToHex(coefficients.map((value,index)=>index===0?0:Number(value>median)));};
const differenceHash=pixels=>{const bits=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits.push(Number(pixels[y*9+x]>pixels[y*9+x+1]));return bitsToHex(bits);};

export async function imageFingerprint(buffer,mime,{sharpImpl=sharp}={}){
  const input=sharpImpl(buffer,{failOn:'error',limitInputPixels:80_000_000}).rotate(),metadata=await input.metadata(),width=metadata.width||0,height=metadata.height||0;
  if(!width||!height||!['image/png','image/jpeg','image/webp'].includes(mime))throw Error('Unsupported evidence image');
  const [p,d]=await Promise.all([
    input.clone().flatten({background:'#fff'}).resize(32,32,{fit:'fill'}).greyscale().raw().toBuffer(),
    input.clone().flatten({background:'#fff'}).resize(9,8,{fit:'fill'}).greyscale().raw().toBuffer()
  ]);
  return {contentHash:'sha256:'+createHash('sha256').update(buffer).digest('hex'),perceptualHash:dctHash(p),differenceHash:differenceHash(d),width,height,aspectRatio:Number((width/height).toFixed(6)),algorithm:'phash64+dhash64-v1'};
}

export function samePhoto(left,right){
  if(left?.contentHash&&left.contentHash===right?.contentHash)return {match:true,method:'sha256',perceptualDistance:0,differenceDistance:0};
  const leftAspect=Number(left?.aspectRatio??left?.imageAspectRatio),rightAspect=Number(right?.aspectRatio??right?.imageAspectRatio),aspectDelta=Math.abs(leftAspect-rightAspect),perceptualDistance=hammingHex(left?.perceptualHash,right?.perceptualHash),differenceDistance=hammingHex(left?.differenceHash,right?.differenceHash),sameShape=aspectDelta<=0.02&&perceptualDistance<=4&&differenceDistance<=4,resizedCopy=perceptualDistance<=2&&differenceDistance<=5,match=sameShape||resizedCopy;
  return {match,method:match?(sameShape?'perceptual':'perceptual-resized'):'none',perceptualDistance,differenceDistance,aspectDelta};
}

export function duplicateCandidate(current,candidate){
  if(!current||!candidate||current.imageId===candidate.imageId||candidate.ignored||candidate.decorative||candidate.logoConfirmed||candidate.comparisonPeriod==='上周')return false;
  if(photoSourceKind(current)===photoSourceKind(candidate)||current.relatedDate!==candidate.relatedDate)return false;
  return standardWorkshop(current.relatedWorkshop)===standardWorkshop(candidate.relatedWorkshop);
}

export function sourceAssociation(image){return {sourceType:image.sourceType||'daily-report',sourceFile:image.sourceFile||'',pageNumber:image.pageNumber||null,imageIndex:image.imageIndex||null,reportId:image.relatedRecordId||'',recordKey:image.relatedRecordKey||'',relatedDate:image.relatedDate||'',workshop:image.relatedWorkshop||'',process:image.relatedProcess||'',comparisonPeriod:image.comparisonPeriod||'',originalObjectPath:image.originalObjectPath||''};}
const associationKey=item=>JSON.stringify([item.sourceType,item.sourceFile,item.pageNumber,item.imageIndex,item.reportId]);
export function mergeSourceAssociations(...images){const map=new Map();for(const image of images)for(const item of [...image.sourceAssociations||[],sourceAssociation(image)])map.set(associationKey(item),item);return [...map.values()];}
export function chooseCanonical(left,right){const leftDaily=photoSourceKind(left)==='daily',rightDaily=photoSourceKind(right)==='daily';if(leftDaily!==rightDaily)return leftDaily?left:right;return String(left.uploadedAt||left.createdAt||'').localeCompare(String(right.uploadedAt||right.createdAt||''))<=0?left:right;}
export function canonicalPayload(canonical,duplicate,match){
  const recognition=canonical.visionEnabled?canonical:duplicate.visionEnabled?duplicate:canonical,result={...canonical,sourceAssociations:mergeSourceAssociations(canonical,duplicate),deduplicatedSources:true,perceptualHash:canonical.perceptualHash||duplicate.perceptualHash,differenceHash:canonical.differenceHash||duplicate.differenceHash,fingerprintAlgorithm:canonical.fingerprintAlgorithm||duplicate.fingerprintAlgorithm,dedupe:{method:match.method,perceptualDistance:match.perceptualDistance,differenceDistance:match.differenceDistance,mergedAt:new Date().toISOString()}};
  if(recognition!==canonical)for(const field of ANALYSIS_FIELDS)if(Object.hasOwn(recognition,field))result[field]=recognition[field];
  return result;
}
export function duplicatePointerPayload(duplicate,canonical,match){
  const retained={imageId:duplicate.imageId,projectId:duplicate.projectId||'khayrat',sourceType:duplicate.sourceType||'daily-report',sourceFile:duplicate.sourceFile||'',pageNumber:duplicate.pageNumber||null,imageIndex:duplicate.imageIndex||null,relatedDate:duplicate.relatedDate||'',relatedWorkshop:duplicate.relatedWorkshop||'',relatedProcess:duplicate.relatedProcess||'',relatedRecordId:duplicate.relatedRecordId||'',relatedRecordKey:duplicate.relatedRecordKey||'',comparisonPeriod:duplicate.comparisonPeriod||'',originalObjectPath:duplicate.originalObjectPath||'',contentSignature:duplicate.contentSignature||'',sourceAssociations:mergeSourceAssociations(duplicate),ignored:true,duplicateOf:canonical.imageId,ignoreReason:'跨来源重复照片；展示、计数与识别结果统一复用主照片',dedupe:{method:match.method,perceptualDistance:match.perceptualDistance,differenceDistance:match.differenceDistance,mergedAt:new Date().toISOString()},quarantinedObjectPath:duplicate.objectPath||''};
  return retained;
}
