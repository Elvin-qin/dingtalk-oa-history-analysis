import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {args,locateDws,callDws,writeJson,readJson,sha,validDate,shiftDate,todayShanghai,diagnostic} from "./common.mjs";

export const roles={submitted:"我发起",executed:"我处理",cc:"抄送我"};
const listCommands={submitted:"list-submitted",executed:"list-executed",cc:"list-cc"};
export function decodePage(payload) {
  const result=payload?.result;
  if(!result || typeof result.hasMore!=="boolean" || !Array.isArray(result.values)) throw Error("Invalid list structure: expected result.values[] and boolean hasMore");
  for(const row of result.values) if(!row || !row.processInstanceId) throw Error("List entry is missing processInstanceId");
  return result;
}
function checkedDetail(payload, id) {
  const d=payload?.result;
  if(!d || !Array.isArray(d.formValueVOS) || !d.status || (d.processInstanceId && String(d.processInstanceId)!==id)) throw Error("Invalid/mismatched detail for instance");
  return payload;
}
export async function collectWindow({role,start,end,request,dir,manifest,pageSize=20,splitAfter=10,depth=0}) {
  const key=role+"_"+start+"_"+end;
  let seen=new Set(), parentRows=[], page=1;
  while(true) {
    const payload=await request(["oa","approval",listCommands[role],"--page",String(page),"--limit",String(pageSize),"--create-time-from",start,"--create-time-to",end]);
    const result=decodePage(payload);
    await writeJson(path.join(dir,"raw","lists",key+"_"+page+".json"),payload);
    manifest.pages++;
    const fresh=result.values.filter(v=>!seen.has(String(v.processInstanceId)));
    if(result.values.length && !fresh.length) throw Error("Pagination repeated a page without new instances: "+key);
    result.values.forEach(v=>seen.add(String(v.processInstanceId)));
    parentRows.push(...result.values);
    console.log(JSON.stringify({phase:"list",role,from:start,to:end,page,count:parentRows.length,hasMore:result.hasMore}));
    if(!result.hasMore) {
      manifest.segments.push({role,from:start,to:end,pages:page,count:parentRows.length,complete:true});
      return parentRows;
    }
    if(page>=splitAfter) {
      if(start===end || depth>=20) throw Error("Unresolved continuation within one day; export is incomplete");
      const span=Math.floor((Date.parse(end)-Date.parse(start))/86400000);
      const mid=shiftDate(start,Math.floor(span/2));
      const opts={role,request,dir,manifest,pageSize,splitAfter,depth:depth+1};
      const left=await collectWindow({...opts,start,end:mid});
      const right=await collectWindow({...opts,start:shiftDate(mid,1),end});
      const union=new Map([...left,...right].map(row=>[String(row.processInstanceId),row]));
      // Do not silently lose entries because date-filter semantics drift.
      const missing=parentRows.filter(row=>!union.has(String(row.processInstanceId)));
      if(missing.length) throw Error("Date partitions omitted "+missing.length+" parent-list instances; review raw pages");
      return [...union.values()];
    }
    page++;
  }
}
export async function exportArchive(options, injectedRequest) {
  const selected=(options.roles||"submitted,executed,cc").split(",");
  if(!selected.length || new Set(selected).size!==selected.length || selected.some(r=>!roles[r])) throw Error("roles must be a distinct subset of submitted,executed,cc");
  if(!options.profile || !options.out) throw Error("--profile and --out are required");
  const start=validDate(options.from||"2014-01-01"), end=validDate(options.to||todayShanghai());
  if(start>end) throw Error("from must be before to");
  const dir=path.resolve(options.out);
  const query={profile:options.profile,from:start,to:end,roles:selected,pageSize:20,schemaVersion:1};
  const fingerprint=sha(JSON.stringify(query));
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  // Exclusive run lock stops two processes mixing a snapshot.
  const lockPath=path.join(dir,".run-lock");
  const lock=await fs.open(lockPath,"wx",0o600);
  let manifest={query,fingerprint,startedAt:new Date().toISOString(),complete:false,pages:0,segments:[],sources:{},failures:[],details:0};
  let existing=null;
  const manifestPath=path.join(dir,"manifest.json");
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:manifest.startedAt}));
    try{existing=await readJson(manifestPath);}catch(e){if(e.code!=="ENOENT") throw e;}
    if(existing) {
      if(!options.resume) throw Error("Archive exists; use --resume for this snapshot or a new --out directory");
      if(existing.fingerprint!==fingerprint) throw Error("Profile, dates, or roles differ from saved snapshot");
      manifest={...existing,complete:false,failures:[],resumedAt:new Date().toISOString()};
    }
    const command=injectedRequest?null:locateDws(options.dws,options.runtime);
    if(!injectedRequest && !command) throw Error("DWS not found; run doctor and read install-auth.md");
    const request=injectedRequest || (argv=>callDws(command,options.profile,argv));
    await writeJson(manifestPath,manifest);
    if(!injectedRequest) {
      const p=await callDws(command,null,["profile","list"]);
      const account=p.profiles?.find(v=>v.profile===options.profile);
      if(!account) throw Error("Selected stable profile does not exist; choose from profile list");
      manifest.account={corpName:account.corpName,userName:account.userName,profile:account.profile};
    }
    const merged=new Map();
    for(const role of selected) {
      let rows;
      const cached=path.join(dir,"raw",role+"-complete.json");
      if(options.resume && manifest.sources[role]?.complete) rows=(await readJson(cached)).values;
      else {
        rows=await collectWindow({role,start,end,request,dir,manifest,splitAfter:Number(options["split-after"]||10)});
        const unique=new Map(rows.map(v=>[String(v.processInstanceId),v]));
        rows=[...unique.values()];
        await writeJson(cached,{role,values:rows,query});
        manifest.sources[role]={count:rows.length,complete:true};
        await writeJson(manifestPath,manifest);
      }
      for(const item of rows) {
        const id=String(item.processInstanceId);
        if(!merged.has(id)) merged.set(id,{processInstanceId:id,sourceRoles:[],sourceRoleLabels:[],sourceItems:{},listItem:item});
        const row=merged.get(id);
        row.sourceRoles.push(role);row.sourceRoleLabels.push(roles[role]);row.sourceItems[role]=item;
      }
    }
    const entries=[...merged.values()];
    manifest.uniqueInstances=entries.length;
    manifest.details=0;
    await writeJson(manifestPath,manifest);
    for(const entry of entries) {
      const id=entry.processInstanceId, file=path.join(dir,"raw","details",sha(id)+".json");
      try{
        let payload;
        if(options.resume) {try{payload=checkedDetail(await readJson(file),id);}catch(e){if(e.code!=="ENOENT") throw e;}}
        if(!payload) payload=checkedDetail(await request(["oa","approval","detail","--instance-id",id]),id);
        if(!Array.isArray(payload.result.operationRecords) && !Array.isArray(payload.result._supplementalRecords)) {
          const extra=await request(["oa","approval","records","--instance-id",id]);
          if(!Array.isArray(extra?.result?.operationRecords)) throw Error("Missing operation records");
          payload.result._supplementalRecords=extra.result.operationRecords;
        }
        if(!Array.isArray(payload.result.tasks) && !Array.isArray(payload.result._supplementalTasks)) {
          const extra=await request(["oa","approval","tasks","--instance-id",id]);
          if(!Array.isArray(extra?.result?.taskIdList)) throw Error("Missing task information");
          payload.result._supplementalTasks=extra.result.taskIdList;
        }
        await writeJson(file,payload);
        entry.detail=payload.result;
        entry.detailFile=path.relative(dir,file).split(path.sep).join("/");
        manifest.details++;
      }catch(e){
        entry.detail=null;entry.error=diagnostic(e);
        manifest.failures.push({instanceId:id,...diagnostic(e)});
        // Stop on any failed detail, preserving diagnostics for recovery.
        // Do not fan out an opaque API/permission error across all instances.
        await writeJson(path.join(dir,"approvals.json"),entries);
        throw e;
      }
      if((manifest.details+manifest.failures.length)%10===0){
        console.log(JSON.stringify({phase:"detail",success:manifest.details,failures:manifest.failures.length,total:entries.length}));
        await writeJson(manifestPath,manifest);
      }
    }
    await writeJson(path.join(dir,"approvals.json"),entries);
    manifest.complete=manifest.failures.length===0 && selected.every(r=>manifest.sources[r]?.complete);
    manifest.finishedAt=new Date().toISOString();
    await writeJson(manifestPath,manifest);
    console.log(JSON.stringify({complete:manifest.complete,unique:entries.length,details:manifest.details,failures:manifest.failures.length,out:dir}));
    return manifest;
  }catch(e){
    if(!existing || existing.fingerprint===fingerprint && options.resume) {
      manifest.complete=false;manifest.stopReason=diagnostic(e);await writeJson(manifestPath,manifest);
    }
    throw e;
  }finally{
    await lock.close();await fs.unlink(lockPath);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try{
    const o=args(process.argv.slice(2),["profile","out","from","to","roles","dws","runtime","resume"],["resume"]);
    const m=await exportArchive(o);if(!m.complete) process.exitCode=2;
  }catch(e){console.error(JSON.stringify(diagnostic(e)));process.exitCode=1;}
}
