import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {collectWindow,decodePage,exportArchive} from "./export-oa-history.mjs";
import {workbookModel,buildArchive} from "./build-workbook.mjs";
import {writeJson,readJson,checkedPayload,validDate} from "./common.mjs";
import {selectProfile} from "./run.mjs";
import {validateArchive} from "./validate-export.mjs";

test("empty pages without hasMore terminate, malformed non-empty pages do not",()=>{
  const empty=decodePage({result:{values:[]}});
  assert.equal(empty.hasMore,false);assert.equal(empty._inferredTerminal,true);
  assert.throws(()=>decodePage({result:{values:[{processInstanceId:"a"}]}}));
  assert.throws(()=>decodePage({result:{values:null,hasMore:false}}));
  assert.throws(()=>checkedPayload('{"success":false,"result":{}}'));
  assert.throws(()=>validDate("2025-02-30"));
});
test("profile selection uses explicit or unique current identity",()=>{
  const profiles=[{profile:"a:u1",corpName:"A"},{profile:"b:u2",corpName:"B",isCurrent:true}];
  assert.equal(selectProfile(profiles).profile,"b:u2");
  assert.equal(selectProfile(profiles,"a:u1").profile,"a:u1");
  assert.throws(()=>selectProfile(profiles.map(p=>({...p,isCurrent:false}))));
});
test("date split retains every parent ID",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"oa-split-")),manifest={pages:0,segments:[]};
  const request=async a=>{
    const start=a[a.indexOf("--create-time-from")+1],end=a[a.indexOf("--create-time-to")+1];
    const ids=start===end?(start==="2025-01-01"?["a"]:["b"]):["a","b"];
    return {result:{values:ids.map(id=>({processInstanceId:id})),hasMore:start!==end}};
  };
  const rows=await collectWindow({role:"submitted",start:"2025-01-01",end:"2025-01-02",request,dir,manifest,splitAfter:1});
  assert.equal(rows.length,2);assert.equal(manifest.segments.length,2);
});
test("dedupe, missing detail supplements, resume, and archive binding",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"oa-fixture-"));
  const item={processInstanceId:"fixture-1",title:"测试用户提交的采购审批",processCreateTime:"1735689600000"};
  let calls=0;
  const request=async a=>{
    calls++;
    if(a[2].startsWith("list-"))return {result:{values:[item],hasMore:false}};
    if(a[2]==="records")return {result:{operationRecords:[{type:"START",userId:"fixture-user"}]}};
    if(a[2]==="tasks")return {result:{taskIdList:[{taskId:"fixture-task"}]}};
    return {result:{processInstanceId:item.processInstanceId,processCode:"fixture-proc",status:"COMPLETED",formValueVOS:[{name:"用途",value:"脱敏样例"}]}};
  };
  const options={profile:"fixture-corp:fixture-user",out:dir,from:"2025-01-01",to:"2025-12-31"};
  const m=await exportArchive(options,request);assert.equal(m.complete,true);assert.equal(m.uniqueInstances,1);assert.equal(calls,6);
  const rows=await readJson(path.join(dir,"approvals.json"));assert.equal(rows[0].sourceRoles.length,3);assert.equal(rows[0].detail._supplementalRecords.length,1);
  await exportArchive({...options,resume:true},request);assert.equal(calls,6);
  await assert.rejects(exportArchive({...options,resume:true,profile:"other:user"},request));
  if(process.env.OA_TEST_MODULES){
    await buildArchive({dir,modules:process.env.OA_TEST_MODULES,engine:"artifact",preview:true});
    assert.ok((await fs.stat(path.join(dir,"钉钉历史审批.xlsx"))).size>1000);
    const validation=await validateArchive(dir);
    assert.deepEqual(validation.errors,[]);
    assert.equal(validation.records,1);
    console.log("FIXTURE_ARCHIVE="+dir);
  }
});
test("long raw strings split without loss; Shanghai dates and sheet collisions",()=>{
  const raw="😀".repeat(20000);
  const entries=["P1","P2"].map((code,i)=>({processInstanceId:"fixture-"+i,sourceRoleLabels:["我发起"],listItem:{title:"匿名提交的同名流程",processCreateTime:1735689600000},detail:{processCode:code,status:"COMPLETED",formValueVOS:[{name:"长文本",value:raw}]}}));
  const model=workbookModel(entries,{complete:true,query:{},failures:[]});
  assert.notEqual(model[2].name,model[3].name);
  const s=model[2],headers=s.headers,values=s.rows[0];
  assert.equal(values[7].toISOString(),"2025-01-01T08:00:00.000Z");
  const data=headers.map((h,i)=>h.startsWith("字段：长文本")?values[i]:"").join("");
  assert.equal(data,raw);assert.ok(values.every(v=>typeof v!=="string"||v.length<=32767));
});
