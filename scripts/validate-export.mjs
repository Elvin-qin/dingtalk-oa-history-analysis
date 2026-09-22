import path from "node:path";
import fs from "node:fs/promises";
import {args,readJson,sha} from "./common.mjs";
const o=args(process.argv.slice(2),["dir"]);
if(!o.dir)throw Error("--dir required");
const dir=path.resolve(o.dir),m=await readJson(path.join(dir,"manifest.json")),rows=await readJson(path.join(dir,"approvals.json"));
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
const book=await readJson(path.join(dir,"workbook-manifest.json"));
const bytes=await fs.readFile(path.join(dir,book.workbook));
if(sha(bytes)!==book.sha256)errors.push("XLSX checksum mismatch");
if(bytes[0]!==0x50||bytes[1]!==0x4b)errors.push("not an XLSX ZIP container");
console.log(JSON.stringify({records:rows.length,sheets:book.sheets.length,complete:m.complete,errors},null,2));
if(errors.length)process.exitCode=1;

