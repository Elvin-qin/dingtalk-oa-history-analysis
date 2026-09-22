import path from "node:path";
import fs from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {args,readJson,sha} from "./common.mjs";

export async function validateArchive(input) {
  const dir=path.resolve(input),m=await readJson(path.join(dir,"manifest.json")),rows=await readJson(path.join(dir,"approvals.json"));
  const errors=[];
  if(rows.length!==m.uniqueInstances)errors.push("uniqueInstances count mismatch");
  if(new Set(rows.map(r=>r.processInstanceId)).size!==rows.length)errors.push("duplicate instance IDs");
  for(const r of rows) {
    if(!r.detail){errors.push("missing detail");continue;}
    const file=path.join(dir,"raw","details",sha(r.processInstanceId)+".json");
    const payload=await readJson(file);
    if(JSON.stringify(payload.result)!==JSON.stringify(r.detail))errors.push("raw detail mismatch");
  }
  if(m.complete && (errors.length || m.failures?.length || m.details!==rows.length))errors.push("false complete flag");
  let attachmentFailures=0,attachments=0,attachmentsComplete=null;
  if(m.attachments?.requested){
    const attachmentManifest=await readJson(path.join(dir,"attachments.json"));
    const listed=attachmentManifest.attachments||[];attachments=listed.length;
    if(attachments!==m.attachments.total)errors.push("attachment count mismatch");
    const downloaded=listed.filter(v=>v.status==="downloaded").length;
    if(downloaded!==m.attachments.downloaded)errors.push("attachment downloaded count mismatch");
    attachmentFailures=listed.filter(v=>v.status==="failed").length;
    attachmentsComplete=attachmentFailures===0;
    if(attachmentFailures!==m.attachments.failed)errors.push("attachment failure count mismatch");
    if(Boolean(m.attachments.complete)!==attachmentsComplete)errors.push("attachment complete flag mismatch");
    for(const item of listed.filter(v=>v.status==="downloaded")){
      const file=path.resolve(dir,item.localPath||"");
      if(!item.localPath||!file.startsWith(dir+path.sep)){errors.push("invalid attachment path");continue;}
      try{
        const bytes=await fs.readFile(file);
        if(bytes.length!==item.sizeBytes)errors.push("attachment size mismatch");
        if(sha(bytes)!==item.sha256)errors.push("attachment checksum mismatch");
      }catch{errors.push("missing downloaded attachment");}
    }
  }
  const book=await readJson(path.join(dir,"workbook-manifest.json"));
  const bytes=await fs.readFile(path.join(dir,book.workbook));
  if(sha(bytes)!==book.sha256)errors.push("XLSX checksum mismatch");
  if(bytes[0]!==0x50||bytes[1]!==0x4b)errors.push("not an XLSX ZIP container");
  return {records:rows.length,sheets:book.sheets.length,complete:m.complete,attachments,attachmentFailures,attachmentsComplete,workbook:path.join(dir,book.workbook),errors};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const o=args(process.argv.slice(2),["dir"]);if(!o.dir)throw Error("--dir required");
    const result=await validateArchive(o.dir);console.log(JSON.stringify(result,null,2));
    if(result.errors.length)process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
