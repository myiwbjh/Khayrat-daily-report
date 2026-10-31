const text=value=>String(value??'').trim();
const sourceFile='伊拉克卡拉特粉磨站B01-物流服务采购需求表＆（钢材、装车机、空压机、等离子数控切割机）箱单-20260716.xls';

// Reviewed source-specific interpretation, not a general rule that blank box numbers
// are contents. Derive at read time as well, so existing records need no data rewrite.
export function shipmentPackaging(row){
 const base={kind:'outer',status:'unconfirmed',parentPackageLot:'',parentContainerNo:'',basis:'按原箱单记录计数',sources:[]};
 // Public projections carry only the derived counting category, not private
 // supplier identities, source documents or container identifiers.
 if(row.publicPackagingKind==='contents')return {...base,kind:'contents',status:'pending-confirmation',basis:'箱内设备不重复计件；装柜关系待确认，来源请登录核对'};
 if(text(row.shipmentBatch).toUpperCase()!=='B01')return base;
 // Contract + batch + original sequence identify these records even after a
 // human corrects the equipment name. Never classify other blank numbers by name.
 const sequence=text(row.packageSequence),supplier=text(row.supplier);
 const compressor=!text(row.packageLot)&&['45','46'].includes(sequence)&&supplier.includes('KLT-HT-JX16');
 const cutter=!text(row.packageLot)&&sequence==='48'&&supplier.includes('MLQ-13JXHT01-GC20250926');
 if(!compressor&&!cutter)return {...base,basis:'B01 外包装口径待确认；同号不同记录分别保留'};
 return {kind:'contents',status:'pending-confirmation',parentPackageLot:compressor?'Khayat-1':'Khayat-2',parentContainerNo:compressor?'FCIU503482-6':'HJLU120423-0',
  basis:compressor?'箱内空压机：单台毛重3550 kg × 2 = Khayat-1净重7100 kg；装柜关系待确认':'箱内切割机：设备及附件合计2327 kg = Khayat-2净重；英文同列装箱关系待确认',
  sources:[{file:sourceFile,sheet:'中文总装箱单',range:compressor?'A48:Q50':'A51:Q52'}, {file:sourceFile,sheet:'中文明细装箱单',range:compressor?'A93:Q95':'A96:Q105'}, {file:sourceFile,sheet:'英文明细装箱单',range:compressor?'A94:P95':'A96:G96'}]};
}

export const isOuterPackage=row=>shipmentPackaging(row).kind==='outer';
export function packagingLabel(row){
 const p=shipmentPackaging(row);
 return p.kind==='contents'?`箱内设备 · 不重复计件${p.parentPackageLot?` · ${p.parentPackageLot} / ${p.parentContainerNo}`:''} · 归属待确认`:text(row.shipmentBatch).toUpperCase()==='B01'?'外包装 · 待确认':'外包装';
}
