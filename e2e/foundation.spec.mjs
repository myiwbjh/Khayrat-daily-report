import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';

const fixture=resolve('test/fixtures/synthetic-reports.pdf');
const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'qa@example.test',app_metadata:{provider:'email'},user_metadata:{}};
function token(exp=Math.floor(Date.now()/1000)+3600){return [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({...user,sub:user.id,exp,iat:Math.floor(Date.now()/1000)})).toString('base64url'),'synthetic-not-a-real-signature'].join('.');}
function session(exp){return {access_token:token(exp),refresh_token:'synthetic-refresh-token',expires_in:3600,expires_at:exp||Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};}
async function sandbox(page,{configured=true,failUpload=false,failSave=false,visionEnabled=false}={}){
  const state={reports:[],images:[],audits:[],objects:new Map(),otp:null,refreshes:0,posts:0,failUpload,failSave,blocked:[],visionCalls:[]};
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='http://127.0.0.1:4173'){
      if(url.pathname==='/api/config')return route.fulfill({json:configured?{supabaseUrl:'https://qa.supabase.test',supabaseAnonKey:'synthetic-public-key',storageBucket:'test-reports',ocrEnabled:false,visionEnabled,authRequired:true}:{supabaseUrl:'',supabaseAnonKey:''}});
      if(url.pathname==='/api/vision'){
        state.visionCalls.push({body:request.postDataJSON(),authorization:request.headers().authorization});
        return route.fulfill({json:{scene:'材料堆放',visibleFacts:['SYNTHETIC: visible rebar'],activities:[],equipment:[],materials:['钢筋'],structures:[],stage:'无法判断',inferences:['SYNTHETIC: preparation'],limitations:['照片不能证明工程量'],summary:'SYNTHETIC VISION RESPONSE',confidence:.7,crossValidation:{status:'insufficient-evidence',reason:'SYNTHETIC: not conclusive'},textFacts:'配对原文',model:'mock-vision-model',provider:'mock-only',usage:{total_tokens:100}}});
      }
      return route.continue();
    }
    if(url.origin!=='https://qa.supabase.test'){state.blocked.push(url.origin);return route.abort();}
    if(url.pathname==='/auth/v1/otp'){state.otp={body:request.postDataJSON(),redirect:url.searchParams.get('redirect_to')};return route.fulfill({json:{}});}
    if(url.pathname==='/auth/v1/user')return route.fulfill({json:user});
    if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}});
    if(url.pathname==='/auth/v1/token'){state.refreshes++;return route.fulfill({json:session()});}
    if(url.pathname.startsWith('/storage/v1/object/sign/'))return route.fulfill({json:{signedURL:'/object/signed-test/'+encodeURIComponent(url.pathname.replace('/storage/v1/object/sign/','/storage/v1/object/'))}});
    if(url.pathname.startsWith('/storage/v1/object/signed-test/')){
      const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/signed-test/'.length)),object=state.objects.get(key);return route.fulfill({contentType:'image/png',body:object||Buffer.from('')});
    }
    if(!request.headers().authorization?.startsWith('Bearer '))return route.fulfill({status:401,json:{message:'login required'}});
    if(url.pathname.startsWith('/storage/v1/object/')){
      if(state.failUpload){state.failUpload=false;return route.fulfill({status:503,json:{message:'synthetic upload failure'}});}
      state.objects.set(url.pathname,request.postDataBuffer());return route.fulfill({json:{Key:url.pathname}});
    }
    if(url.pathname.startsWith('/rest/v1/')){
      const table=url.pathname.split('/').at(-1),store=table==='daily_reports'?state.reports:table==='image_evidence'?state.images:state.audits;
      if(request.method()==='GET')return route.fulfill({json:store});
      state.posts++;if(state.failSave&&table==='image_evidence'){state.failSave=false;return route.fulfill({status:503,json:{message:'synthetic database failure'}});}
      for(const row of [request.postDataJSON()].flat()){const key=table==='daily_reports'?'id':table==='image_evidence'?'image_id':'import_id',existing=store.findIndex(x=>x[key]===row[key]);if(existing<0)store.push(row);else store[existing]=row;}
      return route.fulfill({json:{}});
    }
    return route.fulfill({status:404,json:{message:'unexpected test endpoint'}});
  });
  return state;
}
async function login(page){const s=session();await page.goto(`/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`);await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');}
async function upload(page){await page.locator('#fileInput').setInputFiles(fixture);await expect(page.locator('#importSummary')).toContainText('2 条记录、4 张图片',{timeout:25000});}

test('first email login uses correct redirect, remembered session restores and logout is explicit',async({page})=>{
  const state=await sandbox(page);await page.goto('/');await expect(page.locator('#cloudStatus')).toContainText('点击登录');await page.locator('#cloudStatus').click();await page.locator('#loginEmail').fill(user.email);await page.locator('#sendLogin').click();await expect(page.locator('#loginError')).toContainText('登录链接已发送');expect(state.otp.body.create_user).toBe(false);expect(state.otp.redirect).toBe('http://127.0.0.1:4173/');
  await login(page);await page.reload();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');await page.locator('#signOutButton').click();await expect(page.locator('#cloudStatus')).toContainText('点击登录');await page.reload();await expect(page.locator('#cloudStatus')).toContainText('点击登录');expect(state.blocked).toEqual([]);
});
test('expired remembered session refreshes through SDK rather than using stale access token',async({page})=>{
  const state=await sandbox(page),old=session(Math.floor(Date.now()/1000)-300);await page.addInitScript(({old})=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(old)),{old});await page.goto('/');await expect(page.locator('#cloudStatus')).toContainText('已自动登录');expect(state.refreshes).toBeGreaterThan(0);
});
test('synthetic multilingual PDF extracts text and JPEG/Flate images, saves private data and restores after reload',async({page})=>{
  const state=await sandbox(page);await login(page);await upload(page);await expect(page.locator('#importPreviewRows')).toContainText('粉磨车间');await expect(page.locator('#importPreviewRows')).toContainText('第 2 页');expect(state.posts).toBe(0);
  await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();expect(state.reports).toHaveLength(2);expect(state.images).toHaveLength(4);expect(state.audits).toHaveLength(1);expect(state.objects.size).toBe(5);
  expect(state.reports.every(r=>r.id&&r.payload.provenance&&r.payload.originalObjectPath)).toBe(true);expect(state.images.every(i=>i.report_id&&i.payload.objectPath&&!i.payload.dataUrl&&!i.payload.signedUrl)).toBe(true);
  await page.getByRole('link',{name:'日报对比'}).click();await expect(page.locator('#comparisonRows')).toContainText('改善');await expect(page.locator('#comparisonRows')).toContainText('中方 +1');await expect(page.locator('#comparisonRows')).toContainText('当日工程量变化 +8');
  await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(4);await expect.poll(()=>page.locator('#imageGallery img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);expect(state.posts).toBe(3);expect(state.blocked).toEqual([]);
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
  await page.getByRole('link',{name:'日报录入'}).click();await page.locator('[data-source]').first().click();await expect(page.locator('#sourceDetails')).toContainText('synthetic-reports.pdf');await expect(page.locator('#downloadOriginal')).toBeVisible();
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
  await page.locator('#fileInput').setInputFiles(report.path);await expect(page.locator('#importSummary')).toContainText('12 条记录、11 张图片',{timeout:60000});
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
  await page.locator('#imageForm [name=caption]').fill('真实日报验收：人工确认关联，未启用外部 AI');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();expect(state.images.filter(i=>i.payload.manualReviewed)).toHaveLength(1);expect(state.images.find(i=>i.payload.manualReviewed).payload.originalAssociation.blockId).toBeTruthy();
  if(process.env.KHAYRAT_QA_SCREENSHOTS)await page.screenshot({path:`${process.env.KHAYRAT_QA_SCREENSHOTS}/${report.date}-review.png`,fullPage:false});
  const ids=state.reports.map(r=>r.id);await page.locator('#fileInput').setInputFiles(report.path);await expect(page.locator('#importSummary')).toContainText('12 条重复',{timeout:60000});await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible({timeout:60000});expect(state.reports.map(r=>r.id)).toEqual(ids);expect(state.images).toHaveLength(11);expect(state.images.filter(i=>i.payload.manualReviewed)).toHaveLength(1);
  await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#imageGallery img')).toHaveCount(11);expect(state.blocked).toEqual([]);expect(errors).toEqual([]);
});

test('vision stays disabled without approved configuration and consent; manual image correction persists cloud metadata',async({page})=>{
  const state=await sandbox(page);await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();await page.getByRole('link',{name:'图片证据'}).click();await expect(page.locator('#analyzeImages')).toBeDisabled();await page.locator('[data-open-image]').first().click();await expect(page.locator('#analyzeImage')).toBeDisabled();await page.locator('#imageForm [name=caption]').fill('SYNTHETIC REVIEW');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();expect(state.images[0].payload.manualReview.confirmed).toBe(true);expect(state.images[0].payload.confidence).toBe(0);expect(state.images[0].payload.dataUrl).toBeUndefined();await page.reload();await page.getByRole('link',{name:'图片证据'}).click();await page.locator('[data-open-image]').first().click();await expect(page.locator('#imageForm [name=caption]')).toHaveValue('SYNTHETIC REVIEW');
});

test('MOCK vision consent gates authenticated ID-only request; human correction retains model facts and saves cloud review',async({page})=>{
  const state=await sandbox(page,{visionEnabled:true});await login(page);await upload(page);await page.locator('#confirmImport').click();await expect(page.locator('#importDialog')).not.toBeVisible();await page.getByRole('link',{name:'图片证据'}).click();await page.locator('[data-open-image]').first().click();await page.locator('#analyzeImage').click();await expect(page.locator('#toast')).toContainText('传输授权');expect(state.visionCalls).toHaveLength(0);await page.locator('#closeImageDialog').click();await page.locator('#visionConsent').check();await page.locator('[data-open-image]').first().click();await page.locator('#analyzeImage').click();await expect(page.locator('#imageVisibleFacts')).toContainText('SYNTHETIC: visible rebar');expect(state.visionCalls).toHaveLength(1);expect(state.visionCalls[0].body).toEqual({imageId:state.images[0].image_id,consent:true});expect(state.visionCalls[0].authorization).toContain('Bearer ');expect(state.images[0].payload.manualReviewed).toBe(false);await page.locator('#imageForm [name=reviewedVisibleFacts]').fill('人工确认：模板');await page.locator('#imageForm [type=submit]').click();await expect(page.locator('#imageDialog')).not.toBeVisible();expect(state.images[0].payload.visibleFacts).toEqual(['人工确认：模板']);expect(state.images[0].payload.automaticAnalysis.visibleFacts).toEqual(['SYNTHETIC: visible rebar']);expect(state.images[0].payload.manualReview.confirmed).toBe(true);expect(state.images[0].payload.confidence).toBe(.7);
});
