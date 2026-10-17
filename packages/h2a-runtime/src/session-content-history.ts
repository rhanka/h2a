/** Metadata catalog for an exact, separately qualified provider. No transcript is read here.
 * Catalog identities/companion relationships come from the native provider adapter, never a remote body.
 */
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { safeArchivePath } from "./session-content-archive.js";
import { same,type Provider,type Policy,type Project,type HistorySelector } from "./session-content-contract.js";
export interface HistoryCatalogEntry { lineageId:string;checkpointId:string;companions:string[];files:{path:string;localPath:string;role:'records'|'artifact'}[] }
export interface SnapshotFile { path:string;localPath:string;role:'records'|'artifact';lineageId:string;identity:{dev:string;ino:string;size:string;mtimeNs:string;ctimeNs:string} }
export interface HistoryBookmark { boundaryId:string;provider:Provider;selections:HistorySelector[] }
export class NativeHistoryProvider {
  private readonly bookmarks=new WeakMap<object,{files:SnapshotFile[];entries:HistoryCatalogEntry[]}>();
  private readonly catalog:HistoryCatalogEntry[];
  readonly provider:Provider;
  constructor(private readonly config:{project:Project;provider:Provider;qualifiedProviders:readonly Provider[];catalog:readonly HistoryCatalogEntry[]}){
    if(!config.qualifiedProviders.some(p=>same(p,config.provider)))throw new Error('unsupported_format');
    this.provider=structuredClone(config.provider);this.catalog=structuredClone([...config.catalog]);
    if(this.catalog.length>10000||new Set(this.catalog.map(e=>e.lineageId)).size!==this.catalog.length)throw new Error('unsupported_format');
  }
  async stage(policy:Policy):Promise<HistoryBookmark>{
    if(!policy.channels.nativeHistory||!same(policy.project,this.config.project))throw new Error('history_scope_refused');
    const selected=policy.history.mode==='existing-at-activation'?this.catalog:this.catalog.filter(e=>policy.history.selected.some(h=>h.lineageId===e.lineageId));
    if(!selected.length || (policy.history.mode==='selected'&&selected.length!==policy.history.selected.length))throw new Error('history_scope_refused');
    for(const selector of policy.history.selected){
      // No provider record index is qualified here. Refuse a partial range before reading any record.
      if(selector.fromRecord!==null||selector.toRecord!==null)throw new Error('unsupported_format');
      const entry=selected.find(e=>e.lineageId===selector.lineageId);if(!entry||(selector.checkpointId!==null&&selector.checkpointId!==entry.checkpointId))throw new Error('history_scope_refused');
    }
    const files:SnapshotFile[]=[];
    for(const entry of selected){
      if(entry.companions.some(id=>!selected.some(e=>e.lineageId===id)))throw new Error('unconsented_companion');
      for(const file of entry.files){
        safeArchivePath(file.path);if(!isAbsolute(file.localPath))throw new Error('unsupported_format');
        const stat=await lstat(file.localPath,{bigint:true});
        if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size>67108864n)throw new Error('unsupported_format');
        files.push({...file,lineageId:entry.lineageId,identity:{dev:String(stat.dev),ino:String(stat.ino),size:String(stat.size),mtimeNs:String(stat.mtimeNs),ctimeNs:String(stat.ctimeNs)}});
      }
    }
    files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    if(files.length>10000||files.reduce((n,f)=>n+Number(f.identity.size),0)>268435456||new Set(files.map(f=>f.path.toLowerCase())).size!==files.length)throw new Error('unsupported_format');
    for(const entry of selected)if(!files.some(f=>f.lineageId===entry.lineageId&&f.role==='records'))throw new Error('incomplete_checkpoint');
    const bookmark={boundaryId:randomUUID(),provider:structuredClone(this.provider),selections:structuredClone(policy.history.selected)};
    this.bookmarks.set(bookmark,{files,entries:selected});return bookmark;
  }
  resolve(bookmark:HistoryBookmark):{files:SnapshotFile[];entries:HistoryCatalogEntry[]}{
    const value=this.bookmarks.get(bookmark);if(!value)throw new Error('unknown_history_boundary');return structuredClone(value);
  }
  async recheck(bookmark:HistoryBookmark):Promise<void>{
    for(const file of this.resolve(bookmark).files){const s=await lstat(file.localPath,{bigint:true});
      if(!s.isFile()||s.nlink!==1n||!same(file.identity,{dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}))throw new Error('checkpoint_changed');}
  }
}
