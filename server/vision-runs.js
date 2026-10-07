import {ApiError} from './ai-auth.js';
export async function runVisionOnce(imageId,auth,execute,{fetchImpl=fetch}={}){
 const path=`${auth.base}/rest/v1/vision_runs`,filter=`?image_id=eq.${encodeURIComponent(imageId)}&project_id=eq.khayrat`;
 const call=async(suffix,method='GET',body,prefer)=>{const r=await fetchImpl(path+suffix,{method,headers:{...auth.headers,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new ApiError(503,'视觉审计记录不可用；未发起模型调用');return r.status===204?[]:r.json();};
 const previous=(await call(filter+'&select=*'))[0];if(previous?.state==='success')return {...previous.analysis,cached:true};
 let claimed;if(!previous)claimed=await call('?on_conflict=image_id','POST',{image_id:imageId,project_id:'khayrat',state:'running',updated_at:new Date().toISOString()},'resolution=ignore-duplicates,return=representation');else if(previous.state==='failed'||Date.parse(previous.updated_at)<Date.now()-300000)claimed=await call(filter+'&updated_at=eq.'+encodeURIComponent(previous.updated_at),'PATCH',{state:'running',updated_at:new Date().toISOString()},'return=representation');
 if(!claimed?.length)throw new ApiError(409,'该图片分析进行中，请稍后读取结果');
 try{const analysis=await execute();await call(filter,'PATCH',{state:'success',analysis,attempts:[...(previous?.attempts||[]),...(analysis.attempts||[])],updated_at:new Date().toISOString()});return analysis;}catch(e){try{await call(filter,'PATCH',{state:'failed',attempts:[...(previous?.attempts||[]),...(e.attempts||[])],updated_at:new Date().toISOString()});}catch{}throw e;}
}
