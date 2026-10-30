import {parseXLSXWorkbook} from './xlsx.js';
const text=v=>String(v??'').trim();

// Native B01/B02 workbooks have title/metadata rows, duplicated translations,
// and nested item rows. Only numbered packages in the Chinese master are counted.
export async function parsePackingWorkbook(buffer,filename=''){
 const {sheets}=await parseXLSXWorkbook(buffer);
 const masters=sheets.filter(s=>/总箱单|总装箱单/.test(s.name)&&!/英文|说明|示例/.test(s.name));
 if(!masters.length)return null;
 const result=[];
 for(const sheet of masters){
  const header=sheet.rows.findIndex(r=>r?.some(v=>text(v)==='序号')&&r.some(v=>/包装编号/.test(text(v))));
  if(header<0)continue;
  const metadata=sheet.rows.slice(0,header).flat().map(text),batch=metadata.join(' ').match(/B0[12]/i)?.[0]||filename.match(/B0[12]/i)?.[0]||'';
  const declaredRow=sheet.rows.find(r=>r?.some(v=>text(v)==='总件数')),declared=Number(declaredRow?.[2])||null;
  const packRows=sheet.rows.map((r,index)=>({r,index})).filter(({r,index})=>index>header&&/^\d+$/.test(text(r?.[0]))&&r?.some((v,i)=>i>0&&i<8&&text(v)));
  for(const {r,index} of packRows){
   const detailSources=[];
   for(const detail of sheets.filter(s=>/中文.*明细|B02.*明细/.test(s.name))){let matches=false;for(let n=0;n<detail.rows.length;n++){const line=detail.rows[n];if(!line)continue;if(/^\d+$/.test(text(line[0])))matches=text(line[0])===text(r[0])&&(text(r[2])?text(line[2]).split('/')[0]===text(r[2]).split('/')[0]:text(line[1])===text(r[1]));if(matches&&line.slice(0,8).some(v=>text(v)))detailSources.push({sheet:detail.name,row:n+1,values:line});}}
   result.push({'序号':r[0],'供应商':r[1],'Package/Lot':r[2],'设备名称':text(r[3])||text(r[4])||text(r[5]),'部件名称':r[4],'规格型号':r[6],'数量':r[7],'单位':r[8],'包装方式':r[9],'长度cm':r[10],'宽度cm':r[11],'高度cm':r[12],'体积m3':r[13],'净重Kg':r[14],'毛重Kg':r[15],'备注':r[16],'发运批次':batch,__sourceSheet:sheet.name,__sourceRow:index+1,__detailSources:detailSources,
    __packingReview:declared!==packRows.length?`原表总件数 ${declared??'未提供'}，编号箱件 ${packRows.length}，保留原值待核对`:''});
  }
 }
 return result;
}
