const finite=value=>Number.isFinite(value);
const html=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const valueLabel=value=>finite(value)?`${value.toFixed(1)}%`:'缺失';
const lastFiniteIndex=(points,key)=>{for(let index=points.length-1;index>=0;index--)if(finite(points[index][key]))return index;return -1;};

export function renderProgressChart(points){
  if(!points.length)return '<div class="mini-empty">无可用时间序列</div>';
  const width=760,height=340,padLeft=58,padRight=66,padTop=38,padBottom=58,plotHeight=height-padTop-padBottom;
  const cumulativeMax=Math.max(100,...points.flatMap(point=>[point.planned,point.actual].filter(finite))),leftMax=cumulativeMax>100?Math.ceil(cumulativeMax/25)*25:100;
  const monthlyMax=Math.max(0,...points.flatMap(point=>[point.plannedMonthly,point.actualMonthly].filter(finite))),rightMax=Math.max(40,Math.ceil(monthlyMax/10)*10);
  const step=(width-padLeft-padRight)/Math.max(1,points.length),x=index=>padLeft+step*(index+.5),y=value=>padTop+(leftMax-value)/leftMax*plotHeight,yMonthly=value=>padTop+(rightMax-value)/rightMax*plotHeight;
  const path=key=>{let connected=false;return points.map((point,index)=>{if(!finite(point[key])){connected=false;return '';}const command=connected?'L':'M';connected=true;return `${command}${x(index)},${y(point[key])}`;}).join(' ');};
  const horizontal=Array.from({length:6},(_,index)=>leftMax*index/5).map(value=>`<line x1="${padLeft}" y1="${y(value)}" x2="${width-padRight}" y2="${y(value)}"/><text class="axis-label left-axis" x="${padLeft-9}" y="${y(value)+4}" text-anchor="end">${Number(value.toFixed(1))}%</text>`).join('');
  const rightTicks=Array.from({length:5},(_,index)=>rightMax*index/4).map(value=>`<text class="axis-label right-axis" x="${width-padRight+9}" y="${yMonthly(value)+4}">${Number(value.toFixed(1))}%</text>`).join('');
  const vertical=points.map((point,index)=>`<line class="date-grid" x1="${x(index)}" y1="${padTop}" x2="${x(index)}" y2="${height-padBottom}"/>`).join('');
  const labelIndexes=new Set(points.length<=8?points.map((_,index)=>index):points.map((_,index)=>index).filter(index=>index%2===0));
  labelIndexes.add(points.length-1);labelIndexes.add(lastFiniteIndex(points,'actual'));
  const barWidth=Math.min(17,step*.28),bars=points.map((point,index)=>{
    const date=html(point.date),bottom=height-padBottom;
    return [['plannedMonthly','monthly-plan',-barWidth,'月度计划增量'],['actualMonthly','monthly-actual',0,'月度实际增量']].map(([key,cls,offset,label])=>finite(point[key])?`<rect class="${cls}" x="${x(index)+offset}" y="${yMonthly(point[key])}" width="${barWidth}" height="${Math.max(0,bottom-yMonthly(point[key]))}"><title>${date} · ${label} ${valueLabel(point[key])}</title></rect>${labelIndexes.has(index)?`<text class="data-label monthly-data ${cls}-label" x="${x(index)+(key==='plannedMonthly'?-3:3)}" y="${Math.max(padTop+10,yMonthly(point[key])-6)}" text-anchor="${key==='plannedMonthly'?'end':'start'}">${point[key].toFixed(1)}</text>`:''}`:'').join('');
  }).join('');
  const dots=points.map((point,index)=>['planned','actual'].map(key=>finite(point[key])?`<circle class="${key}-dot" cx="${x(index)}" cy="${y(point[key])}" r="4"><title>${html(point.date)} · ${key==='planned'?'计划累计':'实际累计'} ${valueLabel(point[key])}</title></circle>`:'').join('')).join('');
  const curveLabels=points.map((point,index)=>labelIndexes.has(index)?['planned','actual'].map(key=>finite(point[key])?`<text class="data-label cumulative-data ${key}-data" x="${x(index)}" y="${Math.max(padTop+11,Math.min(height-padBottom-8,y(point[key])+(key==='planned'?-10:17)))}" text-anchor="middle">${point[key].toFixed(1)}%</text>`:'').join(''):'').join('');
  const dates=points.map((point,index)=>`<text class="date-label" x="${x(index)}" y="${height-19}" text-anchor="middle">${points.length<=10||index%2===0||index===points.length-1?html(point.date.slice(2,4)+'/'+point.date.slice(5,7)):''}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="计划与实际进度。累计进度使用左轴，月度增量使用右轴；两轴均从零开始并按真实百分比线性映射"><desc>左轴累计范围 0 至 ${leftMax}%，右轴月度范围 0 至 ${rightMax}%。${rightMax===40?'20% 在右轴约为图表半高。':''}所有数据点可悬停读取，关键点直接标注。</desc><g class="grid-lines">${horizontal}${vertical}</g>${rightTicks}<text class="axis-title" x="${padLeft}" y="15">累计进度 · 左轴</text><text class="axis-title right-title" x="${width-padRight}" y="15" text-anchor="end">月度增量 · 右轴（0–${rightMax}%）</text>${bars}<path class="plan-line" d="${path('planned')}"/><path class="actual-line" d="${path('actual')}"/>${dots}${curveLabels}${dates}</svg>`;
}

