// Minimal reproduction of the reviewed source layout; no original file is modified.
export function b01PackingFixture(){
 const master=[['B01'],[],['总件数','',46],['序号','供货厂家','外包装编号.','货物名称','部件名称','装箱明细','规格型号','数量']];
 const row=(seq,supplier,lot,name,weight=100)=>[seq,supplier,lot,'',name,'','',1,'件','框架',100,100,100,1,weight,weight];
 for(let i=1;i<=30;i++)master.push(row(i,'江苏宁晓',`JSNX-${i}/30`,'钢材'));
 for(let i=31;i<=33;i++)master.push(row(i,'湖北鹰汉','HBYH-1/3',i===33?'镀锌角钢':'镀锌扁钢',i*100));
 for(let i=34;i<=43;i++)master.push(row(i,'唐山任氏',`${i-33}/10`,'装车机'));
 master.push(row(44,'','Khayat-1','集装箱',9300));
 master.push(row(45,'KLT-HT-JX16江苏中百机电工程有限公司','','KLT空压机',3550));
 master.push(row(46,'KLT-HT-JX16江苏中百机电工程有限公司','','KLT空压机',3550));
 master.push(row(47,'','Khayat-2','集装箱',4527));
 master.push(row(48,'MLQ-13JXHT01-GC20250926上海创翊机电设备有限公司','','等离子数控切割机',2200));
 master.push(row(1,'烟台中润','Khayrat-YTZR-1/1','镀锌钢格板',8377));
 const detail=Array.from({length:109},()=>[]);
 detail[79]=[...master[34]];detail[79][0]=1;
 detail[80]=[...master[35]];detail[80][0]=2;
 detail[81]=[...master[36]];detail[81][0]=3;
 for(let i=0;i<3;i++)detail[92+i]=[...master[47+i]];
 detail[95]=[...master[50]];detail[95][0]=48;
 detail[96]=[...master[51]];detail[96][0]=49;
 detail[97]=[50,'','','','','枪头接近开关','',2,'个'];
 detail[105]=[...master[52]];
 return {master,detail};
}
