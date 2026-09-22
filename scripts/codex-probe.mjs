import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync} from 'node:fs';
const child=spawn('codex',['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
const waiting=new Map();let sequence=0;const notifications=[];
child.stderr.on('data',chunk=>{for(const line of chunk.toString().split('\n'))if(/agentgit|Cannot find module|MODULE_NOT_FOUND/.test(line))console.error(line.slice(0,1000));});
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{try{const message=JSON.parse(line);if(message.id!==undefined&&waiting.has(message.id)){const {resolve,reject,timer}=waiting.get(message.id);clearTimeout(timer);waiting.delete(message.id);message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result);}else if(message.method){notifications.push({method:message.method});if(message.id!==undefined)child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Probe does not approve requests'}})+'\n');}}catch{}});
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{waiting.delete(id);reject(Error(method+' timeout'));},45000);waiting.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
try{
 const init=await rpc('initialize',{clientInfo:{name:'agentgit_m0_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const skills=await rpc('skills/list',{cwds:[process.cwd()],forceReload:true});
 const pluginSkills=(skills.data||[]).flatMap(d=>(d.skills||[]).filter(s=>s.name.includes('agentgit')));
 const modes=await rpc('collaborationMode/list',{});
 const servers=await rpc('mcpServerStatus/list',{limit:100});
 const pluginServers=(servers.data||[]).filter(s=>JSON.stringify(s).includes('agentgit'));
 const evidence={timestamp:new Date().toISOString(),userAgent:init.userAgent,pluginSkills,pluginServers,modes,notes:['Inventory only. No native Plan turn or user confirmation is claimed.']};
 mkdirSync('evidence',{recursive:true});writeFileSync('evidence/codex-inventory.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}finally{for(const {timer} of waiting.values())clearTimeout(timer);child.stdin.end();setTimeout(()=>child.kill(),1000).unref();}
