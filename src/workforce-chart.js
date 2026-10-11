const finite=value=>Number.isFinite(value);
const dayGap=(before,after)=>before&&after&&(Date.parse(after)-Date.parse(before))/86400000>1;
const html=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function renderWorkforceChart(points,{limit=12}={}){
 const rows=[...points].sort((a,b)=>a.date.localeCompare(b.date)).slice(-limit);
 if(!rows.length)return '<div class="mini-empty">暂无人员数据</div>';
 const width=700,height=210,padX=34,padTop=24,padBottom=35,plotHeight=height-padTop-padBottom;
 const max=Math.max(1,...rows.flatMap(row=>[row.total,finite(row.chinese)&&finite(row.local)?row.chinese+row.local:null].filter(finite)));
 const step=(width-padX*2)/Math.max(1,rows.length),barWidth=Math.min(34,step*.58),x=index=>padX+step*(index+.5),y=value=>padTop+(max-value)/max*plotHeight;
 let path='',connected=false,previousDate='';
 for(const [index,row] of rows.entries()){
   if(!finite(row.total)||dayGap(previousDate,row.date)){connected=false;previousDate=row.date;if(!finite(row.total))continue;}
   path+=`${connected?'L':'M'}${x(index)},${y(row.total)} `;connected=true;previousDate=row.date;
 }
 const grid=[0,.25,.5,.75,1].map(ratio=>{const value=Math.round(max*ratio),gy=y(value);return `<line x1="${padX}" y1="${gy}" x2="${width-padX}" y2="${gy}"/><text x="2" y="${gy+3}">${value}</text>`;}).join('');
 const bars=rows.map((row,index)=>{const bx=x(index)-barWidth/2,parts=[];let base=height-padBottom;for(const [key,cls] of [['chinese','cn'],['local','local']])if(finite(row[key])){const h=row[key]/max*plotHeight;base-=h;parts.push(`<rect class="${cls}" x="${bx}" y="${base}" width="${barWidth}" height="${h}"><title>${html(row.date)} · ${key==='chinese'?'中方':'伊拉克本地'} ${row[key]}${row.needsReview?' · 待复核':''}</title></rect>`);}return parts.join('');}).join('');
 const totals=rows.map((row,index)=>finite(row.total)?`<circle class="total-dot${row.needsReview?' review':''}" cx="${x(index)}" cy="${y(row.total)}" r="3.5"><title>${html(row.date)} · 总人数 ${row.total}${row.needsReview?' · 待复核':''}</title></circle><text class="total-label" x="${x(index)}" y="${Math.max(10,y(row.total)-7)}" text-anchor="middle">${row.total}${row.needsReview?'⚠':''}</text>`:'').join('');
 const labels=rows.map((row,index)=>`<text class="date-label" x="${x(index)}" y="${height-10}" text-anchor="middle">${html(row.date.slice(5))}</text>`).join('');
 const review=rows.some(row=>row.needsReview)?'<p class="workforce-review">⚠ 人员数据待复核；图中保留原日报数值，缺失值未按 0 处理。</p>':'';
 return `<svg class="workforce-combo" viewBox="0 0 ${width} ${height}" role="img" aria-label="中方与伊拉克本地人员堆叠柱状图及总人数趋势线"><g class="grid-lines">${grid}</g>${bars}<path class="total-line" d="${path.trim()}"/>${totals}${labels}</svg><div class="staff-legend"><i></i>中方人员 <i></i>伊拉克本地人员 <i></i>总人数</div>${review}`;
}
