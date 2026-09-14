import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,relative,isAbsolute,join} from 'node:path';

const cli=fileURLToPath(new URL('../vendor/clipmivo.mjs',import.meta.url));
const children=new Set();
export function stopChildren(){for(const child of children)child.kill();}
export function runCli(args,signal,timeout=65000) {
  return new Promise((done,reject)=>{
    if(signal?.aborted)return reject(Error('operation_cancelled'));
    if(children.size>=4)return reject(Error('too_many_concurrent_operations'));
    const child=spawn(process.execPath,[cli,...args,'--json'],{
      shell:false,windowsHide:true,env:{...process.env,CLIPMIVO_API_URL:process.env.CLIPMIVO_API_URL||'https://clipmivoai.com'},stdio:['ignore','pipe','pipe'],
    });
    children.add(child);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    let stdout='',stderr='',bytes=0,stopped='';
    const stop=code=>{stopped=code;child.kill();};
    const abort=()=>stop('operation_cancelled');signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>stop('operation_timeout'),timeout);
    for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',chunk=>{
      bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024){stop('response_too_large');return;}
      if(name==='stdout')stdout+=chunk;else stderr+=chunk;
    });
    child.on('error',()=>{children.delete(child);clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Error('cli_unavailable'));});
    child.on('close',code=>{
      children.delete(child);
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(stopped)return reject(Error(stopped));
      try{
        if(code!==0){const error=JSON.parse(stderr.trim());const value=typeof error.error==='string'?error.error:error.error?.code;const failure=Error(/^[a-z_]{1,100}$/.test(value||'')?value:'cli_request_failed');if(/^asset_[a-f0-9]{32}$/.test(error.error?.upload_id||''))failure.uploadId=error.error.upload_id;return reject(failure);}
        done(JSON.parse(stdout));
      }catch{reject(Error('invalid_cli_response'));}
    });
  });
}

export async function withRequest(request,callback) {
  const body=JSON.stringify(request);if(Buffer.byteLength(body)>48000)throw Error('request_too_large');
  const directory=await mkdtemp(join(tmpdir(),'clipmivo-mcp-'));
  try{const file=join(directory,'request.json');await writeFile(file,body,{flag:'wx',mode:0o600});return await callback(file);}
  finally{await rm(directory,{recursive:true,force:true});}
}

export async function localFile(path,{output=false,media=false}={}) {
  const configured=process.env.CLIPMIVO_FILES_DIR;
  if(!configured)throw Error('files_directory_not_configured');
  const root=await realpath(configured);
  if(output){
    const pattern=media ? /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(png|jpg|jpeg|webp|bmp|mp4|webm|mp3|wav|m4a)$/i : /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.mp4$/;
    if(!pattern.test(path))throw Error('invalid_output_filename');
    return join(root,path); // CLI uses exclusive creation and never overwrites.
  }
  const candidate=await realpath(resolve(root,path));
  const inside=relative(root,candidate);
  if(!inside||inside==='..'||inside.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(inside))throw Error('file_outside_configured_directory');
  return candidate;
}
