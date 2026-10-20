import {projectAuth} from '../server/project-auth.js';
import {parseBody,ApiError} from '../server/ai-auth.js';
import {reviewEvidence} from '../server/evidence-review.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    await projectAuth(req,{editor:true});const body=parseBody(req.body),ids=body.imageIds||[];
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[-_a-zA-Z0-9]{1,240}$/.test(id)))throw new ApiError(400,'Invalid image IDs');
    return res.status(200).json(await reviewEvidence({imageIds:[...new Set(ids)]}));
  }catch(error){return res.status(error.status||502).json({error:error.status?error.message:'自动核对暂不可用，保留人工核对'});}
}
