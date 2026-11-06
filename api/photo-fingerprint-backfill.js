import {projectAuth,serviceAccess} from '../server/project-auth.js';
import {backfillEvidenceFingerprints} from '../server/photo-dedupe-service.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{await projectAuth(req,{editor:true});const result=await backfillEvidenceFingerprints({limit:req.body?.limit||20,auth:serviceAccess()});return res.status(200).json(result);}
  catch(error){return res.status(error.status||502).json({error:error.status?error.message:'照片指纹补齐失败，未删除任何感知相似照片'});}
}
