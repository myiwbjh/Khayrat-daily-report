import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {reviewEvidence} from '../server/evidence-review.js';

const fixture=resolve('test/fixtures/synthetic-reports.pdf');
const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'qa@example.test',email_confirmed_at:'2026-10-04T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{}};
function token(exp=Math.floor(Date.now()/1000)+3600){return [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({...user,sub:user.id,exp,iat:Math.floor(Date.now()/1000)})).toString('base64url'),'synthetic-not-a-real-signature'].join('.');}
function session(exp){return {access_token:token(exp),refresh_token:'synthetic-refresh-token',expires_in:3600,expires_at:exp||Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};}
async function sandbox(page,{configured=true,failUpload=false,failSave=false,visionEnabled=false,freeVision=false,visionInterval=61000,visionQuotaAfter=Infinity,failVerify=false,holdPassword=false}={}){
  const state={jobs:[],reports:[],images:[],audits:[],objects:new Map(),otp:null,verifications:[],refreshes:0,posts:0,failUpload,failSave,blocked:[],visionCalls:[],signedRequests:[],signedRequestBodies:[]};
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='http://127.0.0.1:4173'){
      if(url.pathname==='/api/config')return route.fulfill({json:configured?{supabaseUrl:'https://qa.supabase.test',supabaseAnonKey:'synthetic-public-key',storageBucket:'test-reports',ocrEnabled:false,visionEnabled,...(freeVision?{visionProviderId:"groq",visionProvider:"Groq",visionModel:"qwen/qwen3.8-27b",visionMinIntervalMs:visionInterval,visionCostNotice:"Free Plan：额度用尽停止",visionPrivacyNotice:"Groq 处理图片"}:{}),authRequired:true}:{supabaseUrl:'',supabaseAnonKey:''}});
      if(url.pathname==='/api/evidence-review'){
        if(!state.autoReview)return route.fulfill({json:{updated:0,passed:0,pending:0}});
        state.reviewCalls=(state.reviewCalls||0)+1;
        const result=await reviewEvidence({restImpl:async(path,options={})=>{
          const u=new URL(path,'https://test');
          if(options.method==='PATCH'){const row=state.images.find(r=>`eq.${r.image_id}`===u.searchParams.get('image_id'));if(`eq.${row.updated_at}`!==u.searchParams.get('updated_at'))return [];Object.assign(row,JSON.parse(options.body));return [row];}
          return structuredClone(u.pathname.endsWith('/image_evidence')?state.images:u.pathname.endsWith('/daily_reports')?state.reports:[]);
        }});
        return route.fulfill({json:result});
      }
      if(url.pathname==='/api/vision'){
        state.visionCalls.push({body:request.postDataJSON(),authorization:request.headers().authorization});
        if(state.visionCalls.length>visionQuotaAfter)return route.fulfill({status:429,json:{error:"免费视觉额度已达上限；不会自动切换付费服务。"}});
        const ids=request.postDataJSON().imageIds;for(const id of ids)if(!state.jobs.some(j=>j.image_id===id))state.jobs.push({image_id:id,state:'pending',error:null});
        return route.fulfill({status:202,json:{jobs:state.jobs.filter(j=>ids.includes(j.image_id))}});
      }
      return route.continue();
    }
    if(url.origin!=='https://qa.supabase.test'){state.blocked.push(url.origin);return route.abort();}
    if(url.pathname==='/auth/v1/otp'){state.otp={body:request.postDataJSON(),redirect:url.searchParams.get('redirect_to')};return route.fulfill({json:{}});}
    if(url.pathname==='/auth/v1/verify'){state.verifications.push({body:request.postDataJSON(),method:request.method(),url:request.url()});return failVerify?route.fulfill({status:403,json:{error_code:'otp_expired',msg:'SYNTHETIC private upstream token=do-not-display'}}):route.fulfill({json:session()});}
    if(url.pathname==='/auth/v1/user')return route.fulfill({json:user});
    if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}});
    if(url.pathname==='/auth/v1/token'){if(url.searchParams.get('grant_type')==='password'){state.passwordLogins=(state.passwordLogins||0)+1;if(holdPassword)await new Promise(resolve=>{state.releaseLogin=resolve;});if(failVerify)return route.fulfill({status:400,json:{error:'invalid_grant',error_description:'SYNTHETIC private password'}});return route.fulfill({json:session()});}state.refreshes++;return route.fulfill({json:session()});}
    if(url.pathname.startsWith('/storage/v1/object/sign/')){state.signedRequests.push(url.pathname);state.signedRequestBodies.push(request.postDataJSON());return route.fulfill({json:{signedURL:'/object/signed-test/'+encodeURIComponent(url.pathname.replace('/storage/v1/object/sign/','/storage/v1/object/'))}});}
    if(url.pathname.startsWith('/storage/v1/object/signed-test/')){
      const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/signed-test/'.length)),object=state.objects.get(key);return route.fulfill({contentType:'image/png',body:object||Buffer.from('')});
    }
    if(!request.headers().authorization?.startsWith('Bearer '))return route.fulfill({status:401,json:{message:'login required'}});
    if(url.pathname.startsWith('/storage/v1/object/')){
      if(state.failUpload){state.failUpload=false;return route.fulfill({status:503,json:{message:'synthetic upload failure'}});}
      state.objects.set(url.pathname,request.postDataBuffer());return route.fulfill({json:{Key:url.pathname}});
    }
    if(url.pathname==='/rest/v1/vision_runs')return route.fulfill({json:state.jobs});
    if(url.pathname==='/rest/v1/project_members')return route.fulfill({json:[{role:'editor',is_admin:false}]});
    if(url.pathname.startsWith('/rest/v1/')){
      const table=url.pathname.split('/').at(-1);if(['progress_measurements','equipment_shipments','crosswalk_mappings'].includes(table))return route.fulfill({status:404,json:{code:'PGRST205',message:`public.${table} not found`}});if(!['daily_reports','image_evidence','import_audits'].includes(table))return route.fulfill({json:[]});const store=table==='daily_reports'?state.reports:table==='image_evidence'?state.images:state.audits;
      if(request.method()==='GET'){if(table==='image_evidence'&&state.imageReadGate)await state.imageReadGate;return route.fulfill({json:store});}
      state.posts++;if(state.failSave&&table==='image_evidence'){state.failSave=false;return route.fulfill({status:503,json:{message:'synthetic database failure'}});}
      for(const row of [request.postDataJSON()].flat()){const key=table==='daily_reports'?'id':table==='image_evidence'?'image_id':'import_id',existing=store.findIndex(x=>x[key]===row[key]);if(existing<0)store.push(row);else store[existing]=row;}
      return route.fulfill({json:{}});
    }
    return route.fulfill({status:404,json:{message:'unexpected test endpoint'}});
  });
  return state;
}
async function login(page){const s=session();await page.goto(`/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`);await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');await expect(page.locator('html')).toHaveAttribute('data-project-role','editor');}
async function upload(page){await page.locator('#fileInput').setInputFiles(fixture);await expect(page.locator('#importSummary')).toContainText('2 条记录、4 张有效施工图片',{timeout:25000});}

test('first email login uses correct redirect, remembered session restores and logout is explicit',async({page})=>{
  const state=await sandbox(page);await page.goto('/?member=1');await expect(page.locator('#cloudStatus')).toContainText('点击登录');await page.locator('#cloudStatus').click();await page.locator('#emailLoginFallback summary').click();await page.locator('#loginEmail').fill(user.email);await page.locator('#sendLogin').click();await expect(page.locator('#loginError')).toContainText('邮件已发送');expect(state.otp.body.create_user).toBe(false);expect(state.otp.redirect).toBe('http://127.0.0.1:4173/');
  await login(page);await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');await page.locator('#signOutButton').click();await expect(page.locator('#signOutButton')).toBeHidden();await expect(page.locator('#cloudStatus')).toContainText(/点击登录|登录 \/ 进入编辑/);await page.reload();await expect(page.locator('#signOutButton')).toBeHidden();await expect(page.locator('#cloudStatus')).toContainText(/点击登录|登录 \/ 进入编辑/);expect(state.blocked).toEqual([]);
});
test('expired remembered session refreshes through SDK rather than using stale access token',async({page})=>{
  const state=await sandbox(page),old=session(Math.floor(Date.now()/1000)-300);await page.addInitScript(({old})=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(old)),{old});await page.goto('/');await expect(page.locator('#cloudStatus')).toContainText('已自动登录');expect(state.refreshes).toBeGreaterThan(0);
});
test('synthetic multilingual PDF extracts text and JPEG/Flate images, saves private data and restores after reload',async({page})=>{
  const state=await sandbox(page);await login(page);await upload(page);await expect(page.locator('#importPreviewRows')).toContainText('粉磨车间');await expect(page.locator('#importPreviewRows')).toContainText('第 2 页');expect(state.posts).toBe(0);
  await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports).toHaveLength(2);expect(state.images).toHaveLength(4);expect(state.audits).toHaveLength(1);expect(state.objects.size).toBe(5);
  expect(state.reports.every(r=>r.id&&r.payload.provenance&&r.payload.originalObjectPath)).toBe(true);expect(state.images.every(i=>i.report_id&&i.payload.objectPath&&!i.payload.dataUrl&&!i.payload.signedUrl)).toBe(true);
  expect(state.signedRequests).toHaveLength(0);await page.getByRole('link',{name:'日报对比'}).click();await expect(page.locator('#comparisonRows')).toContainText('改善');await expect(page.locator('#comparisonRows')).toContainText('中方 +1');await expect(page.locator('#comparisonRows')).toContainText('当日工程量 +8');expect(state.signedRequests).toHaveLength(0);await page.locator('.comparison-card>summary').first().click();await expect(page.locator('.comparison-photo-column')).toHaveCount(2);await expect.poll(()=>state.signedRequests.length).toBeGreaterThan(0);expect(state.signedRequestBodies.every(body=>body.transform?.width===480)).toBe(true);
  await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(4);await expect.poll(()=>page.locator('#imageGallery img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);expect(state.posts).toBe(3);expect(state.blocked).toEqual([]);
});
test('photo evidence signs only visible thumbnails and fetches original on click',async({page})=>{
  const state=await sandbox(page);for(let index=0;index<45;index++){const imageId=`page-${String(index).padStart(2,'0')}`;state.images.push({image_id:imageId,project_id:'khayrat',updated_at:'2026-10-12T00:00:00Z',payload:{imageId,sourceFile:'daily.pdf',pageNumber:index+1,imageIndex:1,relatedDate:`2026-09-${String(index%30+1).padStart(2,'0')}`,relatedWorkshop:index%2?'粉磨车间':'原料车间',objectPath:`khayrat/import/evidence/${imageId}.png`,visionEnabled:true,scene:'施工中'}});}
  await login(page);expect(state.signedRequests).toHaveLength(0);await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('[data-open-image]')).toHaveCount(20);await expect(page.locator('#imagePageStatus')).toContainText('第 1 / 3 页');await expect.poll(()=>state.signedRequests.length).toBeGreaterThan(0);const visibleCount=state.signedRequests.length;expect(visibleCount).toBeLessThan(20);expect(state.signedRequestBodies.every(body=>body.transform?.width===480&&body.expiresIn===900)).toBe(true);await expect(page.locator('[data-open-image]').first()).toContainText('2026-09-30');await page.locator('[data-open-image]').first().evaluate(node=>node.click());await expect(page.locator('#imageDialog')).toBeVisible();await expect(page.locator('#imageFull')).toHaveAttribute('src',/signed-test/);await page.locator('#closeImageDialog').click();await page.locator('#imageNext').click();await expect(page.locator('[data-open-image]')).toHaveCount(20);await expect.poll(()=>state.signedRequests.length).toBeGreaterThan(visibleCount+1);expect(state.signedRequests.length).toBeLessThan(45);
});
test('upload failure retains pending batch, retry saves once and duplicate import does not overwrite reports',async({page})=>{
  const state=await sandbox(page,{failUpload:true});await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#confirmImport')).toContainText('重试');expect(state.reports).toHaveLength(0);await expect(page.locator('#dataStatus')).toContainText('尚未导入');
  await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports).toHaveLength(2);const ids=state.reports.map(r=>r.id);await upload(page);await expect(page.locator('#importSummary')).toContainText('2 条重复');await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports.map(r=>r.id)).toEqual(ids);expect(state.images).toHaveLength(4);expect(state.images.every(i=>ids.includes(i.report_id))).toBe(true);
});
test('database partial failure can retry stable report/image/audit IDs without local commit',async({page})=>{
  const state=await sandbox(page,{failSave:true});await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#confirmImport')).toContainText('重试');await expect(page.locator('#dataStatus')).toContainText('尚未导入');const ids=state.reports.map(r=>r.id);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports.map(r=>r.id)).toEqual(ids);expect(state.audits).toHaveLength(1);
});
test('failed PDF batch is visible and cannot be confirmed; cancelling keeps prior data',async({page})=>{
  await sandbox(page,{configured:false});await page.goto('/');await page.locator('#fileInput').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});await expect(page.locator('#importMessages')).toContainText('导入失败');await expect(page.locator('#confirmImport')).toBeDisabled();await page.locator('#cancelImport').click();await expect(page.locator('#dataStatus')).toContainText('尚未导入');
});
test('offline PDF mode preserves original and decoded images in IndexedDB through reload',async({page})=>{
  await sandbox(page,{configured:false});await page.goto('/');await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(4);await expect.poll(()=>page.locator('#imageGallery img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  await page.getByRole('link',{name:'日报录入'}).click();await page.locator('[data-history-toggle]').first().click();await page.locator('[data-source]').first().click();await expect(page.locator('#sourceDetails')).toContainText('synthetic-reports.pdf');await expect(page.locator('#downloadOriginal')).toBeVisible();
});
test('manual report saves to authenticated cloud and retains construction content after reload',async({page})=>{
  const state=await sandbox(page);await login(page);await page.getByRole('link',{name:'日报录入'}).click();
  await page.locator('[name="date"]').fill('2026-10-03');await page.locator('[name="workshop"]').fill('QA Workshop');await page.locator('[name="process"]').fill('QA Activity');await page.locator('[name="constructionContent"]').fill('SYNTHETIC WORK ONLY');await page.getByRole('button',{name:'保存日报'}).click();
  await expect(page.getByText('日报已保存到本机和云端')).toBeVisible();expect(state.reports).toHaveLength(1);expect(state.reports[0].payload.constructionContent).toBe('SYNTHETIC WORK ONLY');await page.reload();await page.getByRole('link',{name:'日报录入'}).click();await expect(page.locator('#historyRows')).toContainText('QA Workshop');
});

// Opt-in REAL acceptance: private source PDFs stay outside the repo. Cloud calls are sandboxed.
// KHAYRAT_REAL_PDFS=[{"path":"/absolute/report.pdf","date":"2026-09-30","chinese":67,"local":30}]
const realReports=JSON.parse(process.env.KHAYRAT_REAL_PDFS||'[]');
for(const report of realReports)test(`REAL Khayrat ${report.date}: layout, personnel, images, original, review and duplicate import`,async({page})=>{
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const state=await sandbox(page);await login(page);
  await page.locator('#fileInput').setInputFiles(report.path);await expect(page.locator('#importSummary')).toContainText('12 条记录、11 张有效施工图片',{timeout:60000});
  await expect(page.locator('#importPreviewRows')).toContainText(report.date);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible({timeout:60000});
  expect(state.reports).toHaveLength(12);expect(state.images).toHaveLength(11);expect(state.objects.size).toBe(12);expect(state.images.every(i=>i.payload.originalObjectPath)).toBe(true);
  const summary=state.reports.find(r=>r.payload.recordType==='personnel-summary').payload;
  expect(summary.chineseStaff).toBe(report.chinese);expect(summary.localStaff).toBe(report.local);expect(summary.personnelStatistics.derivedTotal).toBe(report.chinese+report.local);expect(summary.personnelStatistics.issues).toEqual([]);
  expect(state.reports.every(r=>r.payload.date===report.date&&r.payload.originalObjectPath)).toBe(true);expect(summary.documentLayout.every(p=>p.tokens.length&&p.graphics.length)).toBe(true);
  const control=state.images.find(i=>i.payload.relatedWorkshop==='中控楼'),batching=state.images.find(i=>i.payload.relatedWorkshop==='水泥配料站');expect(control).toBeTruthy();expect(batching).toBeTruthy();expect(control.payload.sourceExcerpt).not.toBe(batching.payload.sourceExcerpt);
  expect(state.images.every(i=>i.payload.bbox&&i.payload.association.blockId&&i.report_id&&i.payload.objectPath&&!i.payload.dataUrl)).toBe(true);
  expect(state.images.every(i=>i.payload.visibleFacts.length===0&&i.payload.provider==='text-only')).toBe(true);
  await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(11);await expect.poll(()=>page.locator('#imageGallery img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  await page.locator('[data-open-image]').first().click();await expect(page.locator('#imageTextFacts')).not.toContainText('未关联');await expect(page.locator('#imageProvenance')).toContainText('imageBBox');
  await page.locator('#imageForm [name=caption]').fill('真实日报验收：人工确认关联，未启用外部 AI');await page.locator('#imageForm [name=calibrationDecision]').selectOption('acceptable');await page.locator('#imageForm [name=calibrationNote]').fill('已核对原始日报页码和图片关联');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();expect(state.images.filter(i=>i.payload.manualReviewed)).toHaveLength(1);expect(state.images.find(i=>i.payload.manualReviewed).payload.originalAssociation.blockId).toBeTruthy();
  if(process.env.KHAYRAT_QA_SCREENSHOTS)await page.screenshot({path:`${process.env.KHAYRAT_QA_SCREENSHOTS}/${report.date}-review.png`,fullPage:false});
  const ids=state.reports.map(r=>r.id);await page.locator('#fileInput').setInputFiles(report.path);await expect(page.locator('#importSummary')).toContainText('12 条重复',{timeout:60000});await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible({timeout:60000});expect(state.reports.map(r=>r.id)).toEqual(ids);expect(state.images).toHaveLength(11);expect(state.images.filter(i=>i.payload.manualReviewed)).toHaveLength(1);
  await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(11);expect(state.blocked).toEqual([]);expect(errors).toEqual([]);
});

test('vision stays disabled without approved configuration and consent; manual image correction persists cloud metadata',async({page})=>{
  const state=await sandbox(page);await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#analyzeImages')).toBeDisabled();await page.locator('[data-open-image]').first().click();const reviewedImageId=await page.locator('#imageForm [name=imageId]').inputValue();await expect(page.locator('#analyzeImage')).toBeDisabled();await page.locator('#imageForm [name=caption]').fill('SYNTHETIC REVIEW');await page.locator('#imageForm [name=calibrationDecision]').selectOption('acceptable');await page.locator('#imageForm [name=calibrationNote]').fill('SYNTHETIC SOURCE CHECK');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();const reviewedImage=state.images.find(image=>image.image_id===reviewedImageId);expect(reviewedImage.payload.manualReview.confirmed).toBe(true);expect(reviewedImage.payload.confidence).toBe(0);expect(reviewedImage.payload.dataUrl).toBeUndefined();await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await page.locator(`[data-open-image="${reviewedImageId}"]`).click();await expect(page.locator('#imageForm [name=caption]')).toHaveValue('SYNTHETIC REVIEW');
});

function completeJobs(state){for(const job of state.jobs){const image=state.images.find(i=>i.image_id===job.image_id),analysis={scene:'材料堆放',visibleFacts:['SYNTHETIC: visible rebar'],inferences:[],aiSummary:'SYNTHETIC VISION RESPONSE',provider:'Groq',model:'mock-only',confidence:.7,visionEnabled:true,manualReviewed:false};image.payload={...image.payload,...analysis,automaticAnalysis:analysis};job.state='success';}}

test('upload automatically queues all photos without waiting for AI, survives reload and does not requeue duplicates',async({page})=>{
 const state=await sandbox(page,{visionEnabled:true,freeVision:true});await login(page);await page.getByRole('link',{name:'数据导入与工程量'}).click();await expect(page.locator('#analyzeAfterImport')).toBeChecked();await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.visionCalls).toHaveLength(1);expect(state.visionCalls[0].body.imageIds).toHaveLength(4);expect(state.jobs).toHaveLength(4);expect(state.images.some(i=>i.payload.visionEnabled)).toBe(false);
 completeJobs(state);await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery')).toContainText('识别完成');expect(state.visionCalls).toHaveLength(1);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.visionCalls).toHaveLength(1);expect(state.images).toHaveLength(4);
});

test('manual retry requires consent, queues IDs only, and server results retain human review',async({page})=>{
 const state=await sandbox(page,{visionEnabled:true,freeVision:true});await login(page);await page.getByRole('link',{name:'数据导入与工程量'}).click();await page.locator('#analyzeAfterImport').uncheck();await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.jobs).toHaveLength(0);await page.getByRole('link',{name:'图片证据'}).click();await page.locator('#analyzeImages').click();await expect(page.locator('#toast')).toContainText('传输授权');await page.locator('#visionConsent').check();await page.locator('#analyzeImages').click();await expect(page.locator('#toast')).toContainText('后台识别队列');expect(state.visionCalls[0].body.retry).toBe(true);expect(state.visionCalls[0].body.provider).toBe('groq');expect(state.visionCalls[0].authorization).toContain('Bearer ');
 completeJobs(state);let releaseImages;state.imageReadGate=new Promise(resolve=>{releaseImages=resolve;});await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery')).toContainText('正在同步云端图片状态');await expect(page.locator('[data-open-image]')).toHaveCount(0);state.imageReadGate=null;releaseImages();await page.locator('[data-open-image]').first().click();await expect(page.locator('#imageVisibleFacts')).toContainText('SYNTHETIC');const id=await page.locator('#imageForm [name=imageId]').inputValue();await page.locator('#imageForm [name=reviewedVisibleFacts]').fill('人工确认：模板');await page.locator('#imageForm [name=calibrationDecision]').selectOption('acceptable');await page.locator('#imageForm [name=calibrationNote]').fill('SYNTHETIC review');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();const image=state.images.find(i=>i.image_id===id);expect(image.payload.visibleFacts).toEqual(['人工确认：模板']);expect(image.payload.automaticAnalysis.visibleFacts).toEqual(['SYNTHETIC: visible rebar']);
});

test('failed enqueue retains uploaded photos and remembered upload opt-out survives reload',async({page})=>{
 const state=await sandbox(page,{visionEnabled:true,freeVision:true,visionQuotaAfter:0});await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.images).toHaveLength(4);await expect(page.locator('#importLog')).toContainText('识别入队失败');await page.getByRole('link',{name:'数据导入与工程量'}).click();await page.locator('#analyzeAfterImport').uncheck();await page.reload();await page.getByRole('link',{name:'数据导入与工程量'}).click();await expect(page.locator('#analyzeAfterImport')).not.toBeChecked();expect(state.visionCalls).toHaveLength(1);
});

const freshEmailLink='https://qa.supabase.test/auth/v1/verify?token='+ 'a'.repeat(64)+'&type=magiclink&redirect_to=https://other.test/';
test('current-page email verification restores after reload without navigating to mail redirect',async({page})=>{
  const state=await sandbox(page);await page.goto('/?member=1');await page.locator('#cloudStatus').click();await page.locator('#emailLoginFallback summary').click();
  await page.locator('#verifyLoginEmail').fill(user.email);await page.locator('#loginLink').fill(freshEmailLink);await page.locator('#verifyLogin').click();
  await expect(page.locator('#loginDialog')).not.toBeVisible();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');
  expect(state.verifications).toHaveLength(1);expect(state.verifications[0].body).toEqual({token_hash:'a'.repeat(64),type:'email',gotrue_meta_security:{}});expect(state.verifications[0].method).toBe('POST');
  expect(page.url()).toBe('http://127.0.0.1:4173/');expect(state.blocked).toEqual([]);await expect(page.locator('#loginLink')).toHaveValue('');
  expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('a'.repeat(64));
  await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');
});
test('expired mail link keeps app logged out and hides secret upstream error',async({page})=>{
  const state=await sandbox(page,{failVerify:true});await page.goto('/?member=1');await page.locator('#cloudStatus').click();await page.locator('#emailLoginFallback summary').click();await page.locator('#verifyLoginEmail').fill(user.email);await page.locator('#loginLink').fill(freshEmailLink);await page.locator('#verifyLogin').click();
  await expect(page.locator('#verifyLoginError')).toContainText('已使用');await expect(page.locator('#cloudStatus')).toContainText('点击登录');await expect(page.locator('#loginLink')).toHaveValue('');
  expect(await page.locator('#verifyLoginError').innerText()).not.toContain('private upstream');expect(state.verifications).toHaveLength(1);expect(state.posts).toBe(0);
});
test('foreign mail issuer is rejected and cancellation clears the input',async({page})=>{
  const state=await sandbox(page);await page.goto('/?member=1');await page.locator('#cloudStatus').click();await page.locator('#emailLoginFallback summary').click();await page.locator('#verifyLoginEmail').fill(user.email);await page.locator('#loginLink').fill(freshEmailLink.replace('qa.supabase.test','other.supabase.test'));await page.locator('#verifyLogin').click();
  await expect(page.locator('#verifyLoginError')).toContainText('本项目');expect(state.verifications).toHaveLength(0);await page.locator('#loginLink').fill(freshEmailLink);await page.locator('#cancelLogin').click();await expect(page.locator('#loginLink')).toHaveValue('');
});


test('password login uses the current browser, restores on refresh and never sends an OTP',async({page})=>{
  const state=await sandbox(page);await page.goto('/?member=1');await page.locator('#cloudStatus').click();
  await expect(page.locator('#passwordLoginForm')).toBeVisible();await expect(page.locator('#loginEmail')).not.toBeVisible();
  await page.locator('#passwordEmail').fill(user.email);await page.locator('#loginPassword').fill('synthetic-password-only');await page.locator('#passwordLogin').click();
  await expect(page.locator('#cloudStatus')).toContainText('已自动登录');await expect(page.locator('#loginPassword')).toHaveValue('');expect(state.passwordLogins).toBe(1);expect(state.otp).toBeNull();
  await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');
});
test('failed password login and Escape leave no authenticated session or input',async({page})=>{
  const state=await sandbox(page,{failVerify:true});await page.goto('/?member=1');await page.locator('#cloudStatus').click();
  await page.locator('#passwordEmail').fill(user.email);await page.locator('#loginPassword').fill('synthetic-password-only');await page.locator('#passwordLogin').click();
  await expect(page.locator('#passwordLoginError')).toContainText('邮箱或密码');await expect(page.locator('#cloudStatus')).toContainText('点击登录');await expect(page.locator('#loginPassword')).toHaveValue('');
  await page.locator('#loginPassword').fill('synthetic-password-only');await page.locator('#loginPassword').press('Escape');await expect(page.locator('#loginDialog')).not.toBeVisible();await expect(page.locator('#loginPassword')).toHaveValue('');
  await page.reload();await expect(page.locator('#cloudStatus')).toContainText('点击登录');expect(state.posts).toBe(0);
});

test('pending password success after cancellation never logs in on cancel or Escape',async({page})=>{
  for(const action of ['cancel','escape']){
    const state=await sandbox(page,{holdPassword:true});await page.goto('/?member=1');await page.locator('#cloudStatus').click();
    await page.locator('#passwordEmail').fill(user.email);await page.locator('#loginPassword').fill('synthetic-password-only');await page.locator('#passwordLogin').click();
    await expect.poll(()=>state.passwordLogins||0).toBe(1);
    if(action==='cancel')await page.locator('#cancelLogin').click();else await page.locator('#cancelLogin').press('Escape');
    state.releaseLogin();await expect(page.locator('#passwordLogin')).toBeEnabled();await expect(page.locator('#cloudStatus')).toContainText('点击登录');await expect(page.locator('#loginDialog')).not.toBeVisible();
    await expect(page.locator('#loginPassword')).toHaveValue('');await page.reload();await expect(page.locator('#cloudStatus')).toContainText('点击登录');
    await page.unrouteAll({behavior:'wait'});
  }
});




test('evidence status filters count all cloud rows and update after retry, upload and audited review',async({page})=>{
  await page.clock.install();const state=await sandbox(page,{visionEnabled:true});
  const analysis={visionEnabled:true,provider:'Groq',scene:'施工中',visibleFacts:['SYNTHETIC original'],inferences:[],crossValidation:{status:'consistent'}};
  state.reports.push({id:'r',payload:{id:'r',date:'2026-10-18',workshop:'中控楼',process:'钢筋',constructionContent:'模板'}});
  for(let n=0;n<32;n++)state.images.push({image_id:`i${n}`,payload:{...analysis,imageId:`i${n}`,sourceFile:'synthetic.pdf',pageNumber:1,imageIndex:n,objectPath:`khayrat/i${n}.gif`,relatedDate:'2026-10-18',relatedWorkshop:'中控楼',relatedProcess:'钢筋',relatedRecordId:'r',visionEnabled:n>=4,automaticAnalysis:n>=4?analysis:null,...(n>=4&&n<8?{crossValidation:{status:'potential-conflict',reason:'SYNTHETIC conflict'}}:{})}});
  state.jobs.push({image_id:'i0',state:'failed',error:'SYNTHETIC quota'},{image_id:'i1',state:'pending'},{image_id:'i2',state:'running'});
  for(const row of state.images)state.objects.set(`/storage/v1/object/test-reports/${row.payload.objectPath}`,Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'));
  await login(page);await page.getByRole('link',{name:'图片证据'}).click();
  const unrecognized=page.locator('[data-evidence-status=unrecognized]'),review=page.locator('[data-evidence-status=review]');
  await expect(unrecognized).toHaveText('未识别（4）');await expect(review).toHaveText('待人工核对（4）');await expect(page.locator('[data-open-image]')).toHaveCount(20);
  await page.locator('#imageNext').click();await expect(page.locator('[data-open-image]')).toHaveCount(12);await expect(unrecognized).toHaveText('未识别（4）');
  await unrecognized.click();await expect(unrecognized).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-open-image]')).toHaveCount(4);await expect(page.locator('#imagePageStatus')).toContainText('第 1 / 1 页');await expect(page.locator('#imageGallery')).toContainText('识别失败：SYNTHETIC quota');
  await page.locator('#imageDate').fill('2026-10-17');await page.locator('#imageDate').dispatchEvent('input');await expect(page.locator('[data-open-image]')).toHaveCount(0);await expect(unrecognized).toHaveText('未识别（4）');await page.locator('#imageDate').fill('2026-10-18');await page.locator('#imageDate').dispatchEvent('input');
  await page.locator('#visionConsent').check();await page.locator('#analyzeImages').click();await expect.poll(()=>state.visionCalls.length).toBe(1);expect(state.visionCalls[0].body.imageIds.sort()).toEqual(['i0','i3']);expect(state.visionCalls[0].body.retry).toBe(true);
  completeJobs(state);await page.clock.fastForward(30001);await expect(unrecognized).toHaveText('未识别（0）');await expect(page.locator('[data-open-image]')).toHaveCount(0);
  state.images.push({image_id:'remote-upload',payload:{...state.images[0].payload,imageId:'remote-upload',visionEnabled:false,automaticAnalysis:null}});await page.clock.fastForward(30001);await expect(unrecognized).toHaveText('未识别（1）');await expect(page.locator('[data-open-image]')).toHaveCount(1);
  await review.click();await expect(page.locator('[data-open-image]')).toHaveCount(4);await page.locator('[data-open-image="i4"]').click();await expect(page.locator('#analyzeImage')).toBeDisabled();await expect(page.locator('#imageFull')).toHaveJSProperty('naturalWidth',1);
  await page.locator('#imageForm [name=calibrationDecision]').selectOption('unresolved');await page.locator('#imageForm [name=calibrationNote]').fill('SYNTHETIC: needs site confirmation');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();await expect(review).toHaveText('待人工核对（4）');
  await page.locator('[data-open-image="i4"]').click();await page.locator('#imageForm [name=calibrationDecision]').selectOption('confirmed-conflict');await page.locator('#imageForm [name=calibrationNote]').fill('SYNTHETIC: confirmed by source review');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();await expect(review).toHaveText('待人工核对（3）');await expect(page.locator('[data-open-image="i4"]')).toHaveCount(0);
  const reviewed=state.images.find(i=>i.image_id==='i4').payload;expect(reviewed.calibrationHistory.map(c=>c.decision)).toEqual(['unresolved']);expect(reviewed.reviewHistory).toHaveLength(1);expect(reviewed.automaticAnalysis.visibleFacts).toEqual(['SYNTHETIC original']);expect(reviewed.initialAnalysis.visibleFacts).toEqual(['SYNTHETIC original']);expect(state.visionCalls).toHaveLength(1);
  await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(review).toHaveText('待人工核对（3）');await page.locator('#imageWorkshop').selectOption('中控楼');await expect(page.locator('#imagePageStatus')).toContainText('共 33 张');
});

test('empty member gallery discovers remotely uploaded evidence on refresh',async({page})=>{
  await page.clock.install();const state=await sandbox(page);await login(page);await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('[data-evidence-status=unrecognized]')).toHaveText('未识别（0）');
  state.images.push({image_id:'new',payload:{imageId:'new',objectPath:'private/new',sourceFile:'new.pdf',visionEnabled:false}});await page.clock.fastForward(30001);await expect(page.locator('[data-evidence-status=unrecognized]')).toHaveText('未识别（1）');
});

test('source review automatically clears false positives across pages, retains conflict locations and updates counts without vision',async({page})=>{
  await page.clock.install();const state=await sandbox(page),excerpt='中控楼基础钢筋绑扎、模板安装，基础尚未浇筑';
  state.reports.push({id:'r',payload:{id:'r',sourceFile:'review.pdf',date:'2026-10-18',workshop:'中控楼',process:'基础',sourceExcerpt:excerpt,constructionContent:excerpt,pageNumber:2,documentLayout:[{pageNumber:1,text:'施工日报\n报告日期：2026年10月18日'},{pageNumber:2,blocks:[{id:'b',workshop:'中控楼',excerpt,region:{x:0,y:0,width:100,height:100}}]}]}});
  for(let n=0;n<26;n++){
    const payload={imageId:`review-${n}`,sourceFile:n===25?'missing.pdf':'review.pdf',pageNumber:2,bbox:{x:10,y:10,width:20,height:20},relatedRecordId:'r',relatedDate:'2026-10-18',relatedWorkshop:'中控室',relatedProcess:'基础',association:{needsReview:true},visionEnabled:true,provider:'Groq',scene:'施工中',visibleFacts:[n===24?'基础已经浇筑完成':'基础钢筋、模板可见'],inferences:[],objectPath:`private/${n}.gif`};
    state.images.push({image_id:payload.imageId,payload,updated_at:'2026-10-19T00:00:00Z'});
    state.objects.set(`/storage/v1/object/test-reports/${payload.objectPath}`,Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'));
  }
  await login(page);await page.getByRole('link',{name:'图片证据'}).click();
  const pending=page.locator('[data-evidence-status=review]');
  await expect(pending).toHaveText('待人工核对（26）');await pending.click();await expect(page.locator('[data-open-image]')).toHaveCount(20);
  await expect(page.locator('#autoReviewStatus')).toContainText('已复用');
  state.autoReview=true;await page.clock.fastForward(30001);await expect(pending).toHaveText('待人工核对（2）');await expect(page.locator('[data-open-image]')).toHaveCount(2);
  await page.locator('[data-open-image="review-24"]').click();await expect(page.locator('#imageAutomaticReview')).toContainText('明确相反事实');await expect(page.locator('#imageAutomaticReview')).toContainText('第 2 页');await page.locator('#closeImageDialog').click();
  await page.locator('[data-evidence-status=all]').click();await page.locator('[data-open-image]').filter({hasText:'核对通过'}).first().click();await expect(page.locator('#imageCalibrationStatus')).toHaveText('核对通过');await expect(page.locator('#imageAutomaticReview')).toContainText(excerpt);await expect(page.locator('#analyzeImage')).toBeDisabled();await page.locator('#closeImageDialog').click();
  await page.clock.fastForward(30001);await expect(page.locator('#autoReviewStatus')).toContainText('已复用');
  expect(state.images[0].payload.automaticReviewHistory).toEqual([]);expect(state.images[0].payload.association.needsReview).toBe(true);expect(state.visionCalls).toHaveLength(0);
});
