import fs from "node:fs/promises";
import {createWriteStream} from "node:fs";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {Readable,Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {pathToFileURL} from "node:url";
import {args,callDws,locateDws,readJson,writeJson,diagnostic} from "./common.mjs";

const attachmentLabel=/(附件|图片|文件|attachment|image|photo|file)/i;
const windowsReserved=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function parsed(value){
  if(typeof value!=="string")return value;
  const trimmed=value.trim();
  if(!trimmed || !["[","{"].includes(trimmed[0]))return value;
  try{return JSON.parse(trimmed);}catch{return value;}
}

function asSize(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?Math.trunc(n):null;
}

function addCandidate(out,seen,value,context){
  if(!value||typeof value!=="object"||Array.isArray(value)||!value.fileId)return false;
  const fileId=String(value.fileId),spaceId=value.spaceId==null?"":String(value.spaceId);
  const key=`file:${spaceId}:${fileId}:${context.withCommentAttachment?"comment":"form"}`;
  if(seen.has(key))return true;
  seen.add(key);
  out.push({
    key,source:context.source,fieldName:context.fieldName,fileId,spaceId,
    fileName:String(value.fileName||value.name||`附件_${fileId}`),
    fileSize:asSize(value.fileSize??value.size),fileType:String(value.fileType||value.extension||""),
    withCommentAttachment:Boolean(context.withCommentAttachment)
  });
  return true;
}

function walk(value,context,out,seen,depth=0){
  if(depth>12||value==null)return;
  value=parsed(value);
  if(typeof value==="string"){
    if(context.allowDirect&&/^https:\/\//i.test(value)){
      const key="url:"+value;
      if(!seen.has(key)){seen.add(key);out.push({key,source:context.source,fieldName:context.fieldName,sourceUrl:value,fileName:"",fileSize:null,fileType:"",withCommentAttachment:false});}
    }
    return;
  }
  if(Array.isArray(value)){for(const item of value)walk(item,context,out,seen,depth+1);return;}
  if(typeof value!=="object")return;
  if(addCandidate(out,seen,value,context))return;
  for(const [key,item] of Object.entries(value)){
    if(key==="thumbnail")continue;
    walk(item,{...context,allowDirect:context.allowDirect&&/(url|uri|src|download)/i.test(key)},out,seen,depth+1);
  }
}

export function extractAttachments(detail){
  const out=[],seen=new Set();
  for(const [index,field] of (detail?.formValueVOS||[]).entries()){
    const fieldName=String(field?.name||field?.id||`表单字段_${index+1}`);
    const context={source:"form",fieldName,allowDirect:attachmentLabel.test(fieldName),withCommentAttachment:false};
    walk(field?.value,context,out,seen);
    walk(field?.details,context,out,seen);
  }
  for(const key of ["attachments","attachmentList","files"]){
    walk(detail?.[key],{source:"detail",fieldName:"审批附件",allowDirect:true,withCommentAttachment:false},out,seen);
  }
  for(const key of ["operationRecords","_supplementalRecords","comments"]){
    walk(detail?.[key],{source:"comment",fieldName:"审批评论附件",allowDirect:false,withCommentAttachment:true},out,seen);
  }
  return out;
}

export function safePart(value,fallback="未命名"){
  let result=String(value||fallback).normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001F]/g,"_").replace(/[. ]+$/g,"").trim();
  if(!result)result=fallback;
  if(windowsReserved.test(result))result="_"+result;
  return result.slice(0,120);
}

function approvalCategory(entry){
  const list=entry.listItem||{},detail=entry.detail||{};
  const title=String(list.title||detail.title||detail.processInstanceTitle||"");
  return String(detail.processName||title.match(/提交的(.+)$/s)?.[1]||detail.processCode||"未识别类型");
}

function nameFromUrl(url,index){
  try{
    const name=decodeURIComponent(new URL(url).pathname.split("/").pop()||"");
    if(name&&name.includes("."))return name;
  }catch{}
  return `图片_${index+1}.bin`;
}

function downloadUrl(payload){
  const result=payload?.result;
  const value=typeof result==="string"?result:result?.downloadUri||result?.downloadUrl||result?.url;
  if(typeof value!=="string"||!value)throw Error("附件下载接口没有返回 downloadUri");
  const parsedUrl=new URL(value);
  if(parsedUrl.protocol!=="https:")throw Error("附件下载地址不是 HTTPS");
  return value;
}

function directMediaUrl(value){
  const url=new URL(value),host=url.hostname.toLowerCase();
  const allowed=["dingtalk.com","dingtalk.cn","alicdn.com","aliyuncs.com"].some(domain=>host===domain||host.endsWith("."+domain));
  if(url.protocol!=="https:"||!allowed)throw Error("表单直链不是受信任的钉钉/阿里云 HTTPS 地址");
  return value;
}

async function downloadFile(url,target,{fetchImpl,maxBytes,budget,expectedSize}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
  const temp=target+"."+randomUUID()+".tmp";
  try{
    const response=await fetchImpl(url,{redirect:"follow",signal:controller.signal});
    if(!response.ok||!response.body)throw Error(`附件下载失败: HTTP ${response.status}`);
    if(new URL(response.url||url).protocol!=="https:")throw Error("附件重定向到了非 HTTPS 地址");
    const declared=asSize(response.headers.get("content-length"));
    if(declared!=null&&declared>maxBytes)throw Error(`附件超过单文件上限: ${declared}`);
    if(declared!=null&&budget.used+declared>budget.max)throw Error("附件超过本次下载总量上限");
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    let size=0;const hash=createHash("sha256");
    const counter=new Transform({transform(chunk,_encoding,callback){
      size+=chunk.length;
      if(size>maxBytes||budget.used+size>budget.max)return callback(Error("附件下载超过大小上限"));
      hash.update(chunk);callback(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body),counter,createWriteStream(temp,{flags:"wx",mode:0o600}));
    if(expectedSize!=null&&size!==expectedSize)throw Error(`附件大小不一致: 预期 ${expectedSize}，实际 ${size}`);
    await fs.link(temp,target);await fs.unlink(temp);budget.used+=size;
    return {sizeBytes:size,sha256:hash.digest("hex")};
  }finally{
    clearTimeout(timer);await fs.unlink(temp).catch(()=>{});
  }
}

async function authorizeFiles(items,request,failures){
  async function authorize(batch){
    try{
      await request(["oa","approval","attachment","authorize-download","--file-infos",JSON.stringify(batch.map(({item})=>({spaceId:Number(item.spaceId),fileId:item.fileId})))]);
      return new Set();
    }catch(error){
      if(batch.length>1){
        const mid=Math.ceil(batch.length/2),left=await authorize(batch.slice(0,mid)),right=await authorize(batch.slice(mid));
        return new Set([...left,...right]);
      }
      failures.push({key:batch[0].item.key,stage:"authorize",...diagnostic(error)});return new Set([batch[0].pair]);
    }
  }
  const groups=new Map();
  for(const item of items){const pair=`${item.spaceId}:${item.fileId}`;if(!groups.has(pair))groups.set(pair,[]);groups.get(pair).push(item);}
  const invalidPairs=new Set(),unique=[...groups].map(([pair,values])=>({pair,item:values[0]}));
  for(const {pair,item} of unique)if(!/^\d+$/.test(item.spaceId)||!Number.isSafeInteger(Number(item.spaceId))){
    invalidPairs.add(pair);failures.push({key:item.key,stage:"authorize",message:"附件缺少有效的数字 spaceId"});
  }
  const valid=unique.filter(({pair})=>!invalidPairs.has(pair));
  for(let i=0;i<valid.length;i+=10)for(const pair of await authorize(valid.slice(i,i+10)))invalidPairs.add(pair);
  return new Set([...invalidPairs].flatMap(pair=>(groups.get(pair)||[]).map(item=>item.key)));
}

export async function downloadAttachments(options){
  const dir=path.resolve(options.dir),entries=await readJson(path.join(dir,"approvals.json"));
  const maxFileBytes=Number(options.maxFileBytes||512*1024*1024),maxTotalBytes=Number(options.maxTotalBytes||5*1024*1024*1024);
  if(!Number.isSafeInteger(maxFileBytes)||maxFileBytes<1||!Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<maxFileBytes)throw Error("附件大小上限无效");
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  if(typeof fetchImpl!=="function")throw Error("当前 Node.js 不支持 fetch");
  const request=options.request||(argv=>callDws(options.command,options.profile,argv));
  let priorArchive={attachments:[]};
  try{priorArchive=await readJson(path.join(dir,"attachments.json"));}catch(error){if(error.code!=="ENOENT")throw error;}
  const priorByToken=new Map((priorArchive.attachments||[]).map(item=>[`${item.instanceId}\u0000${item.key}`,item]));
  const all=[];
  for(const entry of entries){
    const extracted=extractAttachments(entry.detail);
    extracted.forEach((attachment,index)=>all.push({entry,attachment,index}));
  }
  const reusable=new Map();
  for(const {entry,attachment} of all){
    const token=`${entry.processInstanceId}\u0000${attachment.key}`,prior=priorByToken.get(token);
    if(prior?.status!=="downloaded"||!prior.localPath)continue;
    const file=path.resolve(dir,prior.localPath);
    if(!file.startsWith(dir+path.sep))continue;
    try{
      const bytes=await fs.readFile(file),digest=createHash("sha256").update(bytes).digest("hex");
      if(bytes.length===prior.sizeBytes&&digest===prior.sha256)reusable.set(token,{...prior,sizeBytes:bytes.length,sha256:digest,resumed:true});
    }catch{}
  }
  const failures=[];
  const blocked=await authorizeFiles(all.filter(v=>!reusable.has(`${v.entry.processInstanceId}\u0000${v.attachment.key}`)).map(v=>v.attachment).filter(v=>v.fileId&&v.spaceId),request,failures);
  const budget={used:0,max:maxTotalBytes};let downloaded=0,skipped=0;
  for(const entry of entries){
    const extracted=extractAttachments(entry.detail),saved=[];
    for(const [index,attachment] of extracted.entries()){
      const token=`${entry.processInstanceId}\u0000${attachment.key}`,prior=reusable.get(token);
      const fileName=safePart(attachment.fileName||nameFromUrl(attachment.sourceUrl,index));
      const relative=path.join("attachments",safePart(approvalCategory(entry)),safePart(entry.processInstanceId),`${String(index+1).padStart(2,"0")}_${fileName}`).split(path.sep).join("/");
      const target=path.resolve(dir,relative);
      const item={...attachment,fileName,localPath:relative,status:"pending"};
      try{
        if(!target.startsWith(dir+path.sep))throw Error("附件路径越界");
        if(prior){
          Object.assign(item,prior,{key:attachment.key,source:attachment.source,fieldName:attachment.fieldName,fileId:attachment.fileId,spaceId:attachment.spaceId,fileName,sourceUrl:attachment.sourceUrl});
          budget.used+=prior.sizeBytes;skipped++;saved.push(item);continue;
        }
        if(blocked.has(attachment.key))throw Error("附件下载授权失败");
        let url=attachment.sourceUrl;
        if(attachment.fileId){
          const payload=await request(["oa","approval","attachment","download-url","--instance-id",entry.processInstanceId,"--file-id",attachment.fileId,...(attachment.withCommentAttachment?["--with-comment-attachment"]:[])]);
          url=downloadUrl(payload);
        }
        if(!url)throw Error("附件没有可用下载地址");
        if(attachment.sourceUrl)url=directMediaUrl(url);
        const result=await downloadFile(url,target,{fetchImpl,maxBytes:maxFileBytes,budget,expectedSize:attachment.fileSize});
        Object.assign(item,{status:"downloaded",...result});downloaded++;
      }catch(error){
        item.status="failed";item.error=diagnostic(error);failures.push({instanceId:entry.processInstanceId,fileName,localPath:relative,...item.error});
      }
      saved.push(item);
    }
    entry.attachments=saved;
  }
  const flat=entries.flatMap(entry=>(entry.attachments||[]).map(item=>({instanceId:entry.processInstanceId,approvalType:approvalCategory(entry),...item})));
  const summary={requested:true,total:flat.length,downloaded:flat.filter(v=>v.status==="downloaded").length,failed:flat.filter(v=>v.status==="failed").length,downloadedThisRun:downloaded,resumed:skipped,bytes:budget.used,complete:failures.length===0,failures};
  await writeJson(path.join(dir,"approvals.json"),entries);
  await writeJson(path.join(dir,"attachments.json"),{summary,attachments:flat});
  const manifest=await readJson(path.join(dir,"manifest.json"));manifest.attachments=summary;await writeJson(path.join(dir,"manifest.json"),manifest);
  console.log(JSON.stringify({phase:"attachments",...summary,failures:undefined}));
  return summary;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const o=args(process.argv.slice(2),["dir","profile","dws","runtime","max-file-bytes","max-total-bytes"]);
    if(!o.dir||!o.profile)throw Error("--dir and --profile are required");
    const command=locateDws(o.dws,o.runtime);if(!command)throw Error("DWS not found");
    const result=await downloadAttachments({dir:o.dir,profile:o.profile,command,maxFileBytes:o["max-file-bytes"],maxTotalBytes:o["max-total-bytes"]});
    if(!result.complete)process.exitCode=2;
  }catch(error){console.error(JSON.stringify(diagnostic(error)));process.exitCode=1;}
}
