import {test,expect} from '@playwright/test';
const users=[1,2].map(n=>({id:`00000000-0000-4000-8000-00000000000${n}`,aud:'authenticated',role:'authenticated',email:`qa${n}@example.test`,email_confirmed_at:'2026-10-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{}}));
function session(user){const exp=Math.floor(Date.now()/1000)+3600;return {user,access_token:[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp})).toString('base64url'),'mock-only'].join('.'),refresh_token:'synthetic-only',expires_in:3600,expires_at:exp,token_type:'bearer'};}
async function sandbox(page){
 const state={user:users[0],tables:Object.fromEntries(['daily_reports','image_evidence','import_audits','progress_measurements','equipment_shipments','crosswalk_mappings'].map(t=>[t,[]])),posts:0,missing:false,denied:false};
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin==='http://127.0.0.1:4173'){if(url.pathname==='/api/config')return route.fulfill({json:{supabaseUrl:'https://qa.supabase.test',supabaseAnonKey:'synthetic-public',storageBucket:'test-reports',authRequired:true}});return route.continue();}
 if(url.origin!=='https://qa.supabase.test')return route.abort();
 if(url.pathname==='/auth/v1/token'){const email=req.postDataJSON().email;state.user=users.find(u=>u.email===email)||state.user;return route.fulfill({json:session(state.user)});}
 if(url.pathname==='/auth/v1/user')return route.fulfill({json:state.user});if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}});
 if(url.pathname.startsWith('/rest/v1/')){const table=url.pathname.split('/').at(-1);if(!state.tables[table])return route.fulfill({status:404,json:{code:'PGRST205',message:`public.${table} not found`}});
 const isNew=['progress_measurements','equipment_shipments','crosswalk_mappings'].includes(table);
 if(isNew&&state.denied)return route.fulfill({status:403,json:{code:'42501',message:'permission denied'}});
 if(isNew&&state.missing)return route.fulfill({status:404,json:{code:'PGRST205',message:`public.${table} not found`}});
 if(req.method()==='GET'){if(url.searchParams.get('order')!==(table==='image_evidence'?'image_id':'id'))return route.fulfill({status:400,json:{code:'42703',message:'invalid ordering'}});return route.fulfill({json:state.user.id===users[0].id?state.tables[table]:[]});}
 if(state.user.id!==users[0].id)return route.fulfill({status:403,json:{code:'42501',message:'not member'}});
 state.posts++;const key=table==='image_evidence'?'image_id':table==='import_audits'?'import_id':'id';for(const row of [req.postDataJSON()].flat()){const index=state.tables[table].findIndex(r=>r[key]===row[key]);if(index<0)state.tables[table].push(row);else state.tables[table][index]=row;}return route.fulfill({json:{}});
 }
 return route.fulfill({status:404,json:{message:'unexpected mock endpoint'}});
 });return state;
}
async function login(page,user=users[0]){await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-app-ready','true');await expect(page.locator('#cloudStatus')).toContainText('点击登录');await page.locator('#cloudStatus').click();await page.locator('#passwordEmail').fill(user.email);await page.locator('#loginPassword').fill('synthetic-test-password');await page.locator('#passwordLogin').click();await expect(page.locator('#loginDialog')).not.toBeVisible();await expect(page.locator('#cloudStatus')).toContainText('已自动登录');}
async function csv(page,id,name,content,count){await page.locator(id).setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(content)});await expect(page.locator(count)).not.toHaveText('0 条');}
const progress='WBS,分部分项,权重,月份,计划累计完成比例,实际累计完成比例\nCIV,磨机基础,60,2026-09,50,40\nELE,电气,40,2026-09,20,10\nCIV,磨机基础,60,2026-11,80,75\nELE,电气,40,2026-11,60,50';
test('multi-source import restores on reload, uses weighted S Curve, typed alerts and leaves legacy reports unchanged',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const state=await sandbox(page);state.tables.daily_reports=[{id:'old-report',project_id:'khayrat',payload:{id:'old-report',date:'2026-09-30',workshop:'旧车间',process:'旧工序',rawRecord:'unchanged legacy text'}}];const old=JSON.stringify(state.tables.daily_reports);await login(page);
 await csv(page,'#progressInput','wbs.csv',progress,'#progressCount');await expect(page.locator('#plannedKpi')).toHaveText('38.0%');await expect(page.locator('#actualKpi')).toHaveText('28.0%');await expect(page.locator('#trendChart .actual-dot')).toHaveCount(1);
 await csv(page,'#shipmentInput','shipping.csv','设备类别,设备名称,Package/Lot,当前状态\nMill,磨机,B01,现场到货','#shipmentCount');
 await csv(page,'#mappingInput','mapping.csv','来源类型,来源值,目标类型,目标值\nequipment_category,Mill,wbs,CIV','#mappingCount');await expect(page.locator('#crossAnalysis')).toContainText('物流转为土建');
 const posts=state.posts;await page.reload();await expect(page.locator('#progressCount')).toHaveText('4 条');await expect(page.locator('#shipmentCount')).toHaveText('1 条');await expect(page.locator('#mappingCount')).toHaveText('1 条');await expect(page.locator('#actualKpi')).toHaveText('28.0%');await expect(page.locator('#crossAnalysis')).toContainText('物流转为土建');expect(state.posts).toBe(posts);expect(JSON.stringify(state.tables.daily_reports)).toBe(old);expect(errors).toEqual([]);
});
test('logout and another account never expose prior cache; signing back in restores the original scope',async({page})=>{
 const state=await sandbox(page);await login(page);await csv(page,'#progressInput','wbs.csv',progress,'#progressCount');await page.locator('#signOutButton').click();await expect(page.locator('#progressCount')).toHaveText('0 条');await login(page,users[1]);await expect(page.locator('#progressCount')).toHaveText('0 条');await page.reload();await expect(page.locator('#progressCount')).toHaveText('0 条');await page.locator('#signOutButton').click();await login(page,users[0]);await expect(page.locator('#progressCount')).toHaveText('4 条');expect(state.tables.progress_measurements).toHaveLength(4);
});
test('missing new tables retain scoped local cache while permission errors are surfaced',async({page})=>{
 const state=await sandbox(page);await login(page);await csv(page,'#progressInput','wbs.csv',progress,'#progressCount');state.missing=true;await page.reload();await expect(page.locator('#progressCount')).toHaveText('4 条');await expect(page.locator('#cloudStatus')).toContainText('已自动登录');state.missing=false;state.denied=true;await page.reload();await expect(page.locator('#cloudStatus')).toContainText('读取失败');await expect(page.locator('#progressCount')).toHaveText('4 条');
});

test('personnel bars grow with total headcount and missing/future WBS points are not drawn as zero',async({page})=>{
 const state=await sandbox(page);state.tables.daily_reports=[100,200].map((n,i)=>({id:`staff-${i}`,project_id:'khayrat',payload:{id:`staff-${i}`,date:`2026-09-${29+i}`,workshop:'项目汇总',process:'人员',staffScope:'项目总人数',totalStaff:n,chineseStaff:n*.6,localStaff:n*.4}}));await login(page);await page.locator('#dateFilter').fill('');await page.locator('#dateFilter').dispatchEvent('change');await expect(page.locator('#workforceChart .staff-total')).toHaveCount(2);const widths=await page.locator('#workforceChart .staff-total').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));expect(widths[1]).toBeGreaterThan(widths[0]);
 await csv(page,'#progressInput','partial.csv','WBS,权重,月份,计划累计完成比例,实际累计完成比例\nA,60,2026-09,70,40\nB,40,2026-09,70,\nA,60,2026-11,90,80\nB,40,2026-11,90,80','#progressCount');await page.locator('#progressAsOf').fill('2026-10-06');await page.locator('#progressAsOf').dispatchEvent('change');await expect(page.locator('#actualKpi')).toHaveText('—');await expect(page.locator('#trendChart .actual-dot')).toHaveCount(0);await expect(page.locator('#trendChart .actual-line')).toHaveAttribute('d',/^\s*$/);
});
