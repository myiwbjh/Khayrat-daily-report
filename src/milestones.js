export const DEFAULT_MILESTONES=[
 {id:'00000000-0000-4000-8000-000000000101',name:'实际现场施工起点',date:'2026-03-01',datePrecision:'month',description:'',sortOrder:10,circleColor:'#168b82',beforeLineStyle:'solid',beforeLineColor:'#168b82',afterLineStyle:'solid',afterLineColor:'#168b82'},
 {id:'00000000-0000-4000-8000-000000000102',name:'合同工期起算',date:'2026-09-07',datePrecision:'day',description:'',sortOrder:20,circleColor:'#4c7fa0',beforeLineStyle:'solid',beforeLineColor:'#168b82',afterLineStyle:'dashed',afterLineColor:'#bdc8cc'},
 {id:'00000000-0000-4000-8000-000000000103',name:'主要设备安装目标',date:'2026-12-01',datePrecision:'month',description:'',sortOrder:30,circleColor:'#e89245',beforeLineStyle:'dashed',beforeLineColor:'#bdc8cc',afterLineStyle:'dashed',afterLineColor:'#bdc8cc'}
];
const hex=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:'#168b82';
export function normalizeMilestone(value={}){
 const date=/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')?value.date:'';
 return {id:value.id||crypto.randomUUID(),name:String(value.name||'').trim().slice(0,120),date,datePrecision:value.datePrecision==='month'?'month':'day',description:String(value.description||'').trim().slice(0,500),sortOrder:Math.max(0,Math.min(100000,Number(value.sortOrder)||0)),circleColor:hex(value.circleColor),beforeLineStyle:value.beforeLineStyle==='dashed'?'dashed':'solid',beforeLineColor:hex(value.beforeLineColor),afterLineStyle:value.afterLineStyle==='dashed'?'dashed':'solid',afterLineColor:hex(value.afterLineColor)};
}
export function sortMilestones(values){return values.map(normalizeMilestone).sort((a,b)=>a.date.localeCompare(b.date)||a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,'zh-CN'));}
export function milestoneDateLabel(item,locale='zh-CN'){
 if(!item.date)return '';
 const [year,month,day]=item.date.split('-').map(Number);
 return item.datePrecision==='month'?`${year} 年 ${month} 月`:new Intl.DateTimeFormat(locale,{timeZone:'UTC',year:'numeric',month:'long',day:'numeric'}).format(new Date(Date.UTC(year,month-1,day)));
}
