const finite=value=>Number.isFinite(value);
const html=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const valueLabel=value=>finite(value)?`${value.toFixed(1)}%`:'缺失';

export function renderProgressChart(points){
  if(!points.length)return '<div class="mini-empty">无可用时间序列</div>';
  const width=700,height=270,padLeft=46,padRight=52,padTop=18,padBottom=42,plotHeight=height-padTop-padBottom;
  const monthlyMax=Math.max(1,...points.flatMap(point=>[point.plannedMonthly,point.actualMonthly].filter(finite))),rightMax=Math.ceil(monthlyMax/5)*5;
  const step=(width-padLeft-padRight)/Math.max(1,points.length),x=index=>padLeft+step*(index+.5),y=value=>padTop+(100-value)/100*plotHeight,yMonthly=value=>padTop+(rightMax-value)/rightMax*plotHeight;
  const path=key=>{let connected=false;return points.map((point,index)=>{if(!finite(point[key])){connected=false;return '';}const command=connected?'L':'M';connected=true;return `${command}${x(index)},${y(point[key])}`;}).join(' ');};
  const horizontal=[0,25,50,75,100].map(value=>`<line x1="${padLeft}" y1="${y(value)}" x2="${width-padRight}" y2="${y(value)}"/><text class="axis-label" x="2" y="${y(value)+3}">${value}%</text>`).join('');
  const rightTicks=[0,.25,.5,.75,1].map(factor=>{const value=rightMax*factor;return `<text class="axis-label right-axis" x="${width-2}" y="${yMonthly(value)+3}" text-anchor="end">${Number(value.toFixed(1))}%</text>`;}).join('');
  const vertical=points.map((point,index)=>`<line class="date-grid" x1="${x(index)}" y1="${padTop}" x2="${x(index)}" y2="${height-padBottom}"/>`).join('');
  const barWidth=Math.min(18,step*.26),bars=points.map((point,index)=>{
    const date=html(point.date),bottom=height-padBottom;
    return [['plannedMonthly','monthly-plan',-barWidth],['actualMonthly','monthly-actual',0]].map(([key,cls,offset])=>finite(point[key])?`<rect class="${cls}" x="${x(index)+offset}" y="${yMonthly(point[key])}" width="${barWidth}" height="${Math.max(0,bottom-yMonthly(point[key]))}"><title>${date} · ${key==='plannedMonthly'?'月度计划增量':'月度实际增量'} ${valueLabel(point[key])}</title></rect>`:'').join('');
  }).join('');
  const dots=points.map((point,index)=>['planned','actual'].map(key=>finite(point[key])?`<circle class="${key}-dot" cx="${x(index)}" cy="${y(point[key])}" r="3"><title>${html(point.date)} · ${key==='planned'?'计划累计':'实际累计'} ${valueLabel(point[key])}</title></circle>`:'').join('')).join('');
  const labels=points.map((point,index)=>`<text class="date-label" x="${x(index)}" y="${height-12}" text-anchor="middle">${html(point.date.slice(2,4)+'/'+point.date.slice(5,7))}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="累计进度左轴0至100%，月度增量右轴按最大月度值自动定标；柱高与月度百分比线性成比例"><g class="grid-lines">${horizontal}${vertical}</g>${rightTicks}${bars}<path class="plan-line" d="${path('planned')}"/><path class="actual-line" d="${path('actual')}"/>${dots}${labels}</svg>`;
}
