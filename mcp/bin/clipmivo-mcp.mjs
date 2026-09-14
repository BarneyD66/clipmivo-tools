#!/usr/bin/env node
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createServer} from '../lib/server.mjs';
import {stopChildren} from '../lib/cli-bridge.mjs';

if(process.argv[2]==='--version')process.stdout.write(JSON.stringify({name:'clipmivo-mcp',version:'0.1.7'})+'\n');
else if(process.argv[2]==='--help')console.error('clipmivo-mcp: MCP stdio server. Configure CLIPMIVO_API_KEY; optional CLIPMIVO_API_URL and CLIPMIVO_FILES_DIR. Start without arguments in an MCP client.');
else if(process.argv.length>2){console.error('Unknown argument');process.exitCode=2;}
else{
  const handle=serveStdio(createServer,{onerror:()=>console.error('Clipmivo MCP protocol error')});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopChildren();void handle.close();});
  process.stdin.on('end',stopChildren);
}
