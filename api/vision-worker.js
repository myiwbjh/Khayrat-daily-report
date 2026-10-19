import {workerAuthorized,processVisionJob} from '../server/vision-jobs.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!workerAuthorized(req))return res.status(401).json({error:'Unauthorized'});
  try{return res.status(200).json(await processVisionJob());}
  catch{return res.status(503).json({error:'Background worker unavailable'});}
}
