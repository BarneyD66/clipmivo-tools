import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
await test('bundled CLI matches the maintained client source',()=>{
 assert.equal(readFileSync(new URL('../vendor/clipmivo.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n'),readFileSync(new URL('../../cli/bin/clipmivo.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n'));
});
