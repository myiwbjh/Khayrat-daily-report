const clean=value=>String(value||'').normalize('NFKC').replace(/[\s　]+/g,'').trim();

export const BUILTIN_WORKSHOP_ALIASES=Object.freeze([
  {alias:'空压机房',canonical:'空压机',source:'系统确认规则',note:'业主确认同义名称'},
  {alias:'水泥粉磨车间',canonical:'水泥磨',source:'系统确认规则',note:'业主确认同义名称'},
  {alias:'水泥磨车间',canonical:'水泥磨',source:'系统确认规则',note:'历史确定别名'},
  {alias:'水泥粉磨',canonical:'水泥磨',source:'系统确认规则',note:'历史确定别名'},
  {alias:'粉磨车间',canonical:'水泥磨',source:'系统确认规则',note:'历史确定别名'},
  {alias:'混合材破碎、输送及电气室',canonical:'混合材破碎及输送',source:'系统确认规则',note:'业主确认同义名称'},
  {alias:'混合材破碎,输送及电气室',canonical:'混合材破碎及输送',source:'系统确认规则',note:'标点变体'},
  {alias:'中控室',canonical:'中控楼',source:'系统确认规则',note:'历史确定别名'},
]);

const workshopRows=mappings=>(mappings||[]).filter(row=>clean(row.sourceType)==='workshop_alias'&&clean(row.targetType)==='workshop'&&clean(row.sourceValue));
export function workshopAliasEntries(mappings=[]){
  const manual=workshopRows(mappings).map(row=>({alias:clean(row.sourceValue),canonical:clean(row.targetValue)||clean(row.sourceValue),relation:row.relation||'alias',source:row.sourceFile||'Editor/Admin',note:row.note||'',id:row.id,manual:true}));
  const overridden=new Set(manual.map(row=>row.alias));
  return [...manual,...BUILTIN_WORKSHOP_ALIASES.filter(row=>!overridden.has(clean(row.alias))).map(row=>({...row,alias:clean(row.alias),canonical:clean(row.canonical),relation:'alias',manual:false}))];
}

export function standardWorkshop(value,mappings=[]){
  let name=clean(value);if(!name)return '';
  const entries=workshopAliasEntries(mappings),seen=new Set();
  while(name&&!seen.has(name)){
    seen.add(name);const row=entries.find(item=>item.alias===name);
    if(!row||row.relation==='distinct')break;
    name=row.canonical||name;
  }
  return name;
}

export function workshopAliasAudit({records=[],images=[],progress=[],shipments=[],mappings=[]}={}){
  const occurrences=[];
  const add=(name,source,ref)=>{const original=clean(name);if(original)occurrences.push({original,canonical:standardWorkshop(original,mappings),source,ref});};
  for(const row of records)add(row.workshop,row.sourceType==='weekly-report'?'周报':'日报',row.id||row.sourceFile);
  for(const row of images)add(row.relatedWorkshop,'照片',row.imageId||row.sourceFile);
  for(const row of shipments)add(row.installationArea,'设备安装区域',row.id||row.sourceFile);
  for(const row of progress)for(const field of ['workshop','item','discipline'])add(row[field],'WBS',row.id||row.sourceFile);
  const merged=occurrences.filter(row=>row.original!==row.canonical),groups=new Map();
  for(const row of occurrences){const key=row.canonical;if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(row.original);}
  const names=[...new Set(occurrences.map(row=>row.original))],stem=value=>clean(value).replace(/[、，,]/g,'').replace(/(生产)?车间|机房|工房|厂房|电气室|区域/g,'').replace(/[及和与]/g,''),pending=[];
  for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
    const a=names[i],b=names[j];if(standardWorkshop(a,mappings)===standardWorkshop(b,mappings))continue;
    const x=stem(a),y=stem(b);if(x.length<2||y.length<2)continue;
    if(x===y||x.includes(y)||y.includes(x))pending.push({left:a,right:b,leftSources:[...new Set(occurrences.filter(row=>row.original===a).map(row=>row.source))],rightSources:[...new Set(occurrences.filter(row=>row.original===b).map(row=>row.source))]});
  }
  return {occurrences,mergedOccurrences:merged.length,mergedNames:new Set(merged.map(row=>row.original)).size,groups:[...groups].filter(([,values])=>values.size>1).map(([canonical,values])=>({canonical,names:[...values]})),pending};
}

export function latestWorkshopStates(records,mappings=[]){const groups=new Map();for(const r of records){if(r.recordType==='personnel-summary'||r.sourceType==='weekly-report'&&r.recordType!=='weekly-workshop-status'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')||r.reviewFields?.some(f=>['date','workshop'].includes(f)))continue;const name=standardWorkshop(r.workshop,mappings);if(!name)continue;let group=groups.get(name);if(!group||r.date>group.date){group={workshop:name,date:r.date,rows:[]};groups.set(name,group);}if(r.date===group.date)group.rows.push(r);}return [...groups.values()].sort((a,b)=>a.workshop.localeCompare(b.workshop)).map(({workshop,date,rows})=>{const unique=field=>[...new Set(rows.flatMap(r=>Array.isArray(r[field])?r[field]:[r[field]]).map(x=>String(x||'').trim()).filter(Boolean))];return {workshop,date,processes:unique('process'),activities:unique('constructionContent'),statuses:unique('status'),recordIds:rows.map(r=>r.id)};});}
