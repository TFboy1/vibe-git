import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {defaultData} from './relay.mjs';
import {request} from './common.mjs';
const string={type:'string'};
const defs=[
 ['join_room','join','加入房间并持久化本机成员、仓库绑定。不输出凭据。',{host:string,invite:string,name:string,repository:string}],
 ['prepare_submission','prepare','冻结用户选定的完整项目提案并返回预览。这是本地写入，不是只读。',{body:string,repository:string}],
 ['submit_proposal','submit','仅在用户已确认同一冻结正文和 hash 后提交。超时返回待确认，幂等重试。',{submission_id:string,content_hash:string,confirmed:{type:'boolean',const:true}}],
 ['sync','sync','同步收件箱并记录送达状态，不代表 Codex 已阅读或开工。',{}],
 ['read_tasks','tasks','读取本成员验证任务包并记录已读；fixture 不是正式任务，不授权改代码。',{}],
 ['get_receipt','receipt','查询某个提交的权威回执。',{submission_id:string}]
];
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
function output(id,result,error){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...(error?{error}:{result})})+'\n');}
for await(const line of lines){let msg;try{msg=JSON.parse(line);}catch{output(null,null,{code:-32700,message:'Parse error'});continue;}if(msg.id===undefined)continue;
  if(msg.method==='initialize')output(msg.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'agentgit',version:'0.1.0'}});
  else if(msg.method==='ping')output(msg.id,{});
  else if(msg.method==='resources/list')output(msg.id,{resources:[]});
  else if(msg.method==='resources/templates/list')output(msg.id,{resourceTemplates:[]});
  else if(msg.method==='tools/list')output(msg.id,{tools:defs.map(([name,,description,properties])=>({name:'agentgit_'+name,description,inputSchema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false},annotations:{readOnlyHint:name==='get_receipt',destructiveHint:false,openWorldHint:true}}))});
  else if(msg.method==='tools/call'){try{const def=defs.find(d=>'agentgit_'+d[0]===msg.params?.name);if(!def)throw new Error('未知工具');const token=readFileSync(join(defaultData(),'ipc-key'),'utf8');const data=await request(`http://127.0.0.1:${process.env.AGENTGIT_RELAY_PORT||4400}`,'/'+def[1],token,msg.params.arguments||{});output(msg.id,{content:[{type:'text',text:JSON.stringify(data)}]});}catch(e){output(msg.id,{isError:true,content:[{type:'text',text:e.code==='ENOENT'?'请先启动本机 AgentGit Relay':e.message}]});}}
  else output(msg.id,null,{code:-32601,message:'Method not found'});
}
