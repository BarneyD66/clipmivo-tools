import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

await test('MCP stdio negotiates tools, forwards scoped requests and binds paid quotes without retry',async()=>{
 const calls=[];
 let loseUploadResponse=false;
 const uploadDelay=process.env.CLIPMIVO_MCP_SLOW_UPLOAD_TEST==='1'?66000:0;
 const directory=await mkdtemp(join(tmpdir(),'clipmivo-mcp-upload-test-'));
 await writeFile(join(directory,'asset.png'),Buffer.from([137,80,78,71]));
 const api=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?(req.method==='PUT'?Buffer.concat(chunks):JSON.parse(Buffer.concat(chunks))):null;
  calls.push({url:req.url,method:req.method,body,idem:req.headers['idempotency-key']});
  assert.equal(req.headers.authorization,'Bearer ff_fixture_mcp');res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/file')){res.setHeader('Content-Type','image/png');res.end(Buffer.from([137,80,78,71]));return;}
  if(req.url.endsWith('/uploads')&&req.method==='POST')res.end(JSON.stringify({success:true,data:{path:'uploads/asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',token:'fixture_upload_token'}}));
  else if(req.url.endsWith('/uploads/asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')&&req.method==='PUT'){
   if(loseUploadResponse){req.socket.destroy();return;}
   assert.equal(req.headers['x-upload-token'],'fixture_upload_token');
   assert.deepEqual(body,Buffer.from([137,80,78,71]));
   setTimeout(()=>res.end(JSON.stringify({success:true,data:{id:'asset_fixture'}})),uploadDelay);
  }
  else if(req.url.endsWith('/quote'))res.end(JSON.stringify({success:true,data:{credits_to_hold:7}}));
  else if(req.url.endsWith('/vid_wait'))res.end(JSON.stringify({success:true,data:{id:'vid_wait',status:'processing'}}));
  else if(req.url.endsWith('/videos/generations')&&req.method==='POST'){
   if(body.quoted_credits!==7){res.statusCode=409;res.end(JSON.stringify({success:false,error:{code:'quote_changed'}}));}
   else res.end(JSON.stringify({success:true,data:{id:'vid_fixture',status:'queued'}}));
  }else res.end(JSON.stringify({success:true,data:{models:[],available_credits:7}}));
 });api.listen(0,'127.0.0.1');await once(api,'listening');
 const path=process.env.CLIPMIVO_MCP_TEST_EXECUTABLE||fileURLToPath(new URL('../bin/clipmivo-mcp.mjs',import.meta.url));
 const child=spawn(process.execPath,[path],{env:{...process.env,CLIPMIVO_FILES_DIR:directory,CLIPMIVO_API_KEY:'ff_fixture_mcp',CLIPMIVO_API_URL:`http://127.0.0.1:${api.address().port}`},stdio:['pipe','pipe','pipe'],windowsHide:true});
 let buffer='',next=0,stderr='';const pending=new Map();
 child.stderr.on('data',c=>{stderr+=c;});child.stdout.on('data',chunk=>{
  buffer+=chunk;while(buffer.includes('\n')){const index=buffer.indexOf('\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;const message=JSON.parse(line);const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);waiter.done(message);}}
 });
 const send=(method,params)=>new Promise((done,reject)=>{const id=++next;const timer=setTimeout(()=>reject(Error('MCP timeout: '+method)),uploadDelay+10000);pending.set(id,{done,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 try{
  const init=await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'acceptance',version:'1'}});assert.equal(init.result.serverInfo.name,'clipmivo');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listed=await send('tools/list',{});assert.equal(listed.result.tools.length,21);
  const call=(name,args={})=>send('tools/call',{name,arguments:args});
  assert.equal((await call('list_models')).result.structuredContent.success,true);
  assert.equal((await call('get_usage',{from:10,to:20})).result.structuredContent.success,true);
  assert.equal(calls.at(-1).method,'GET');
  assert.equal(calls.at(-1).url,'/api/open/v1/usage?from=10&to=20');
  const beforeBadPeriod=calls.length;
  assert.equal((await call('get_usage',{from:20,to:10})).result.isError,true);
  assert.equal(calls.length,beforeBadPeriod);
  const uploadId='asset_'+'a'.repeat(32);
  assert.equal((await call('list_assets')).result.structuredContent.success,true);
  assert.equal(calls.at(-1).url,'/api/open/v1/assets');
  assert.equal((await call('list_assets',{limit:2,cursor:`100:${uploadId}`})).result.structuredContent.success,true);
  assert.equal(calls.at(-1).url,`/api/open/v1/assets?limit=2&cursor=100%3A${uploadId}`);
  const beforeBadAssets=calls.length;
  assert.equal((await call('list_assets',{limit:201})).result.isError,true);
  assert.equal(calls.length,beforeBadAssets);
  assert.equal((await call('get_asset',{asset_id:uploadId})).result.structuredContent.success,true);
  assert.equal(calls.at(-1).url,`/api/open/v1/assets/${uploadId}`);
  assert.equal((await call('delete_asset',{asset_id:uploadId})).result.structuredContent.success,true);
  assert.equal(calls.at(-1).method,'DELETE');
  assert.equal((await call('download_asset',{asset_id:uploadId,filename:'downloaded.png'})).result.isError,undefined);
  assert.deepEqual(await readFile(join(directory,'downloaded.png')),Buffer.from([137,80,78,71]));
  assert.equal((await call('download_asset',{asset_id:uploadId,filename:'downloaded.png'})).result.isError,true);
  assert.equal((await call('get_upload',{upload_id:uploadId})).result.structuredContent.success,true);
  assert.equal(calls.at(-1).url,`/api/open/v1/uploads/${uploadId}`);
  const beforeInvalidUpload=calls.length;
  assert.equal((await call('get_upload',{upload_id:'../keys'})).result.isError,true);
  assert.equal(calls.length,beforeInvalidUpload);
  const request={model:'seedance-2.0-mini-text-to-video',prompt:'A calm pond',duration:4,quality:'480p',aspect_ratio:'16:9',generate_audio:false};
  assert.equal((await call('quote_video',{request})).result.structuredContent.data.credits_to_hold,7);
  assert.equal((await call('create_video',{request,accepted_credits:7,idempotency_key:'fixture_stable_key'})).result.structuredContent.data.id,'vid_fixture');
  const created=calls.find(x=>x.idem);assert.equal(created.body.quoted_credits,7);assert.equal(created.idem,'fixture_stable_key');
  const before=calls.length;
  assert.equal((await call('create_video',{request:{...request,quoted_credits:8},accepted_credits:7,idempotency_key:'fixture_stable_key'})).result.isError,true);assert.equal(calls.length,before);
  assert.equal((await call('create_video',{request,accepted_credits:6,idempotency_key:'fixture_other_key'})).result.isError,true);assert.equal(calls.length,before+1);
  assert.equal((await call('upload_asset',{path:'outside.png'})).result.isError,true);
  assert.equal((await call('upload_asset',{path:'asset.png'})).result.structuredContent.data.id,'asset_fixture');
  assert.equal(calls.filter(c=>c.url.endsWith('/uploads')).length,1);
  assert.equal(calls.filter(c=>c.method==='PUT'&&c.url.endsWith('/uploads/asset_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).length,1,'upload must not retry');
  loseUploadResponse=true;
  const beforeLost=calls.length;
  const lost=(await call('upload_asset',{path:'asset.png'})).result;
  assert.equal(lost.isError,true);
  const recovery=JSON.parse(lost.content[0].text);
  assert.equal(recovery.upload_id,uploadId);
  assert.equal(recovery.recovery_tool,'get_upload');
  assert.ok(!lost.content[0].text.includes('fixture_upload_token'));
  assert.equal(calls.length,beforeLost+2,'one reservation and one transfer only');
  loseUploadResponse=false;
  const waiting=call('wait_video',{task_id:'vid_wait',timeout_seconds:55}),waitingId=next;
  for(let attempt=0;attempt<100&&!calls.some(c=>c.url.endsWith('/vid_wait'));attempt++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(calls.some(c=>c.url.endsWith('/vid_wait')),'wait must reach the API before cancellation');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:waitingId,reason:'test cancellation'}})+'\n');
  // Cancelled requests need not return a response. Observe the real CLI polling instead.
  const waiter=pending.get(waitingId);clearTimeout(waiter.timer);pending.delete(waitingId);waiter.done(null);await waiting;
  const polls=calls.filter(c=>c.url.endsWith('/vid_wait')).length;
  await new Promise(resolve=>setTimeout(resolve,2500));
  assert.equal(calls.filter(c=>c.url.endsWith('/vid_wait')).length,polls,'cancel must stop CLI polling');
  assert.equal((await call('list_models')).result.structuredContent.success,true);
  assert.ok(!stderr.includes('ff_fixture_mcp'));
 }finally{for(const waiter of pending.values())clearTimeout(waiter.timer);child.kill();api.closeAllConnections();await new Promise(resolve=>api.close(resolve));await rm(directory,{recursive:true,force:true});}
});
