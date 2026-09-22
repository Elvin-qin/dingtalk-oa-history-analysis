import {args,locateDws,runtimeDirectory,run,callDws,diagnostic} from "./common.mjs";
const options=args(process.argv.slice(2),["dws","runtime","account"],["account"]);
const runtime=options.runtime || runtimeDirectory();
const command=locateDws(options.dws,runtime);
const result={os:process.platform,arch:process.arch,node:process.version,nodeExecutable:process.execPath,runtime,dws:command};
if(command) {
  try{const v=await run(command,["--version"]);result.version=v.stdout.trim();result.versionExitCode=v.code;}catch(e){result.error=diagnostic(e);}
  if(options.account) {
    try{const list=await callDws(command,null,["profile","list"]);result.accounts=list.profiles?.map(p=>({profile:p.profile,corpName:p.corpName,userName:p.userName,isCurrent:p.isCurrent,isOrgCurrent:p.isOrgCurrent,status:p.status}));}catch(e){result.accountError=diagnostic(e);}
  }
}
console.log(JSON.stringify(result,null,2));
if(!command) process.exitCode=2;

