import {projectAuth,rest} from '../server/project-auth.js';
import {publicProjection} from '../server/public-dashboard.js';
import {latestPublicReportDate,readPublicSource} from '../server/public-source.js';
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});try{const auth=await projectAuth(req,{editor:true});if(req.body?.confirmPublication!==true)return res.status(400).json({error:'请明确确认公开发布'});
 const {reports,progress,images,shipments,mappings,milestones}=await readPublicSource(),publishedAt=new Date().toISOString(),asOf=latestPublicReportDate(reports),payload=publicProjection(reports,progress,images,{asOf,shipments,mappings,milestones,publishedAt});
 await rest('/rest/v1/public_dashboard_snapshots?on_conflict=project_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({project_id:'khayrat',payload,published_at:publishedAt,published_by:auth.user.id})});
 return res.status(200).json({publishedAt,workshops:payload.workshops.length,photos:payload.photos.length});}catch(e){return res.status(e.status||502).json({error:e.status?e.message:'Publication failed'});}}
