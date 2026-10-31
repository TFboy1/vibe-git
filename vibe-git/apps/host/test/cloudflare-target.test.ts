import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {buildApp} from '../src/app.js';
import {CloudflareTunnelManager} from '../src/integrations/cloudflare/manager.js';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it.each([{host:'127.0.0.1',override:undefined},{host:'127.0.0.1',override:'http://127.0.0.1:45678'},{host:'::1',override:undefined}])('routes a tunnel to the actual listening address, unless explicitly overridden: %j',async({host,override})=>{
 vi.stubEnv('PORT','65500');vi.stubEnv('VIBE_GIT_TUNNEL_TARGET',override);
 const directory=await mkdtemp(join(tmpdir(),'vibe-tunnel-target-'));
 let target='';vi.spyOn(CloudflareTunnelManager.prototype,'start').mockImplementation(async function(){target=this.targetUrl;return {phase:'running',installed:true,running:true,version:'fixture',url:'https://fixture.invalid',logs:[],lastError:null,updatedAt:new Date().toISOString()};});
 const app=await buildApp({dbPath:':memory:',dataDir:directory,staticDir:false,backupDatabase:false});
 try{
  const origin=await app.listen({host,port:0}),captain=JSON.parse(await readFile(join(directory,'captain.json'),'utf8'));
  const response=await fetch(origin+'/api/v1/local/cloudflare/start',{method:'POST',headers:{Authorization:`Bearer ${captain.nodeToken}`}});
  expect(response.status).toBe(200);expect(target).toBe(override??origin);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
