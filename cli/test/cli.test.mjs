import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = process.env.CLIPMIVO_TEST_EXECUTABLE
  ? resolve(process.env.CLIPMIVO_TEST_EXECUTABLE)
  : fileURLToPath(new URL('../bin/clipmivo.mjs', import.meta.url));
await test('asset pagination forwards encoded cursors and rejects invalid controls before HTTP',async()=>{
 const seen=[];
 const server=createServer((req,res)=>{seen.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:{assets:[],next_cursor:null}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={CLIPMIVO_API_URL:`http://127.0.0.1:${server.address().port}`,CLIPMIVO_API_KEY:'ff_fixture'};
 try{
  const cursor='100:asset_'+'a'.repeat(32);
  assert.equal((await run(['assets','--limit','2','--cursor',cursor],env)).code,0);
  assert.deepEqual(seen,[`/api/open/v1/assets?limit=2&cursor=${encodeURIComponent(cursor)}`]);
  for(const args of [['--limit','201'],['--limit','0'],['--cursor','bad'],['--cursor','100:asset_'+ 'a'.repeat(32)+'&owner=bob']])assert.equal((await run(['assets',...args],env)).code,2);
  assert.equal(seen.length,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
void test('usage forwards a read-only bounded period and rejects malformed inputs before HTTP',async()=>{
 const seen=[];
 const server=createServer((req,res)=>{seen.push([req.method,req.url]);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:{account_tasks:{count:4,credits_settled:36}}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={CLIPMIVO_API_URL:`http://127.0.0.1:${server.address().port}`,CLIPMIVO_API_KEY:'ff_usage_fixture'};
 try{
  const result=await run(['usage','--from','10','--to','20'],env);
  assert.equal(result.code,0);assert.equal(JSON.parse(result.stdout).data.account_tasks.credits_settled,36);
  assert.deepEqual(seen,[['GET','/api/open/v1/usage?from=10&to=20']]);
  for(const args of [['--from','1.5'],['--from','20','--to','10'],['--from','0','--to','4000000'],['--from','10&owner=other']])assert.equal((await run(['usage',...args],env)).code,2);
  assert.equal(seen.length,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
void test('asset commands preserve scope paths, original bytes and exclusive downloads', async()=>{
  const asset='asset_'+'d'.repeat(32),seen=[],bytes=Buffer.from([137,80,78,71,13,10,26,10]);
  let mime='image/png';
  const server=createServer((req,res)=>{
    seen.push([req.method,req.url]);
    assert.equal(req.headers.authorization,'Bearer ff_asset_fixture');
    if(req.url.endsWith('/file')){res.setHeader('Content-Type',mime);res.setHeader('Content-Length',bytes.length);res.end(bytes);}
    else {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:req.method==='DELETE'?{deleted:true}:req.url.endsWith('/assets')?{assets:[{id:asset}]}:{id:asset}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const dir=await mkdtemp(resolve(tmpdir(),'clipmivo-assets-'));
  const env={CLIPMIVO_API_URL:`http://127.0.0.1:${server.address().port}`,CLIPMIVO_API_KEY:'ff_asset_fixture',CLIPMIVO_CONFIG_DIR:dir};
  try {
    assert.equal((await run(['assets'],env)).code,0);
    assert.equal(JSON.parse((await run(['asset-get',asset],env)).stdout).data.id,asset);
    const output=resolve(dir,'original.png');
    assert.equal((await run(['asset-download',asset,'--output',output],env)).code,0);
    assert.deepEqual(await readFile(output),bytes);
    const before=seen.length;
    assert.equal((await run(['asset-download',asset,'--output',output],env)).code,2);
    assert.equal((await run(['asset-delete','../keys'],env)).code,2);
    assert.equal(seen.length,before);
    mime='text/html';
    assert.equal((await run(['asset-download',asset,'--output',resolve(dir,'bad.png')],env)).code,1);
    assert.ok(!(await readdir(dir)).some(name=>name.startsWith('bad.png')));
    assert.equal((await run(['asset-delete',asset],env)).code,0);
    assert.deepEqual(seen.slice(0,3),[['GET','/api/open/v1/assets'],['GET',`/api/open/v1/assets/${asset}`],['GET',`/api/open/v1/assets/${asset}/file`]]);
    assert.deepEqual(seen.at(-1),['DELETE',`/api/open/v1/assets/${asset}`]);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
void test('lost upload response retains a queryable id without replaying bytes or exposing credentials', async () => {
  const uploadId='asset_'+'a'.repeat(32),seen=[];
  const server=createServer(async(req,res)=>{
    for await(const part of req) void part;
    seen.push([req.method,req.url]);
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST')res.end(JSON.stringify({success:true,data:{path:`uploads/${uploadId}`,token:'DO_NOT_DISCLOSE_UPLOAD_TOKEN'}}));
    else if(req.method==='PUT')req.socket.destroy();
    else res.end(JSON.stringify({success:true,data:{id:uploadId,status:'complete',asset:{id:uploadId}}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const dir=await mkdtemp(resolve(tmpdir(),'clipmivo-upload-recovery-'));
  const env={CLIPMIVO_API_URL:`http://127.0.0.1:${server.address().port}`,CLIPMIVO_API_KEY:'ff_recovery_fixture',CLIPMIVO_CONFIG_DIR:dir};
  try {
    const file=resolve(dir,'fixture.png');await writeFile(file,Buffer.from([137,80,78,71]));
    const failed=await run(['upload','--file',file],env);
    assert.equal(failed.code,1);
    assert.equal(JSON.parse(failed.stderr).error.upload_id,uploadId);
    assert.ok(!failed.stderr.includes('DO_NOT_DISCLOSE_UPLOAD_TOKEN'));
    assert.ok(!failed.stderr.includes(env.CLIPMIVO_API_KEY));
    const recovered=await run(['upload-status',uploadId],env);
    assert.equal(recovered.code,0);assert.equal(JSON.parse(recovered.stdout).data.status,'complete');
    assert.deepEqual(seen,[['POST','/api/open/v1/uploads'],['PUT',`/api/open/v1/uploads/${uploadId}`],['GET',`/api/open/v1/uploads/${uploadId}`]]);
    for(const id of ['../keys','asset_bad','https://example.com'])assert.equal((await run(['upload-status',id],env)).code,2);
    assert.equal(seen.length,3);
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
  }
});
function run(args, env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('exit', (code) => done({ code, stdout, stderr }));
  });
}
void test('upload reports known validation errors without exposing arbitrary server details or retrying', async () => {
  let errorCode = 'invalid_media_duration';
  const seen = [];
  const uploadId = 'asset_' + 'b'.repeat(32);
  const server = createServer(async (req, res) => {
    for await (const part of req) void part;
    seen.push(req.method);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') res.end(JSON.stringify({success:true,data:{path:`uploads/${uploadId}`,token:'PRIVATE_UPLOAD_TOKEN'}}));
    else {
      res.statusCode = 422;
      res.end(JSON.stringify({success:false,error:{code:errorCode,message:'PRIVATE_SERVER_DETAIL'},token:'PRIVATE_UPLOAD_TOKEN'}));
    }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const dir = await mkdtemp(resolve(tmpdir(),'clipmivo-upload-errors-'));
  try {
    const file = resolve(dir,'fixture.mp4'); await writeFile(file,Buffer.alloc(32));
    const env = {CLIPMIVO_API_URL:`http://127.0.0.1:${server.address().port}`,CLIPMIVO_API_KEY:'ff_private_fixture',CLIPMIVO_CONFIG_DIR:dir};
    for (const [code, expected] of [['invalid_media_duration','invalid_media_duration'],['upload_size_mismatch','upload_size_mismatch'],['ff_private_server_secret','upload_failed']]) {
      errorCode = code;
      const result = await run(['upload','--file',file,'--duration','1'],env);
      assert.equal(result.code,1);
      const error = JSON.parse(result.stderr).error;
      assert.equal(error.code,expected); assert.equal(error.status,422);
      assert.equal(error.upload_id,uploadId);
      for (const secret of ['PRIVATE_UPLOAD_TOKEN','PRIVATE_SERVER_DETAIL','ff_private_fixture','ff_private_server_secret']) assert.ok(!result.stderr.includes(secret));
    }
    assert.deepEqual(seen,['POST','PUT','POST','PUT','POST','PUT']);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
void test('callback commands use scoped API routes and validate identifiers before egress', async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    seen.push({ url: req.url, method: req.method, body: raw });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        data: { id: 'cb_fixture', secret: 'fixture-only-return-on-create' },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(resolve(tmpdir(), 'clipmivo-callback-'));
  const env = {
    CLIPMIVO_API_URL: `http://127.0.0.1:${server.address().port}`,
    CLIPMIVO_API_KEY: 'ff_fixture',
    CLIPMIVO_CONFIG_DIR: dir,
  };
  try {
    for (const args of [
      ['callbacks'],
      ['callback-create', '--url', 'https://receiver.example.com/events'],
      ['callback-verify', 'cb_fixture'],
      ['callback-deliveries', 'cb_fixture'],
      ['callback-retry', 'cb_fixture', 'del_fixture'],
      ['callback-disable', 'cb_fixture'],
    ])
      assert.equal((await run(args, env)).code, 0);
    assert.deepEqual(
      seen.map((r) => [r.method, r.url]),
      [
        ['GET', '/api/open/v1/callbacks'],
        ['POST', '/api/open/v1/callbacks'],
        ['POST', '/api/open/v1/callbacks/cb_fixture/verify'],
        ['GET', '/api/open/v1/callbacks/cb_fixture/deliveries'],
        [
          'POST',
          '/api/open/v1/callbacks/cb_fixture/deliveries/del_fixture/retry',
        ],
        ['DELETE', '/api/open/v1/callbacks/cb_fixture'],
      ],
    );
    assert.deepEqual(JSON.parse(seen[1].body), {
      url: 'https://receiver.example.com/events',
    });
    for (const args of [
      ['callback-create', '--url', 'http://localhost/internal'],
      ['callback-verify', '../keys'],
      ['callback-retry', 'cb_fixture'],
      ['callback-retry', 'cb_fixture', '../keys'],
    ])
      assert.equal((await run(args, env)).code, 2);
    assert.equal(seen.length, 6);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
void test('installed entry protocol: upload, quote, idempotent submit, wait and streamed download', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'clipmivo-cli-'));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    requests.push({
      url: req.url,
      method: req.method,
      headers: req.headers,
      bytes,
    });
    res.setHeader('content-type', 'application/json');
    let data;
    if (req.url === '/api/open/v1/uploads')
      data = { path: 'uploads/up_fixture', token: 'upload-fixture' };
    else if (req.url === '/api/open/v1/uploads/up_fixture')
      data = { id: 'asset_fixture', size: bytes.length };
    else if (req.url === '/api/open/v1/videos/generations/quote')
      data = { credits_to_hold: 5 };
    else if (req.url === '/api/open/v1/videos/generations') {
      res.statusCode = 202;
      data = { id: 'job_fixture', status: 'queued' };
    } else if (req.url === '/api/open/v1/videos/generations/job_fixture')
      data = { id: 'job_fixture', status: 'completed' };
    else if (req.url.endsWith('/download')) {
      res.setHeader('content-type', 'video/mp4');
      res.end(Buffer.from([0, 1, 2, 3, 4, 5]));
      return;
    } else data = { models: [] };
    res.end(JSON.stringify({ success: true, data }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const env = {
    CLIPMIVO_API_URL: `http://127.0.0.1:${server.address().port}`,
    CLIPMIVO_API_KEY: 'ff_fixture_private',
    CLIPMIVO_CONFIG_DIR: dir,
  };
  try {
    const file = resolve(dir, 'sample.png');
    await writeFile(file, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
    let result = await run(['upload', '--file', file], env);
    assert.equal(result.code, 0, result.stderr);
    const put = requests.find((r) => r.method === 'PUT');
    assert.deepEqual(put.bytes, await readFile(file));
    assert.equal(put.headers['x-upload-token'], 'upload-fixture');
    const request = resolve(dir, 'request.json');
    await writeFile(
      request,
      JSON.stringify({ model: 'fixture-text-to-video', prompt: 'fixture' }),
    );
    result = await run(['quote', '--file', request], env);
    assert.equal(result.code, 0, result.stderr);
    result = await run(['generate', '--file', request], env);
    assert.equal(result.code, 2);
    assert.equal(
      requests.filter((r) => r.url === '/api/open/v1/videos/generations')
        .length,
      0,
    );
    result = await run(
      [
        'generate',
        '--file',
        request,
        '--idempotency-key',
        'same-key-123',
        '--wait',
      ],
      env,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.status, 'completed');
    const submits = requests.filter(
      (r) => r.url === '/api/open/v1/videos/generations',
    );
    assert.equal(submits.length, 1);
    assert.equal(submits[0].headers['idempotency-key'], 'same-key-123');
    result = await run(
      [
        'generate',
        '--file',
        request,
        '--idempotency-key',
        'same-key-123',
        '--wait',
        '--timeout',
        '0',
      ],
      env,
    );
    assert.equal(result.code, 2);
    assert.equal(
      requests.filter((r) => r.url === '/api/open/v1/videos/generations')
        .length,
      1,
    );
    const output = resolve(dir, 'result.mp4');
    result = await run(['download', 'job_fixture', '--output', output], env);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await readFile(output), Buffer.from([0, 1, 2, 3, 4, 5]));
    result = await run(['download', 'job_fixture', '--output', output], env);
    assert.equal(result.code, 2);
    assert.equal(requests.filter((r) => r.url.endsWith('/download')).length, 1);
    assert.ok(
      requests.every(
        (r) => r.headers.authorization === 'Bearer ff_fixture_private',
      ),
    );
    result = await run(['config', 'show'], env);
    assert.equal(result.code, 0);
    assert.ok(!result.stdout.includes(env.CLIPMIVO_API_KEY));
  } finally {
    await new Promise((done) => server.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});
void test('redirects do not forward keys; failed submits never retry; wait distinguishes failure and timeout', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'clipmivo-cli-'));
  let calls = 0,
    mode = 'redirect';
  const server = createServer((req, res) => {
    calls++;
    if (mode === 'redirect') {
      res.writeHead(302, { location: '/credential-leak' });
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (mode === 'failure') {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          success: false,
          error: { code: 'provider_unavailable', message: 'sensitive detail' },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        success: true,
        data: {
          id: 'job_fixture',
          status: mode === 'review' ? 'needs_review' : 'processing',
        },
      }),
    );
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const env = {
    CLIPMIVO_API_URL: `http://127.0.0.1:${server.address().port}`,
    CLIPMIVO_API_KEY: 'ff_fixture_secret',
    CLIPMIVO_CONFIG_DIR: dir,
  };
  try {
    let result = await run(['models'], env);
    assert.equal(result.code, 1);
    assert.equal(calls, 1);
    assert.match(result.stderr, /redirect_rejected/);
    mode = 'failure';
    const request = resolve(dir, 'request.json');
    await writeFile(request, '{"prompt":"test"}');
    result = await run(
      ['generate', '--file', request, '--idempotency-key', 'fixed-key-123'],
      env,
    );
    assert.equal(result.code, 1);
    assert.equal(calls, 2);
    assert.ok(!result.stderr.includes('sensitive detail'));
    const output = resolve(dir, 'failed.mp4');
    result = await run(['download', 'job_fixture', '--output', output], env);
    assert.equal(result.code, 1);
    assert.ok(!(await readdir(dir)).some((n) => n.startsWith('failed.mp4')));
    mode = 'review';
    result = await run(['wait', 'job_fixture'], env);
    assert.equal(result.code, 4);
    mode = 'pending';
    result = await run(['wait', 'job_fixture', '--timeout', '1'], env);
    assert.equal(result.code, 3);
    const previous = calls;
    result = await run(['models', '--api-url', 'http://external.example'], env);
    assert.equal(result.code, 2);
    assert.equal(calls, previous);
  } finally {
    await new Promise((done) => server.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});
