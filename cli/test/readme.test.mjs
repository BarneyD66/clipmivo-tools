import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
await test('documented confirmation binds quotes and preserves existing accepted requests',()=>{
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const code=readme.split("node --input-type=module <<'NODE'\n")[1]?.split('\nNODE')[0];
 assert.ok(code);
 for(const scenario of ['accepted','over','failed','malformed','existing']){
  const dir=mkdtempSync(join(tmpdir(),'clipmivo-readme-'));
  try{
   writeFileSync(join(dir,'request.json'),JSON.stringify({prompt:'A quiet lake'}));
   writeFileSync(join(dir,'quote.json'),JSON.stringify({success:scenario!=='failed',data:{credits_to_hold:scenario==='over'?8:scenario==='malformed'?'7':7}}));
   const output=join(dir,'quoted-request.json');if(scenario==='existing')writeFileSync(output,'preserve');
   const result=spawnSync(process.execPath,['--input-type=module'],{cwd:dir,input:code,encoding:'utf8',env:{...process.env,CLIPMIVO_MAX_CREDITS:'7'}});
   if(scenario==='accepted'){assert.equal(result.status,0);assert.equal(JSON.parse(readFileSync(output,'utf8')).quoted_credits,7);}
   else {assert.notEqual(result.status,0);if(scenario==='existing')assert.equal(readFileSync(output,'utf8'),'preserve');else assert.equal(existsSync(output),false);}
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
