import sharp from 'sharp';
import {projectAuth,rest,serviceAccess} from '../server/project-auth.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    await projectAuth(req);
    const id=req.body?.imageId;
    if(typeof id!=='string'||!/^[-_a-zA-Z0-9]{1,240}$/.test(id))return res.status(400).json({error:'Invalid image ID'});
    const rows=await rest('/rest/v1/image_evidence?project_id=eq.khayrat&image_id=eq.'+encodeURIComponent(id)+'&select=payload&limit=1');
    const evidence=rows?.[0]?.payload;
    if(!evidence||evidence.ignored||evidence.logoConfirmed||evidence.decorative)return res.status(404).end();
    const path=evidence.objectPath;
    if(typeof path!=='string'||!/^khayrat\/[^/]+\/evidence\/[-_a-zA-Z0-9]+\.(png|jpg|jpeg|webp)$/.test(path))return res.status(404).end();
    const {base,headers}=serviceAccess();
    const source=await fetch(base+'/storage/v1/object/authenticated/khayrat-reports/'+path.split('/').map(encodeURIComponent).join('/'),{headers,signal:AbortSignal.timeout(20000)});
    if(!source.ok)return res.status(404).end();
    if(Number(source.headers.get('content-length')||0)>25_000_000)return res.status(413).end();
    const bytes=Buffer.from(await source.arrayBuffer());
    if(bytes.length>25_000_000)return res.status(413).end();
    const thumb=await sharp(bytes,{limitInputPixels:60_000_000,failOn:'error'}).rotate().resize({width:480,height:320,fit:'inside',withoutEnlargement:true}).jpeg({quality:68,mozjpeg:true}).toBuffer();
    res.setHeader('Content-Type','image/jpeg');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).send(thumb);
  }catch(error){return res.status(error.status||502).json({error:error.status?error.message:'Thumbnail unavailable'});}
}
