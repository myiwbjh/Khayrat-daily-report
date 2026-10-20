import {serviceAccess} from './project-auth.js';
import {imageFingerprint,samePhoto,duplicateCandidate,chooseCanonical,canonicalPayload,duplicatePointerPayload} from './photo-dedupe.js';

const restJson=async(path,{method='GET',body,auth=serviceAccess(),fetchImpl=fetch,prefer='return=representation'}={})=>{const response=await fetchImpl(`${auth.base}${path}`,{method,headers:{...auth.headers,...(prefer?{Prefer:prefer}:{})},body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Photo dedupe storage request failed: ${response.status}`);const text=await response.text();return text?JSON.parse(text):[];};
async function readObject(image,{auth=serviceAccess(),fetchImpl=fetch,env=process.env}={}){const path=image.objectPath,bucket=env.SUPABASE_STORAGE_BUCKET||'khayrat-reports';if(typeof path!=='string'||!path.startsWith('khayrat/')||path.includes('..')||path.includes('\\'))throw Error('Invalid evidence path');const response=await fetchImpl(`${auth.base}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`,{headers:auth.headers,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Private evidence read failed: ${response.status}`);return {buffer:Buffer.from(await response.arrayBuffer()),mime:(response.headers.get('content-type')||'').split(';')[0]};}
async function deleteObject(path,{auth=serviceAccess(),fetchImpl=fetch,env=process.env}={}){if(!path)return;const bucket=env.SUPABASE_STORAGE_BUCKET||'khayrat-reports',response=await fetchImpl(`${auth.base}/storage/v1/object/${encodeURIComponent(bucket)}`,{method:'DELETE',headers:auth.headers,body:JSON.stringify({prefixes:[path]}),signal:AbortSignal.timeout(30000)});if(!response.ok&&response.status!==404)throw Error(`Duplicate evidence delete failed: ${response.status}`);}
async function patchEvidence(imageId,payload,{auth=serviceAccess(),fetchImpl=fetch}={}){return restJson(`/rest/v1/image_evidence?project_id=eq.khayrat&image_id=eq.${encodeURIComponent(imageId)}`,{method:'PATCH',body:{payload,updated_at:new Date().toISOString()},auth,fetchImpl});}
export async function fingerprintEvidence(image,options={}){const {buffer,mime}=await readObject(image,options),fingerprint=await imageFingerprint(buffer,mime);return {...fingerprint,fingerprintAlgorithm:fingerprint.algorithm};}

export async function consolidateEvidence(left,right,match,options={}){
  const canonical=chooseCanonical(left,right),duplicate=canonical.imageId===left.imageId?right:left,canonicalNext=canonicalPayload(canonical,duplicate,match),duplicateNext=duplicatePointerPayload(duplicate,canonical,match);
  await patchEvidence(canonical.imageId,canonicalNext,options);await patchEvidence(duplicate.imageId,duplicateNext,options);await deleteObject(duplicate.objectPath,options);
  return {canonical:canonicalNext,duplicate:duplicateNext,deletedObject:Boolean(duplicate.objectPath)};
}

export async function findDuplicateEvidence(image,fingerprint,{restImpl=null,...options}={}){
  const auth=options.auth||serviceAccess(),rows=restImpl?await restImpl(`/rest/v1/image_evidence?project_id=eq.khayrat&payload->>relatedDate=eq.${encodeURIComponent(image.relatedDate)}&select=image_id,payload,created_at`):await restJson(`/rest/v1/image_evidence?project_id=eq.khayrat&payload->>relatedDate=eq.${encodeURIComponent(image.relatedDate)}&select=image_id,payload,created_at`,{auth,fetchImpl:options.fetchImpl});
  for(const row of rows){let candidate={...row.payload,imageId:row.image_id,createdAt:row.created_at};if(!duplicateCandidate(image,candidate))continue;if(!candidate.perceptualHash||!candidate.differenceHash){try{const value=await fingerprintEvidence(candidate,{...options,auth});candidate={...candidate,...value};await patchEvidence(candidate.imageId,candidate,{...options,auth});}catch{continue;}}
    const match=samePhoto(fingerprint,candidate);if(match.match)return {candidate,match};
  }
  return null;
}

export async function repairOctober18({auth=serviceAccess(),fetchImpl=fetch,env=process.env}={}){
  const rows=await restJson('/rest/v1/image_evidence?project_id=eq.khayrat&payload->>relatedDate=eq.2026-10-18&select=image_id,payload,created_at&order=image_id',{auth,fetchImpl}),images=rows.map(row=>({...row.payload,imageId:row.image_id,createdAt:row.created_at})),previous=images.filter(image=>image.sourceType==='weekly-report'&&image.comparisonPeriod==='上周'&&!image.ignored),active=images.filter(image=>!image.ignored&&!(image.sourceType==='weekly-report'&&image.comparisonPeriod==='上周'));
  for(const image of images.filter(value=>value.duplicateOf&&value.quarantinedObjectPath))await deleteObject(image.quarantinedObjectPath,{auth,fetchImpl,env});
  for(const image of previous)await patchEvidence(image.imageId,{...image,ignored:true,historicalEvidence:true,currentPeriodDisplay:false,ignoreReason:'周报“上周”照片，仅保留为历史证据，不计入本周展示与统计'}, {auth,fetchImpl});
  const fingerprints=[];for(const image of active){const fingerprint=await fingerprintEvidence(image,{auth,fetchImpl,env}),next={...image,...fingerprint};await patchEvidence(image.imageId,next,{auth,fetchImpl});fingerprints.push(next);}
  const removed=new Set(),duplicates=[];for(let i=0;i<fingerprints.length;i++){const left=fingerprints[i];if(removed.has(left.imageId))continue;for(let j=i+1;j<fingerprints.length;j++){const right=fingerprints[j];if(removed.has(right.imageId)||!duplicateCandidate(left,right))continue;const match=samePhoto(left,right);if(!match.match)continue;const result=await consolidateEvidence(left,right,match,{auth,fetchImpl,env});removed.add(result.duplicate.imageId);duplicates.push({canonicalId:result.canonical.imageId,duplicateId:result.duplicate.imageId,method:match.method,perceptualDistance:match.perceptualDistance,differenceDistance:match.differenceDistance});break;}}
  return {date:'2026-10-18',misclassifiedPrevious:previous.length,crossSourceDuplicates:duplicates.length,duplicates,fingerprinted:fingerprints.length,assetsRemoved:duplicates.length,originalReportsModified:0};
}
