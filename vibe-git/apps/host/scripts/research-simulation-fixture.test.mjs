import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulationSession} from './research-simulation-fixture.mjs';

test('preview restarts retain remote thread and journal; separate projects never reuse IDs',async()=>{
 const sessions=new Map(),first=simulationSession(sessions,'journal-1','project-1','test',()=>Buffer.from('{}'));
 const file={filename:'context.json',bytes:Buffer.from('{"revision":2}')};
 const initial=await first.remote.start('simulated-research-expert','SciencePAL TASK job',file);
 first.journal.phase='RUNNING';first.journal.remote=initial;
 const restarted=simulationSession(sessions,'journal-1','project-1','test');
 assert.equal(restarted,first);assert.equal(await restarted.remote.run(initial.runId),'completed');assert.deepEqual(restarted.journal.remote,initial);
 const next=await restarted.remote.start('simulated-research-expert','SciencePAL TASK job',file);assert.notEqual(next.runId,initial.runId);
 const other=simulationSession(sessions,'journal-2','project-2','test',()=>Buffer.from('{}'));
 const otherRun=await other.remote.start('simulated-research-expert','SciencePAL TASK job',file);assert.notEqual(otherRun.runId,initial.runId);
 assert.throws(()=>simulationSession(sessions,'journal-1','foreign','test'),/其他项目/);
});
