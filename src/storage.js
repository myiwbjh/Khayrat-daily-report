import {withProvenance,parseReportDate} from './report-model.js';
export const STORAGE_KEY = 'khayrat.dailyReports.v1';
export const EVIDENCE_KEY = 'khayrat.imageEvidence.v1';
const stripBinary = image => { const { dataUrl, blob, rawPdf, signedUrl, ...metadata } = image || {}; return metadata; };

export function businessKey(record) {
  const activity = record.activityId || [record.equipmentName, record.rawRecord].filter(Boolean).join(' · ');
  return [record.date, record.workshop, record.process, activity].map(value => String(value || '').trim().toLowerCase()).join('|');
}

export function validateRecord(record) {
  const errors = {};
  if (!record.date) errors.date = '请选择日报日期';
  else if(!parseReportDate(record.date)) errors.date = '日报日期必须为有效日期';
  if (!record.workshop?.trim()) errors.workshop = '请输入车间';
  if (!record.process?.trim()) errors.process = '请输入施工工序';
  for (const field of ['chineseStaff', 'localStaff', 'dailyConcrete', 'cumulativeConcrete', 'plannedProgress', 'actualProgress']) {
    const value = record[field];
    if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) errors[field] = '必须为非负数';
  }
  for (const field of ['plannedProgress', 'actualProgress']) if (Number(record[field]) > 100) errors[field] = '进度不能超过 100%';
  for(const field of ['chineseStaff','localStaff'])if(record[field]!=null&&record[field]!==''&&!Number.isInteger(Number(record[field])))errors[field]='人员数量必须为整数';
  if (Number(record.dailyConcrete) > Number(record.cumulativeConcrete) && record.cumulativeConcrete !== '' && record.cumulativeConcrete != null) errors.cumulativeConcrete = '累计完成量不能小于当日完成量';
  return errors;
}

export class ReportStore {
  constructor(storage = globalThis.localStorage) { this.storage = storage; this.key=STORAGE_KEY; this.cache=null; }
  setScope(projectId,userId){this.key=`${STORAGE_KEY}:${encodeURIComponent(JSON.stringify([projectId,userId]))}`;this.cache=null;}
  setCache(items) { this.cache=Array.isArray(items)?items:[];return this.cache; }
  all() { if(this.cache)return this.cache;try { const value = JSON.parse(this.storage.getItem(this.key) || '[]');this.cache=Array.isArray(value)?value:[];return this.cache; } catch { this.cache=[];return this.cache; } }
  write(records) { this.cache=records;const safe=records.map(({sourceExcerpt,...record})=>({...record,provenance:record.provenance?{...record.provenance,excerpt:String(record.provenance.excerpt||'').slice(0,2000)}:undefined,rawRecord:String(record.rawRecord||'').slice(0,2000)}));try{this.storage.setItem(this.key,JSON.stringify(safe));}catch(error){if(error?.name!=='QuotaExceededError')throw error;}return records; }
  duplicate(record, excludeId = '') { return this.all().find(item => item.id !== excludeId && businessKey(item) === businessKey(record)); }
  save(record) {
    const errors = validateRecord(record); if (Object.keys(errors).length) return { ok: false, errors };
    const rows = this.all(), duplicate = rows.find(item => item.id !== record.id && businessKey(item) === businessKey(record));
    if (duplicate) return { ok: false, duplicate };
    const now = new Date().toISOString(), normalized = { ...withProvenance(record), id: record.id || crypto.randomUUID(), reportName: record.reportName || `手工日报-${record.date}`, source: record.source || '浏览器手工录入', updatedAt: now, createdAt: record.createdAt || now };
    const index = rows.findIndex(item => item.id === normalized.id); if (index >= 0) rows[index] = normalized; else rows.push(normalized); this.write(rows); return { ok: true, record: normalized };
  }
  remove(id) { this.write(this.all().filter(item => item.id !== id)); }
  merge(incoming) { const rows = this.all(), keys = new Set(rows.map(businessKey)); let added = 0, skipped = 0; for (const item of incoming) { if (keys.has(businessKey(item))) { skipped++; continue; } const now = new Date().toISOString(); rows.push({ ...withProvenance(item), id: item.id || crypto.randomUUID(), createdAt: item.createdAt || now, updatedAt: now }); keys.add(businessKey(item)); added++; } this.write(rows); return { added, skipped, records: rows }; }
  mergeRemote(incoming){const rows=this.all().map(r=>({...r})),ids=new Set(rows.map(r=>r.id)),keys=new Set(rows.map(businessKey));for(const record of incoming){if(ids.has(record.id)||keys.has(businessKey(record)))continue;rows.push(withProvenance(record));ids.add(record.id);keys.add(businessKey(record));}return this.write(rows);}
  backup() { return JSON.stringify({ format: 'khayrat-daily-reports', version: 1, exportedAt: new Date().toISOString(), records: this.all() }, null, 2); }
  restore(text) { const data = JSON.parse(text); if (data?.format !== 'khayrat-daily-reports' || data.version !== 1 || !Array.isArray(data.records)) throw new Error('不是有效的 Khayrat 备份文件'); const valid = data.records.filter(item => !Object.keys(validateRecord(item)).length); const result = this.merge(valid); return { ...result, invalid: data.records.length - valid.length }; }
  clear() { this.cache=[];this.storage.removeItem(this.key); }
}

export class EvidenceStore {
  constructor(storage = globalThis.localStorage) { this.storage = storage; this.key=EVIDENCE_KEY; this.cache = null; }
  setScope(projectId,userId){this.key=`${EVIDENCE_KEY}:${encodeURIComponent(JSON.stringify([projectId,userId]))}`;this.cache=null;}
  all() { if(this.cache)return this.cache;try { const value = JSON.parse(this.storage.getItem(this.key) || '[]'); this.cache=Array.isArray(value)?value:[];return this.cache; } catch { this.cache=[];return this.cache; } }
  setCache(items) { this.cache=Array.isArray(items)?items:[];return this.cache; }
  write(items) { const safe=items.map(stripBinary);this.cache=items;try{this.storage.setItem(this.key,JSON.stringify(safe));}catch(error){if(error?.name!=='QuotaExceededError')throw error;}return items; }
  merge(incoming) { const items = this.all().map(x=>({...x})), ids = new Set(items.map(x => x.imageId)); let added = 0; for (const image of incoming) { if (ids.has(image.imageId)) continue; items.push({...image}); ids.add(image.imageId); added++; } const safe=this.write(items);return { added, items:safe }; }
  mergeRemote(incoming) {
    const items=this.all().map(item=>({...item})),byId=new Map(items.map((item,index)=>[item.imageId,index]));let added=0,updated=0;
    for(const remote of incoming){const index=byId.get(remote.imageId);if(index==null){items.push({...remote});byId.set(remote.imageId,items.length-1);added++;continue;}
      const local=items[index],binary=Object.fromEntries(['dataUrl','blob','rawPdf'].filter(key=>local[key]!=null).map(key=>[key,local[key]]));
      items[index]=local.cloudSyncPending?{...remote,...local,...binary}:{...local,...remote,...binary,cloudSyncPending:false};updated++;
    }
    return {added,updated,items:this.write(items)};
  }
  update(imageId, changes) { const items = this.all(), index = items.findIndex(x => x.imageId === imageId); if (index < 0) return null; items[index] = { ...items[index], ...changes, updatedAt: new Date().toISOString() }; this.write(items); return items[index]; }
  removeBySource(sourceFile) { this.write(this.all().filter(x => x.sourceFile !== sourceFile)); }
  clear() { this.cache=[];this.storage.removeItem(this.key); }
}

