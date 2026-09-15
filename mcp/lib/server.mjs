import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {runCli,withRequest,localFile} from './cli-bridge.mjs';

const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const endpoint=z.string().regex(/^cb_[A-Za-z0-9_-]{8,100}$/);
const assetId=z.string().regex(/^asset_[a-f0-9]{32}$/);
const request=z.record(z.string(),z.unknown());
export function createServer() {
  const server=new McpServer({name:'clipmivo',version:'0.1.8'});
  const tool=(name,description,schema,readOnly,handler)=>server.registerTool(name,{
    description,inputSchema:z.object(schema).strict(),annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:true},
  },async(input,ctx)=>{
    try{const result=await handler(input,ctx?.mcpReq?.signal);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
    catch(error){const code=/^[a-z_]{1,100}$/.test(error.message)?error.message:'operation_failed';return {isError:true,content:[{type:'text',text:JSON.stringify({error:code,...(/^asset_[a-f0-9]{32}$/.test(error.uploadId||'')?{upload_id:error.uploadId,recovery_tool:'get_upload'}:{})})}]};}
  });
  tool('list_models','List model/workflow capabilities. A live quote determines current availability.',{},true,(_,s)=>runCli(['models'],s));
  tool('list_assets','List owned assets. Pass next_cursor to retrieve another page. Requires video:read.',{limit:z.number().int().min(1).max(200).optional(),cursor:z.string().regex(/^\d+:asset_[a-f0-9]{32}$/).optional()},true,(v,s)=>runCli(['assets',...(v.limit===undefined?[]:['--limit',String(v.limit)]),...(v.cursor===undefined?[]:['--cursor',v.cursor])],s));
  tool('get_asset','Read owned asset metadata. Requires video:read.',{asset_id:assetId},true,(v,s)=>runCli(['asset-get',v.asset_id],s));
  tool('download_asset','Download original owned media to a new file inside CLIPMIVO_FILES_DIR. Refuses overwrite; use a matching media extension.',{asset_id:assetId,filename:z.string().max(124)},false,async(v,s)=>runCli(['asset-download',v.asset_id,'--output',await localFile(v.filename,{output:true,media:true})],s));
  tool('delete_asset','Delete an owned reference asset and queue permanent file cleanup. Only call when the user requests deletion. Active task references can block deletion. Requires files:write.',{asset_id:assetId},false,(v,s)=>runCli(['asset-delete',v.asset_id],s));
  tool('credit_balance','Read available, reserved and expiring credits.',{},true,(_,s)=>runCli(['balance'],s));
  tool('get_usage','Read account-wide retained non-draft task usage by creation time and current-key lifetime calls. Not per-key billing; excludes deleted tasks and unsettled charges. Requires video:read. Unix seconds: from inclusive, to exclusive; defaults to 30 days, maximum 31 days.',{from:z.number().int().min(0).max(9999999999).optional(),to:z.number().int().min(0).max(9999999999).optional()},true,(v,s)=>runCli(['usage',...Object.entries(v).flatMap(([key,value])=>['--'+key,String(value)])],s));
  tool('get_upload','Read owned upload status after an uncertain upload response. Requires video:read. A completed asset can be reused; do not upload again while status is uploading. Missing historical status does not prove the asset was deleted.',{upload_id:z.string().regex(/^asset_[a-f0-9]{32}$/)},true,(v,s)=>runCli(['upload-status',v.upload_id],s));
  tool('quote_video','Get a live credit quote without creating or charging for a generation. Requires video:write scope.',{request},true,(v,s)=>withRequest(v.request,file=>runCli(['quote','--file',file],s)));
  tool('create_video','Create a PAID video only after the user accepts the quoted credit amount. First call quote_video. Reuse identical input and the same idempotency_key after a lost response; never automatically retry with a new key.',{
    request,accepted_credits:z.number().int().positive().max(1000000),idempotency_key:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  },false,(v,s)=>{
    if(v.request.quoted_credits!==undefined&&v.request.quoted_credits!==v.accepted_credits)throw Error('accepted_quote_mismatch');
    return withRequest({...v.request,quoted_credits:v.accepted_credits},file=>runCli(['generate','--file',file,'--idempotency-key',v.idempotency_key],s));
  });
  tool('get_video','Read a task and its authenticated download information; never resubmits it.',{task_id:id},true,(v,s)=>runCli(['get',v.task_id],s));
  tool('list_videos','List owned tasks using optional filters and pagination.',{limit:z.number().int().min(1).max(100).optional(),cursor:z.string().max(300).optional(),status:z.enum(['queued','processing','succeeded','failed','needs_review','draft']).optional()},true,(v,s)=>runCli(['jobs',...Object.entries(v).flatMap(([key,value])=>['--'+key,String(value)])],s));
  tool('wait_video','Wait up to 55 seconds for an existing task. Timeout does not mean failure; call get_video or wait_video again, never recreate it.',{task_id:id,timeout_seconds:z.number().int().min(1).max(55).default(55)},true,(v,s)=>runCli(['wait',v.task_id,'--timeout',String(v.timeout_seconds)],s));
  tool('upload_asset','Upload a user-selected file from CLIPMIVO_FILES_DIR; files outside that directory are rejected. Video/audio requires declared duration_seconds.',{path:z.string().min(1).max(1000),duration_seconds:z.number().positive().max(3600).optional()},false,async(v,s)=>runCli(['upload','--file',await localFile(v.path),...(v.duration_seconds===undefined?[]:['--duration',String(v.duration_seconds)])],s,160000));
  tool('download_video','Download an owned completed video to a new .mp4 filename inside CLIPMIVO_FILES_DIR. Refuses overwriting an existing file.',{task_id:id,filename:z.string().max(124)},false,async(v,s)=>runCli(['download',v.task_id,'--output',await localFile(v.filename,{output:true})],s));
  tool('list_callbacks','Read verified callback endpoints and dispatch readiness.',{},true,(_,s)=>runCli(['callbacks'],s));
  tool('create_callback','Register an approved HTTPS callback endpoint. Returns a one-time signing secret: store it only in the receiver secret manager. This does not verify it.',{url:z.url().max(2048)},false,(v,s)=>runCli(['callback-create','--url',v.url],s));
  tool('verify_callback','Send a signed ownership challenge to a registered endpoint.',{endpoint_id:endpoint},false,(v,s)=>runCli(['callback-verify',v.endpoint_id],s));
  tool('disable_callback','Disable an endpoint and cancel queued notifications. An in-flight notification can still arrive.',{endpoint_id:endpoint},false,(v,s)=>runCli(['callback-disable',v.endpoint_id],s));
  tool('callback_deliveries','Read recent delivery history for an owned endpoint.',{endpoint_id:endpoint},true,(v,s)=>runCli(['callback-deliveries',v.endpoint_id],s));
  tool('retry_callback','Retry an eligible failed notification with its original event ID. Does not generate another video.',{endpoint_id:endpoint,delivery_id:id},false,(v,s)=>runCli(['callback-retry',v.endpoint_id,v.delivery_id],s));
  return server;
}
