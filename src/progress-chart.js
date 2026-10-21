const finite=value=>Number.isFinite(value);
const html=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const valueLabel=value=>finite(value)?`${value.toFixed(1)}%`:'缺失';
const lastFiniteIndex=(points,key)=>{for(let index=points.length-1;index>=0;index--)if(finite(points[index][key]))return index;return -1;};

export function renderProgressChart(points){
  if(!points.length)return '<div class="mini-empty">无可用时间序列</div>';
  const width=800,height=390,padLeft=62,padRight=72,padTop=48,padBottom=66,plotHeight=height-padTop-padBottom;
  const cumulativeMax=Math.max(100,...points.flatMap(point=>[point.planned,point.actual].filter(finite))),leftMax=cumulativeMax>100?Math.ceil(cumulativeMax/25)*25:100;
  const monthlyMax=Math.max(0,...points.flatMap(point=>[point.plannedMonthly,point.actualMonthly].filter(finite))),rightMax=Math.max(40,Math.ceil(monthlyMax/10)*10);
  const step=(width-padLeft-padRight)/Math.max(1,points.length),x=index=>padLeft+step*(index+.5),y=value=>padTop+(leftMax-value)/leftMax*plotHeight,yMonthly=value=>padTop+(rightMax-value)/rightMax*plotHeight;
  const path=key=>{let connected=false;return points.map((point,index)=>{if(!finite(point[key])){connected=false;return '';}if(key==='actual'&&point.actualAsOf&&point.actualAsOf!==point.date){connected=false;return '';}const command=connected?'L':'M';connected=true;return `${command}${x(index)},${y(point[key])}`;}).join(' ');};
  const horizontal=Array.from({length:6},(_,index)=>leftMax*index/5).map(value=>`<line x1="${padLeft}" y1="${y(value)}" x2="${width-padRight}" y2="${y(value)}"/><text class="axis-label left-axis" x="${padLeft-9}" y="${y(value)+4}" text-anchor="end">${Number(value.toFixed(1))}%</text>`).join('');
  const rightTicks=Array.from({length:5},(_,index)=>rightMax*index/4).map(value=>`<text class="axis-label right-axis" x="${width-padRight+9}" y="${yMonthly(value)+4}">${Number(value.toFixed(1))}%</text>`).join('');
  const dateStride=Math.max(1,Math.ceil(points.length/7)),dateIndexes=new Set(points.map((_,index)=>index).filter(index=>index%dateStride===0));dateIndexes.add(points.length-1);dateIndexes.add(lastFiniteIndex(points,'actual'));
  const vertical=points.map((point,index)=>dateIndexes.has(index)?`<line class="date-grid" x1="${x(index)}" y1="${padTop}" x2="${x(index)}" y2="${height-padBottom}"/>`:'').join('');
  const barWidth=Math.min(17,step*.28),bars=points.map((point,index)=>{
    const date=html(point.date),bottom=height-padBottom;
    return [['plannedMonthly','monthly-plan',-barWidth,'月度计划增量'],['actualMonthly','monthly-actual',0,'月度实际增量']].map(([key,cls,offset,label])=>finite(point[key])?`<rect class="${cls}" x="${x(index)+offset}" y="${yMonthly(point[key])}" width="${barWidth}" height="${Math.max(0,bottom-yMonthly(point[key]))}"><title>${date} · ${label} ${valueLabel(point[key])}</title></rect>`:'').join('');
  }).join('');
  // A weekly partial-month cumulative is drawn distinctly at the month bucket:
  // it is not a same-date comparison with the Excel end-of-month planned point.
  const isPartial=point=>Boolean(point.actualAsOf&&point.actualAsOf!==point.date&&finite(point.actual));
  const partialLinks=points.map((point,index)=>{
    if(!isPartial(point)||!index)return '';
    let previous=index-1;while(previous>=0&&!finite(points[previous].actual))previous--;
    return previous<0?'':`<line class="actual-line" stroke-dasharray="5 5" x1="${x(previous)}" y1="${y(points[previous].actual)}" x2="${x(index)}" y2="${y(point.actual)}"><title>实绩截至 ${html(point.actualAsOf)}；不与本月月末计划比较</title></line>`;
  }).join('');
  const dots=points.map((point,index)=>['planned','actual'].map(key=>{
    if(!finite(point[key]))return '';
    const partial=key==='actual'&&isPartial(point),date=partial?point.actualAsOf:point.date;
    return `<circle class="${key}-dot${partial?' partial-actual-dot':''}" cx="${x(index)}" cy="${y(point[key])}" r="${partial?6:4}" ${partial?'stroke-dasharray="2 2"':''}><title>${html(date)} · ${key==='planned'?'月末计划累计':'实际累计'} ${valueLabel(point[key])}${partial?'；月中统计与本月月末计划不同期，不计算偏差':''}</title></circle>`;
  }).join('')).join('');
  const planLast=lastFiniteIndex(points,'planned'),actualLast=lastFiniteIndex(points,'actual'),curveLabels=[['planned',planLast],['actual',actualLast]].map(([key,index])=>{if(index<0)return '';const point=points[index],sameX=planLast===actualLast&&planLast>=0,close=sameX&&finite(points[index].planned)&&finite(points[index].actual)&&Math.abs(y(points[index].planned)-y(points[index].actual))<24,offset=key==='planned'?-12:(close?22:17),shift=close?(key==='planned'?-8:8):0,anchor=close?(key==='planned'?'end':'start'):'middle';return `<text class="data-label cumulative-data ${key}-data" x="${x(index)+shift}" y="${Math.max(padTop+12,Math.min(height-padBottom-8,y(point[key])+offset))}" text-anchor="${anchor}">${point[key].toFixed(1)}%${key==='actual'&&isPartial(point)?'（'+html(point.actualAsOf.slice(5).replace('-','/'))+'）':''}</text>`;}).join('');
  const dates=points.map((point,index)=>`<text class="date-label" x="${x(index)}" y="${height-24}" text-anchor="middle">${dateIndexes.has(index)?html(point.date.slice(2,4)+'/'+point.date.slice(5,7)):''}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="计划与实际进度。累计进度使用左轴，月度增量使用右轴；两轴均从零开始并按真实百分比线性映射"><desc>左轴累计范围 0 至 ${leftMax}%，右轴月度范围 0 至 ${rightMax}%。${rightMax===40?'20% 在右轴约为图表半高。':''}月中周报累计为虚线连接的独立标记，与月末计划不同时点，不能直接相减。仅直接标注累计曲线最新值，所有折线点和柱形均可悬停读取真实数据。</desc><g class="grid-lines">${horizontal}${vertical}</g>${rightTicks}<text class="axis-title" x="${padLeft}" y="19">累计进度 · 左轴</text><text class="axis-title right-title" x="${width-padRight}" y="19" text-anchor="end">月度增量 · 右轴（0–${rightMax}%）</text>${bars}<path class="plan-line" d="${path('planned')}"/><path class="actual-line" d="${path('actual')}"/>${partialLinks}${dots}${curveLabels}${dates}</svg>`;
}

