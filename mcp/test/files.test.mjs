import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localFile} from '../lib/cli-bridge.mjs';
await test('file tools require a configured root and reject traversal, symlink escapes and output paths',async()=>{
 const before=process.env.CLIPMIVO_FILES_DIR;const base=await mkdtemp(join(tmpdir(),'clipmivo-mcp-files-'));
 try{
  const root=join(base,'allowed'),outside=join(base,'outside');await mkdir(root);await mkdir(outside);
  await writeFile(join(root,'image.png'),'fixture');await writeFile(join(outside,'private.png'),'private');
  delete process.env.CLIPMIVO_FILES_DIR;await assert.rejects(()=>localFile('image.png'),/files_directory_not_configured/);
  process.env.CLIPMIVO_FILES_DIR=root;assert.equal(await localFile('image.png'),join(root,'image.png'));
  await assert.rejects(()=>localFile('../outside/private.png'),/file_outside_configured_directory/);
  await symlink(outside,join(root,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>localFile('link/private.png'),/file_outside_configured_directory/);
  for(const filename of ['../result.mp4','C:/result.mp4','--output.mp4','result.txt'])await assert.rejects(()=>localFile(filename,{output:true}),/invalid_output_filename/);
  assert.equal(await localFile('result.mp4',{output:true}),join(root,'result.mp4'));
  assert.equal(await localFile('reference.png',{output:true,media:true}),join(root,'reference.png'));
  for(const filename of ['../private.png','file.exe','page.html','file.svg'])await assert.rejects(()=>localFile(filename,{output:true,media:true}),/invalid_output_filename/);
 }finally{if(before===undefined)delete process.env.CLIPMIVO_FILES_DIR;else process.env.CLIPMIVO_FILES_DIR=before;await rm(base,{recursive:true,force:true});}
});
