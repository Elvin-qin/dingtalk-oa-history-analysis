import fs from "node:fs/promises";
import {existsSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {args,callDws,checkedPayload,locateDws,readJson,runtimeDirectory,run,todayShanghai} from "./common.mjs";
import {exportArchive} from "./export-oa-history.mjs";
import {buildArchive} from "./build-workbook.mjs";
import {validateArchive} from "./validate-export.mjs";

const DWS_VERSION="1.0.62";
const EXCELJS_VERSION="4.4.0";
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const skillRoot=path.resolve(scriptDir,"..");

function help(){
  console.log(`DingTalk OA history one-command export

Usage:
  node scripts/run.mjs [--out DIR] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                       [--roles submitted,executed,cc] [--profile corp:user]
                       [--runtime DIR] [--dws FILE] [--device] [--skip-install]

The command installs missing DWS/ExcelJS dependencies, starts OAuth login only
when needed, exports approvals, builds XLSX, and validates the result.`);
}

function shanghaiTimestamp(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).map(v=>[v.type,v.value]));
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

export function defaultOutput(){
  return path.join(os.homedir(),"Documents","DingTalkOAArchive","审批归档_"+shanghaiTimestamp());
}

export function selectProfile(profiles,explicit=""){
  if(!Array.isArray(profiles)||!profiles.length)throw Error("登录成功但没有可用的钉钉身份");
  if(explicit){
    const found=profiles.find(p=>p.profile===explicit);
    if(!found)throw Error("指定的 profile 不存在: "+explicit);
    return found;
  }
  const current=profiles.filter(p=>p.isCurrent||p.isOrgCurrent);
  if(current.length===1)return current[0];
  const usable=profiles.filter(p=>!["expired","disabled"].includes(String(p.status||"").toLowerCase()));
  if(usable.length===1)return usable[0];
  if(profiles.length===1)return profiles[0];
  const list=profiles.map(p=>`${p.profile} (${p.corpName||"未知组织"} / ${p.userName||"未知用户"})`).join("; ");
  throw Error("检测到多个钉钉身份且无法确定当前身份，请选择后用 --profile 重跑: "+list);
}

function npmCommand(){
  if(process.platform!=="win32")return {file:"npm",prefix:[]};
  const candidates=[
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath),"node_modules","npm","bin","npm-cli.js"),
    process.env.APPDATA&&path.join(process.env.APPDATA,"npm","node_modules","npm","bin","npm-cli.js")
  ].filter(Boolean);
  const cli=candidates.find(existsSync);
  if(!cli)throw Error("找不到 npm-cli.js，请确认 Node.js 来自官方安装包并可在终端运行 npm.cmd --version");
  return {file:process.execPath,prefix:[cli]};
}

async function foreground(command,argv,label){
  console.log(JSON.stringify({phase:"setup",action:label}));
  await new Promise((resolve,reject)=>{
    const child=spawn(command.file,[...command.prefix,...argv],{shell:false,windowsHide:false,stdio:"inherit"});
    child.once("error",reject);
    child.once("close",(code,signal)=>code===0?resolve():reject(Error(`${label} 失败: exit=${code} signal=${signal||""}`)));
  });
}

async function packageVersion(runtime,name){
  try{return JSON.parse(await fs.readFile(path.join(runtime,"node_modules",name,"package.json"),"utf8")).version;}
  catch{return null;}
}

async function ensureDependencies(options){
  const runtime=path.resolve(options.runtime||runtimeDirectory());
  const major=Number(process.versions.node.split(".")[0]);
  if(!Number.isInteger(major)||major<20)throw Error("需要 Node.js 20 或更高版本，当前为 "+process.version);
  await fs.mkdir(runtime,{recursive:true});
  let command=locateDws(options.dws,runtime);
  const excelVersion=await packageVersion(runtime,"exceljs");
  if((!command||excelVersion!==EXCELJS_VERSION)&&options["skip-install"])throw Error("缺少 DWS 或 ExcelJS，且使用了 --skip-install");
  let npm;
  if(!command){
    npm=npmCommand();
    await foreground(npm,["install","--prefix",runtime,"--save-exact",`dingtalk-workspace-cli@${DWS_VERSION}`],"安装钉钉 DWS CLI");
    command=locateDws(options.dws,runtime);
    if(!command)throw Error("DWS CLI 安装完成后仍无法定位可执行文件");
  }
  if(excelVersion!==EXCELJS_VERSION){
    npm||=npmCommand();
    await foreground(npm,["install","--prefix",runtime,"--save-exact","--ignore-scripts",`exceljs@${EXCELJS_VERSION}`],"安装 ExcelJS");
  }
  return {runtime,command};
}

async function authStatus(command){
  const response=await run(command,["auth","status","--format","json"]);
  if(response.code!==0)return {authenticated:false};
  try{return checkedPayload(response.stdout);}catch{return {authenticated:false};}
}

async function ensureLogin(command,device){
  let status=await authStatus(command);
  if(status.authenticated===true)return status;
  console.log(JSON.stringify({phase:"auth",status:"LOGIN_REQUIRED",message:"请在钉钉官方页面完成登录，成功后本命令会自动继续"}));
  await foreground(command,["auth","login",...(device?["--device"]:[]),"--format","json"],"钉钉 OAuth 登录");
  status=await authStatus(command);
  if(status.authenticated!==true)throw Error("钉钉登录没有成功，请重新运行本命令");
  return status;
}

async function existingManifest(out){
  try{return await readJson(path.join(out,"manifest.json"));}
  catch(e){if(e.code==="ENOENT")return null;throw e;}
}

export async function oneCommandExport(options){
  const {runtime,command}=await ensureDependencies(options);
  await ensureLogin(command,Boolean(options.device));
  const out=path.resolve(options.out||defaultOutput());
  if(out===skillRoot||out.startsWith(skillRoot+path.sep))throw Error("输出目录必须位于 Skill 目录之外");
  const saved=await existingManifest(out);
  if(existsSync(out)&&!saved){
    const entries=await fs.readdir(out);
    if(entries.length)throw Error("输出目录非空且不是可续传归档，请换一个 --out 目录");
  }
  const profilePayload=await callDws(command,null,["profile","list"]);
  const requested=options.profile||saved?.query?.profile||"";
  const account=selectProfile(profilePayload.profiles,requested);
  const exportOptions={
    profile:account.profile,
    out,
    from:options.from||saved?.query?.from||"2014-01-01",
    to:options.to||saved?.query?.to||todayShanghai(),
    roles:options.roles||(saved?.query?.roles||["submitted","executed","cc"]).join(","),
    runtime,
    resume:Boolean(saved)
  };
  const manifest=await exportArchive(exportOptions);
  if(!manifest.complete)throw Error("审批归档未完整，已保留输出目录供下次自动续传: "+out);
  const workbook=await buildArchive({dir:out,engine:"exceljs",modules:path.join(runtime,"node_modules")});
  const validation=await validateArchive(out);
  if(validation.errors.length)throw Error("导出校验失败: "+validation.errors.join("; "));
  const result={
    status:"complete",
    account:{corpName:manifest.account?.corpName||account.corpName,userName:manifest.account?.userName||account.userName,profile:account.profile},
    range:{from:manifest.query.from,to:manifest.query.to,roles:manifest.query.roles},
    roleCounts:Object.fromEntries(Object.entries(manifest.sources||{}).map(([key,value])=>[key,value.count])),
    records:manifest.uniqueInstances,
    sheets:workbook.sheets.length,
    workbook:validation.workbook,
    archive:out,
    validated:true
  };
  console.log(JSON.stringify(result,null,2));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const options=args(process.argv.slice(2),["out","from","to","roles","profile","runtime","dws","device","skip-install","help"],["device","skip-install","help"]);
    if(options.help)help();else await oneCommandExport(options);
  }catch(e){console.error(JSON.stringify({status:"failed",message:e.message}));process.exitCode=1;}
}
