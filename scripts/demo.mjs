import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {request} from '../plugins/agentgit/runtime/common.mjs';
try {
 const access=JSON.parse(readFileSync(resolve(process.env.AGENTGIT_HOST_DATA||'.agentgit/host','access.json'),'utf8'));
 await request(access.base,'/api/demo',access.admin,{});
 const url=access.base+'/#key='+access.viewer;
 writeFileSync('.agentgit/demo-url.txt',url);
 console.log('样例房间已就绪（3 份 fixture 提案，不代表真人提交）。\n'+url);
} catch(e) {console.error('请先运行 npm start。'+e.message);process.exitCode=1;}
