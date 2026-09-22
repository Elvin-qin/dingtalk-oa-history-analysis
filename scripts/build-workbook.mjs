import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {args,readJson,writeJson,sha} from "./common.mjs";

const text=v=>v==null?"":typeof v==="string"?v:JSON.stringify(v);
const json=v=>JSON.stringify(v??null);
function colName(n){let s="";for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function chunks(value, limit=30000) {
  let str=text(value), out=[];
  while(str.length>limit) {
    let n=limit;
    if(/[\uD800-\uDBFF]/.test(str[n-1]))n--;
    out.push(str.slice(0,n));str=str.slice(n);
  }
  out.push(str);return out;
}
function sheetName(name, used) {
  const base=(name.replace(/[\[\]:*?/\\]/g,"·").replace(/^'+|'+$/g,"").trim()||"未识别类型").slice(0,28);
  let candidate=base,n=2;
  while(used.has(candidate.toLowerCase())) candidate=base.slice(0,27)+"_"+n++;
  used.add(candidate.toLowerCase());return candidate;
}
const statuses={COMPLETED:"已完成",RUNNING:"审批中",TERMINATED:"已终止",NEW:"新建"};
function excelLocalDate(value) {
  if(value==null || value==="")return null;
  const millis=/^\d+$/.test(String(value))?Number(value):Date.parse(value);
  if(!Number.isFinite(millis))return null;
  // Excel dates have no timezone. Store Asia/Shanghai wall-clock as a serial.
  return new Date(millis+8*3600000);
}
function asFields(detail) {
  const fields={};
  for(const [i,field]of (detail?.formValueVOS||[]).entries()) {
    const label=text(field.name||field.id||("说明_"+(i+1)));
    let key=label,n=2;
    while(Object.hasOwn(fields,key))key=label+"_"+n++;
    fields[key]=text(field.value);
    const nested=(field.details||[]).filter(v=>v&&Object.values(v).some(x=>x!=null));
    if(nested.length)fields[key+"（明细）"]=json(nested);
  }
  return fields;
}
export function workbookModel(entries,manifest) {
  const used=new Set(["总览","全部审批索引","附件汇总","抓取异常"]);
  const grouped=new Map();
  const rows=entries.map(entry=>{
    const list=entry.listItem||{},d=entry.detail||{};
    const title=text(list.title||d.title||d.processInstanceTitle);
    const titleType=title.match(/提交的(.+)$/s)?.[1];
    const category=text(d.processName||titleType||d.processCode||"未识别类型");
    const processKey=d.processCode ? String(d.processCode):"title:"+category;
    if(!grouped.has(processKey))grouped.set(processKey,{category,code:d.processCode||"",rows:[]});
    const row={
      instance:entry.processInstanceId,category,source:(entry.sourceRoleLabels||[]).join("、"),
      title,originator:text(list.originatorName||d.originatorUserid),
      department:text(d.originatorDeptName),status:statuses[d.status||list.status]||text(d.status||list.status),
      result:text(d.processInstanceResult),business:text(d.businessId),code:text(d.processCode),
      created:excelLocalDate(d.createTime||list.processCreateTime),finished:excelLocalDate(d.finishTime||list.processEndTime),
      url:text(list.url||list.pcUrl),fields:asFields(d),
      attachments:entry.attachments||[],
      operations:json(d.operationRecords||d._supplementalRecords||[]),tasks:json(d.tasks||d._supplementalTasks||[]),
      raw:json(d),sources:json(entry.sourceItems||{}),rawPath:entry.detailFile||"",
      summary:text(list.formMassage).replace(/<br\s*\/?>/gi,"\n")
    };
    grouped.get(processKey).rows.push(row);return row;
  });
  const groups=[...grouped.values()].sort((a,b)=>b.rows.length-a.rows.length||a.category.localeCompare(b.category));
  groups.forEach(g=>{g.sheet=sheetName(g.category,used);g.rows.sort((a,b)=>(b.created?.getTime()||0)-(a.created?.getTime()||0));});
  const sheets=[];
  const mainHeaders=["审批类型","工作表","数量","模板代码"];
  const scope=manifest.query||{};
  sheets.push({name:"总览",headers:mainHeaders,rows:groups.map(g=>[g.category,g.sheet,g.rows.length,g.code]),widths:[38,32,10,45],notes:[
    "账号："+(manifest.account?.corpName||"")+" / "+(manifest.account?.userName||scope.profile||""),
    "查询范围："+(scope.from||"")+" 至 "+(scope.to||"")+"；时间：Asia/Shanghai",
    "唯一实例："+rows.length+"；抓取完整："+Boolean(manifest.complete)+"；详情失败："+(manifest.failures?.length||0),
    "来源数量存在角色重叠。按模板代码分类，名称用于显示；不同模板同名时自动加后缀。",
    manifest.attachments?.requested?`附件：发现 ${manifest.attachments.total||0} 个，已下载 ${manifest.attachments.downloaded||0} 个，失败 ${manifest.attachments.failed||0} 个。`:
      "附件仅保留表单元数据；需要本地文件或读取附件内容时使用附件下载模式。",
    "来源：DingTalk OA / DWS；抓取完成时间："+(manifest.finishedAt||manifest.startedAt||"")
  ]});
  const baseHeaders=["审批实例ID","来源角色","状态","审批结果","标题","发起人","发起部门","发起时间","完成时间","业务编号","模板代码","钉钉链接","附件数","附件下载状态","附件名称","附件本地路径"];
  const base=r=>[r.instance,r.source,r.status,r.result,r.title,r.originator,r.department,r.created,r.finished,r.business,r.code,r.url,r.attachments.length,
    r.attachments.length?(r.attachments.every(v=>v.status==="downloaded")?"已下载":r.attachments.some(v=>v.status==="failed")?"部分失败":"仅元数据"):"无附件",
    r.attachments.map(v=>v.fileName).join("\n"),r.attachments.map(v=>v.localPath||"").filter(Boolean).join("\n")];
  const widths=[36,20,12,12,42,14,28,22,22,24,40,40,10,14,36,55];
  sheets.push({name:"全部审批索引",headers:["审批类型",...baseHeaders],rows:rows.map(r=>[r.category,...base(r)]),widths:[32,...widths],dates:[8,9]});
  const attachmentRows=rows.flatMap(r=>r.attachments.map(v=>[r.category,r.instance,r.title,v.fieldName||"",v.fileName||"",v.fileType||"",v.fileSize??v.sizeBytes??"",v.status||"仅元数据",v.localPath||"",v.error?.message||""]));
  if(attachmentRows.length)sheets.push({name:"附件汇总",headers:["审批类型","审批实例ID","审批标题","来源字段","附件名称","文件类型","文件大小（字节）","下载状态","本地路径","失败原因"],rows:attachmentRows,widths:[28,36,42,24,38,12,18,14,60,48]});
  for(const g of groups) {
    const names=[...new Set(g.rows.flatMap(r=>Object.keys(r.fields)))];
    const slots=[...names.map(key=>({key:"字段："+key,read:r=>r.fields[key]||""})),
      {key:"列表摘要",read:r=>r.summary},{key:"审批记录",read:r=>r.operations},{key:"任务信息",read:r=>r.tasks},
      {key:"原始详情文件",read:r=>r.rawPath},{key:"完整详情JSON",read:r=>r.raw},{key:"来源JSON",read:r=>r.sources}];
    const parts=slots.map(s=>Math.max(1,...g.rows.map(r=>chunks(s.read(r)).length)));
    const headers=[...baseHeaders,...slots.flatMap((s,i)=>Array.from({length:parts[i]},(_,n)=>s.key+(parts[i]>1?"_"+(n+1):"")))];
    const data=g.rows.map(r=>[...base(r),...slots.flatMap((s,i)=>{const c=chunks(s.read(r));return Array.from({length:parts[i]},(_,n)=>c[n]||"");})]);
    if(headers.length>16384 || data.length+6>1048576)throw Error("Excel dimension limit exceeded");
    sheets.push({name:g.sheet,headers,rows:data,widths:[...widths,...headers.slice(baseHeaders.length).map(()=>32)],dates:[7,8]});
  }
  if(manifest.failures?.length)sheets.push({name:"抓取异常",headers:["实例ID","错误"],rows:manifest.failures.map(f=>[f.instanceId||"",json(f)]),widths:[38,80]});
  for(const sheet of sheets) for(const row of [sheet.headers,...sheet.rows]) for(const v of row) {
    if(typeof v==="string" && v.length>32767)throw Error("Unsplit text exceeds Excel cell limit");
  }
  return sheets;
}
export async function buildArchive(options) {
  if(!options.dir)throw Error("--dir required");
  const dir=path.resolve(options.dir),manifest=await readJson(path.join(dir,"manifest.json"));
  if(!manifest.complete && !options["allow-partial"]) throw Error("Incomplete archive; use --allow-partial only when intentionally delivering partial data");
  const entries=await readJson(path.join(dir,"approvals.json"));
  if(entries.length!==manifest.uniqueInstances)throw Error("Archive count does not match manifest");
  const sheets=workbookModel(entries,manifest);
  const require=createRequire(options.modules?path.join(path.resolve(options.modules),"..","runtime-resolver.cjs"):import.meta.url);
  let engine=options.engine||"artifact",lib;
  if(!["artifact","exceljs"].includes(engine))throw Error("engine must be artifact or exceljs");
  try{lib=await import(pathToFileURL(require.resolve(engine==="artifact"?"@oai/artifact-tool":"exceljs")).href);}
  catch(e){throw Error("Missing "+engine+" runtime; see references/workbook.md. "+e.code);}
  const output=path.join(dir,manifest.complete?"钉钉历史审批.xlsx":"钉钉历史审批_未完整.xlsx");
  const temp=output+".tmp.xlsx";
  if(engine==="artifact") {
    const {Workbook,SpreadsheetFile}=lib;
    const book=Workbook.create();
    for(const [i,data] of sheets.entries()){
      const s=book.worksheets.add(data.name);s.showGridLines=false;
      s.getRange("A2").values=[[data.name]];s.getRange("A2").format.font={name:"Arial",size:14,bold:true,color:"#1F4E78"};
      const count=Math.max(data.rows.length,1), cols=data.headers.length;
      const body=s.getRangeByIndexes(4,0,count+1,cols);
      body.format.font={name:"Arial",size:10,color:"#243447"};body.format.rowHeight=42;body.format.verticalAlignment="center";
      s.getRangeByIndexes(4,0,1,cols).values=[data.headers];
      if(data.rows.length)s.getRangeByIndexes(5,0,data.rows.length,cols).values=data.rows;
      const header=s.getRangeByIndexes(4,0,1,cols);header.format.fill="#1F4E78";header.format.font={name:"Arial",size:10,bold:true,color:"#FFFFFF"};header.format.wrapText=true;header.format.horizontalAlignment="center";
      for(let c=0;c<cols;c++)s.getRangeByIndexes(4,c,count+1,1).format.columnWidth=data.widths?.[c]||28;
      for(const c of data.dates||[])s.getRangeByIndexes(5,c,count,1).setNumberFormat("yyyy-mm-dd hh:mm");
      if(data.rows.length) {
        const table=s.tables.add("A5:"+colName(cols-1)+(data.rows.length+5),true,"ApprovalTable"+i);
        table.style="TableStyleMedium2";
      }
      s.freezePanes.freezeRows(5);s.freezePanes.freezeColumns(2);
      if(data.notes){
        const top=count+7;
        s.getRangeByIndexes(top,0,data.notes.length,1).values=data.notes.map(n=>[n]);
      }
    }
    book.recalculate();
    await fs.mkdir(path.join(dir,"qa"),{recursive:true});
    await writeJson(path.join(dir,"qa","inspect.json"),await book.inspect({kind:"workbook,sheet,table",maxChars:12000,tableMaxRows:2,tableMaxCols:5}));
    if(options.preview)for(const [i,data]of sheets.entries()){
      const png=await book.render({sheetName:data.name,autoCrop:"all",scale:0.65,format:"png"});
      await fs.writeFile(path.join(dir,"qa",String(i+1).padStart(2,"0")+".png"),new Uint8Array(await png.arrayBuffer()));
    }
    const file=await SpreadsheetFile.exportXlsx(book);await file.save(temp);
  } else {
    const ExcelJS=lib.default,book=new ExcelJS.Workbook();
    book.creator="DingTalk OA History Export";
    for(const data of sheets) {
      const s=book.addWorksheet(data.name,{views:[{state:"frozen",ySplit:5,xSplit:2,showGridLines:false}]});
      s.getCell("A2").value=data.name;s.getCell("A2").font={name:"Arial",size:14,bold:true,color:{argb:"FF1F4E78"}};
      s.getRow(5).values=data.headers;
      data.rows.forEach(row=>s.addRow(row));
      s.columns.forEach((col,i)=>{col.width=data.widths?.[i]||28;col.font={name:"Arial",size:10};});
      s.getRow(5).eachCell(cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1F4E78"}};cell.font={name:"Arial",size:10,bold:true,color:{argb:"FFFFFFFF"}};cell.alignment={horizontal:"center",vertical:"middle",wrapText:true};});
      for(let r=6;r<=5+data.rows.length;r++){
        s.getRow(r).height=42;
        s.getRow(r).eachCell(c=>{c.alignment={vertical:"middle"};if(r%2===0)c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFEAF3F8"}};});
        for(const c of data.dates||[])s.getCell(r,c+1).numFmt="yyyy-mm-dd hh:mm";
      }
      s.autoFilter={from:{row:5,column:1},to:{row:5,column:data.headers.length}};
      for(const [i,note]of (data.notes||[]).entries())s.getCell(8+data.rows.length+i,1).value=note;
    }
    await book.xlsx.writeFile(temp);
    const check=new ExcelJS.Workbook();await check.xlsx.readFile(temp);
    if(check.worksheets.length!==sheets.length)throw Error("Workbook sheet count mismatch after readback");
  }
  await fs.rename(temp,output);
  const digest=sha(await fs.readFile(output));
  await writeJson(path.join(dir,"workbook-manifest.json"),{workbook:path.basename(output),sha256:digest,engine,sheets:sheets.map(s=>({name:s.name,rows:s.rows.length})),records:entries.length,createdAt:new Date().toISOString()});
  console.log(JSON.stringify({output,engine,sheets:sheets.length,records:entries.length,sha256:digest}));
  return {output,sheets};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{await buildArchive(args(process.argv.slice(2),["dir","modules","engine","preview","allow-partial"],["preview","allow-partial"]));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
