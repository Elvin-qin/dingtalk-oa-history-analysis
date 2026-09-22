import fs from "node:fs/promises";
import {existsSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";

export function args(argv, allowed, booleans = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "");
    if (!argv[i].startsWith("--") || !allowed.includes(name)) throw Error("Unknown argument: " + argv[i]);
    if (booleans.includes(name)) out[name] = true;
    else {
      if (!argv[i+1] || argv[i+1].startsWith("--")) throw Error("Missing value: " + name);
      out[name] = argv[++i];
    }
  }
  return out;
}
export const sha = value => createHash("sha256").update(value).digest("hex");
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temp, JSON.stringify(value, null, 2), {mode:0o600});
  await fs.rename(temp, file);
}
export const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));
export function runtimeDirectory(platform = process.platform) {
  if (platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),"AppData","Local"), "dingtalk-oa-history-analysis", "runtime");
  return path.join(os.homedir(), "Library", "Caches", "dingtalk-oa-history-analysis", "runtime");
}
export function executableCommand(file, platform = process.platform) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return {file:process.execPath, prefix:[file]};
  if (platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    // Invoke npm's actual native binary, avoiding cmd.exe and shell escaping.
    const dir = path.dirname(file);
    const candidates = [
      path.resolve(dir, "..", "dingtalk-workspace-cli", "vendor", "dws.exe"),
      path.resolve(dir, "node_modules", "dingtalk-workspace-cli", "vendor", "dws.exe")
    ];
    const native = candidates.find(existsSync);
    if (!native) throw Error("Cannot resolve npm shim; pass --dws with the full path to dws.exe.");
    return {file:native,prefix:[]};
  }
  return {file,prefix:[]};
}
export function locateDws(explicit, runtime = runtimeDirectory()) {
  if (explicit) {
    const full = path.resolve(explicit);
    if (!existsSync(full)) throw Error("DWS file not found: " + full);
    return executableCommand(full);
  }
  const binary = process.platform === "win32" ? "dws.exe" : "dws";
  const candidates = [path.join(runtime,"node_modules","dingtalk-workspace-cli","vendor",binary)];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(dir,binary));
    if(process.platform === "win32") candidates.push(path.join(dir,"dws.cmd"));
  }
  const found = candidates.find(existsSync);
  return found ? executableCommand(found) : null;
}
export async function run(command, argv, options = {}) {
  return new Promise((resolve,reject) => {
    const child=spawn(command.file,[...command.prefix,...argv],{shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let stdout="", stderr="", oversized=false;
    const timer=setTimeout(()=>child.kill(), options.timeoutMs || 90000);
    child.stdout.on("data",chunk=>{stdout+=chunk; if(stdout.length>32*1024*1024){oversized=true; child.kill();}});
    child.stderr.on("data",chunk=>{stderr+=chunk; if(stderr.length>1024*1024){oversized=true; child.kill();}});
    child.on("error",err=>{clearTimeout(timer);reject(err);});
    child.on("close",(code,signal)=>{
      clearTimeout(timer);
      if(oversized) return reject(Error("DWS output exceeds bounded buffer"));
      resolve({code,signal,stdout,stderr});
    });
  });
}
export function checkedPayload(text) {
  const p=JSON.parse(text);
  if (!p || typeof p!=="object" || p.error || p.success===false || p.ok===false ||
      ["errcode","errorCode","dingOpenErrcode"].some(k=>p[k]!=null && String(p[k])!=="0")) {
    const e=Error("DWS business response reports failure"); e.payload=p; throw e;
  }
  return p;
}
export async function callDws(command, profile, argv) {
  const params=[...argv,...(profile?["--profile",profile]:[]),"--format","json"];
  const response=await run(command, params);
  if(response.code!==0) {
    let error;
    try{error=JSON.parse(response.stderr).error;}catch{}
    const e=Error("DWS command failed: " + argv.slice(0,3).join(" "));
    e.diagnostic={code:response.code,signal:response.signal,category:error?.category,reason:error?.reason,trace_id:error?.trace_id,retryable:error?.retryable,server_error_code:error?.server_error_code,hint:error?.hint,actions:error?.actions,details:error?.details,retry_after_seconds:error?.retry_after_seconds,next_retry_at:error?.next_retry_at};
    // The CLI owns token refresh and HTTP retry. The collector does not retry
    // opaque internal errors, or infer retryability from free text.
    throw e;
  }
  return checkedPayload(response.stdout);
}
export function validDate(text) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(text+"T00:00:00Z").toISOString().slice(0,10)!==text) throw Error("Invalid date: "+text);
  return text;
}
export const todayShanghai=()=>{
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(v=>[v.type,v.value]));
  return [p.year,p.month,p.day].join("-");
};
export function shiftDate(date, days){return new Date(Date.parse(date+"T00:00:00Z")+days*86400000).toISOString().slice(0,10);}
export function diagnostic(error){return {message:error.message,...error.diagnostic};}
