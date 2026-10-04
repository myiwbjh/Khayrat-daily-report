import { withProvenance } from './report-model.js';
import { normalizeRows } from './analytics.js';
import { analyzeImageMetadata } from './image-analysis.js';
import { businessKey } from './storage.js';

const latin = new TextDecoder('latin1');
const utf8 = new TextDecoder();
function unescapePDF(value) { return value.replace(/\\([nrtbf()\\])/g,(_,c)=>({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[c]||c)).replace(/\\\r?\n/g,'').replace(/\\([0-7]{1,3})/g,(_,n)=>String.fromCharCode(parseInt(n,8))); }
function textOperators(content) { const chunks=[]; for(const block of content.matchAll(/BT([\s\S]*?)ET/g)){for(const token of block[1].matchAll(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g)){if(token[0][0]==='(')chunks.push(unescapePDF(token[0].slice(1,-1)));else if(token[1]){const bytes=token[1].replace(/\s/g,'').match(/.{1,2}/g)?.map(x=>parseInt(x,16))||[];chunks.push(utf8.decode(new Uint8Array(bytes)));}}}return chunks.join(' ').replace(/\s+/g,' ').trim(); }
async function streamData(object) { const marker=/stream\r?\n/.exec(object.raw); if(!marker)return null;const start=marker.index+marker[0].length,end=object.raw.lastIndexOf('endstream');let bytes=object.bytes.slice(start,end);if(/\/FlateDecode/.test(object.dict)){try{const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));bytes=new Uint8Array(await new Response(stream).arrayBuffer());}catch{return null;}}return bytes; }
const PDF_LABELS={
  reportName:['日报名称','Report Name'], date:['日期','报告日期','Date','Report Date'], workshop:['车间','Workshop','Area'], process:['工序','Process','Activity'],
  constructionContent:['施工内容','Construction Content','Work Description'], activityId:['活动编号','Activity ID'],
  plannedProgress:['计划进度','Planned Progress'],actualProgress:['实际进度','Actual Progress'],dailyConcrete:['当日混凝土','实际完成工作量','完成工程量','Daily Concrete','Daily Quantity'],cumulativeConcrete:['累计混凝土','累计完成量','Cumulative Concrete','Cumulative Quantity'],
  workUnit:['工作量单位','单位','Unit'], staffScope:['人员口径','Staff Scope'],chineseStaff:['中方人员','Chinese Staff'],localStaff:['属地人员','Local Staff'],equipmentName:['设备名称','Equipment'],equipmentStatus:['设备状态','设备到货情况','Equipment Status'],risk:['风险制约','制约因素','存在问题','Risk','Constraint','Issues'],status:['工作状态','施工状态','Status']
};
const labels=Object.entries(PDF_LABELS).flatMap(([field,names])=>names.map(label=>({field,label}))).sort((a,b)=>b.label.length-a.label.length);
const escapeRE=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Tokenize labels once: "Equipment Status" must not become a construction "Status".
export function mapPDFText(text,meta={}) {
  if(!text.trim())return [];
  const expression=new RegExp(`(?:^|[\\s|;；])(${labels.map(x=>escapeRE(x.label)).join('|')})\\s*[:：]\\s*`,'gi');
  const matches=[...text.matchAll(expression)], row={'原始记录':text}, repeated=new Set();
  for(let index=0;index<matches.length;index++){
    const match=matches[index],field=labels.find(x=>x.label.toLowerCase()===match[1].toLowerCase()).field;
    if(Object.hasOwn(row,field)){repeated.add(field);continue;}
    row[field]=text.slice(match.index+match[0].length,matches[index+1]?.index??text.length).split(/[|;；\n]/)[0].trim();
  }
  // Use canonical aliases to pass through the same structured normalizer.
  const aliases={reportName:'report_name',constructionContent:'construction_content',plannedProgress:'planned_progress',actualProgress:'actual_progress',dailyConcrete:'daily_quantity',cumulativeConcrete:'cumulative_quantity',workUnit:'work_unit',staffScope:'staff_scope',chineseStaff:'chinese_staff',localStaff:'local_staff',equipmentName:'equipment_name',equipmentStatus:'equipment_status',activityId:'activity_id'};
  const normalized=Object.fromEntries(Object.entries(row).map(([key,value])=>[aliases[key]||key,value]));
  return normalizeRows([normalized],meta.sourceFile,{allowIncomplete:true}).map(record=>withProvenance({...record,sourceType:'pdf',sourceFile:meta.sourceFile,pageNumber:meta.pageNumber,sourceRow:null,sourceExcerpt:text,extractionMethod:meta.extractionMethod||'built-in-text',reviewFields:[...(record.reviewFields||[]),...repeated]},meta));
}
function tableRows(text,meta){const lines=text.split(/\n|\r/).map(x=>x.trim()).filter(Boolean),result=[];for(let i=0;i<lines.length-1;i++){const headers=lines[i].split(/\s*\|\s*|\t+/),values=lines[i+1].split(/\s*\|\s*|\t+/);if(headers.length>=3&&headers.length===values.length&&headers.some(x=>/日期|Date/i.test(x)))result.push(...normalizeRows([Object.fromEntries(headers.map((h,j)=>[h,values[j]]))],meta.sourceFile).map(r=>({...r,sourceType:'pdf',sourceFile:meta.sourceFile,pageNumber:meta.pageNumber,sourceExcerpt:lines.slice(i,i+2).join('\n')})));}return result;}
function hash(text){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(36);}
function dataURL(bytes,mime){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return `data:${mime};base64,${btoa(binary)}`;}

export async function parsePDF(buffer, sourceFile='report.pdf') {
  const bytes=new Uint8Array(buffer),raw=latin.decode(bytes);if(!raw.startsWith('%PDF-'))throw new Error('不是有效的 PDF 文件');const objects=new Map();for(const m of raw.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)){const full=m[0],body=m[2],start=m.index+full.indexOf(body);objects.set(Number(m[1]),{id:Number(m[1]),raw:body,dict:body.slice(0,body.indexOf('stream')>=0?body.indexOf('stream'):body.length),bytes:bytes.slice(start,start+body.length)});}
  const pages=[...objects.values()].filter(o=>/\/Type\s*\/Page\b/.test(o.dict)).sort((a,b)=>a.id-b.id),records=[],images=[];let imageIndex=0;
  for(let p=0;p<pages.length;p++){const page=pages[p],refs=[...page.dict.matchAll(/\/Contents\s+(\d+)\s+\d+\s+R|\/Contents\s*\[([^\]]+)\]/g)].flatMap(m=>m[1]?[Number(m[1])]:[...(m[2]||'').matchAll(/(\d+)\s+\d+\s+R/g)].map(x=>Number(x[1])));let text='';for(const ref of refs){const obj=objects.get(ref),data=obj&&await streamData(obj);if(data)text+=' '+textOperators(latin.decode(data));}const meta={sourceFile,pageNumber:p+1};let pageRecords=tableRows(text,meta);if(!pageRecords.length)pageRecords=mapPDFText(text,meta);records.push(...pageRecords);
    const resourceRefs=new Set([...page.raw.matchAll(/\/\w+\s+(\d+)\s+\d+\s+R/g)].map(m=>Number(m[1])));for(const resourceId of [...resourceRefs]){const res=objects.get(resourceId);if(res&&!/\/Subtype\s*\/Image/.test(res.dict))for(const m of res.raw.matchAll(/\/\w+\s+(\d+)\s+\d+\s+R/g))resourceRefs.add(Number(m[1]));}
    for(const ref of resourceRefs){const image=objects.get(ref);if(!image||!/\/Subtype\s*\/Image/.test(image.dict))continue;const data=await streamData(image);if(!data)continue;const mime=/\/DCTDecode/.test(image.dict)?'image/jpeg':/\/JPXDecode/.test(image.dict)?'image/jp2':'';if(!mime)continue;imageIndex++;const related={},base={imageId:`pdf-${hash(`${sourceFile}|${p+1}|${imageIndex}|${ref}`)}`,sourceFile,pageNumber:p+1,imageIndex,relatedDate:related.date||'',relatedWorkshop:related.workshop||'',relatedProcess:related.process||'',relatedRecordKey:related.date?businessKey(related):'',caption:'',nearbyText:'',association:{status:'unassociated',reason:'基础解析器没有布局坐标，禁止整页文字关联'},tags:[],aiSummary:'',evidenceType:'直接证据',confidence:1,manualReviewed:false,ignored:false,dataUrl:dataURL(data,mime),mimeType:mime};images.push({...base,...analyzeImageMetadata(base),directEvidence:'PDF 嵌入图片'});}
  }
  return {records,images,diagnostics:{pageCount:pages.length,textPages:records.length,imageCount:images.length,warnings:records.length?[]:['未识别到可映射的日报字段；可在导入后人工录入或修正。']}};
}

export async function parsePDFDocument(buffer, sourceFile='report.pdf', options={}) {
  try {
    const {parseWithPDFJS}=await import('./pdfjs-adapter.js');
    return await parseWithPDFJS(buffer,sourceFile,options);
  } catch(error){
    const fallback=await parsePDF(buffer,sourceFile);
    return {...fallback,records:fallback.records.map(r=>withProvenance({...r,reviewFields:[...new Set([...(r.reviewFields||[]),'textExtraction'])]})),diagnostics:{...fallback.diagnostics,engine:'built-in fallback',warnings:[...fallback.diagnostics.warnings,`PDF.js 解析失败，已降级；文字和图片需人工核对：${error.message}`]}};
  }
}
