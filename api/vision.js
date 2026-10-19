import {parseBody,authorizeAI} from '../server/ai-auth.js';
import {freeConsent,enqueueVision} from '../server/vision-jobs.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const body=parseBody(req.body);freeConsent(body);
    const auth=await authorizeAI(req),jobs=await enqueueVision(body,auth);
    return res.status(202).json({jobs});
  }catch(error){return res.status(error.status||503).json({error:error.status?error.message:'识别队列暂不可用；图片已保留，可手动重试'});}
}
