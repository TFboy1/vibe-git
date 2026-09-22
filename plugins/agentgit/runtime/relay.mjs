import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Client} from './client.mjs';
import {startLive} from './live.mjs';
import {assert,jsonBody,reply,id} from './common.mjs';
export const defaultData=()=>resolve(process.env.AGENTGIT_RELAY_DATA||join(homedir(),'.agentgit','relay'));
export function createRelay(dataDir){mkdirSync(dataDir,{recursive:true});const keyPath=join(dataDir,'ipc-key');if(!existsSync(keyPath))writeFileSync(keyPath,id()+id(),{mode:0o600});const key=readFileSync(keyPath,'utf8');const client=new Client(join(dataDir,'relay.db'));
  const server=createServer(async(req,res)=>{try{assert(!req.headers.origin,'不接受浏览器跨域调用',403);assert(req.headers.authorization===`Bearer ${key}`,'本地 IPC 认证失败',401);assert(req.method==='POST','仅支持 POST',405);const input=await jsonBody(req);const actions={join:()=>client.join(input),prepare:()=>client.prepare(input),submit:()=>client.submit(input),sync:()=>client.sync(),tasks:()=>client.readTasks(),receipt:()=>client.receipt(input)};const action=actions[req.url.slice(1)];assert(action,'未知操作',404);reply(res,200,await action());}catch(e){reply(res,e.status||500,{error:e.status?e.message:'Relay 连接失败，请检查 Host 地址和运行状态'});}});
  let busy=false;const sync=async()=>{if(busy)return;busy=true;try{await client.sync();}catch{}finally{busy=false;}};
  const timer=setInterval(sync,3000);timer.unref();const stopLive=startLive(client,sync);
  return {server,client,key,stop:()=>{clearInterval(timer);stopLive();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const dataDir=defaultData();const relay=createRelay(dataDir);relay.server.listen(Number(process.env.AGENTGIT_RELAY_PORT||4400),'127.0.0.1',()=>console.log('AgentGit Relay ready'));for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>{relay.stop();relay.server.close(()=>{relay.client.close();process.exit(0);});});}
