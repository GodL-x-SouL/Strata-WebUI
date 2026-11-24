import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeSettings,validateMcpServers,publicMcpServers,publicNativeEnv,restoreNativeEnv,SPEED_SWITCHES,studioNativeEnv,validateStudioNativeSettings,restoreStudioNativeEnv} from '../server/native-settings.mjs';
import {validateChatImages} from '../server/chat-images.mjs';
test('native settings reject invalid ranges and unmanaged network arguments',()=>{
 assert.deepEqual(validateNativeSettings({parallel:2,layer_split:'16,32',reasoning_budget_tokens:null,sampling:{temperature:.7}}),{parallel:2,layer_split:'16,32',reasoning_budget_tokens:null,sampling:{temperature:.7}});
 for(const value of [{parallel:0},{parallel:1.2},{layer_split:'32,16'},{layer_split:'48'},{exe:'/tmp/program'},{args:['--host','0.0.0.0']},{env:{HOME:'/tmp'}},{sampling:{top_p:2}},{anthropic_thinking:'always'}])assert.throws(()=>validateNativeSettings(value));
});
test('MCP secrets round trip masked values and reject malformed transport settings',()=>{
 const previous={files:{command:'node',args:['server.mjs'],env:{API_KEY:'private-key'},disabled:false},remote:{url:'https://example.test/mcp',headers:{Authorization:'Bearer private'}}};
 const masked=publicMcpServers(previous);assert.equal(masked.files.env.API_KEY,'••••••••');assert.equal(JSON.stringify(masked).includes('private'),false);assert.deepEqual(validateMcpServers(masked,previous),previous);
 for(const value of [{x:{command:'node',url:'https://example.test'}},{x:{url:'file:///tmp'}},{x:{command:'node',cwd:123}},{x:{url:'https://example.test',headers:{Authorization:'secret\r\nX: bad'}}},{x:{command:'node',env:{KEY:'••••••••'}}}])assert.throws(()=>validateMcpServers(value));
});
test('environment masks preserve credentials and unrelated existing configuration',()=>{
 const previous={PATH:'/native/bin',STRATA_API_KEY:'private',STRATA_PREFILL:'2'};
 assert.deepEqual(publicNativeEnv(previous),{STRATA_API_KEY:'••••••••',STRATA_PREFILL:'2'});
 assert.deepEqual(restoreNativeEnv({STRATA_API_KEY:'••••••••',STRATA_PREFILL:'3'},previous),{...previous,STRATA_PREFILL:'3'});
 assert.throws(()=>restoreNativeEnv({STRATA_TOKEN:'••••••••'}));
});
test('Studio edits only known speed switches and preserves local-only environment values',()=>{
 const previous={PATH:'/native/bin',STRATA_TOKEN:'private',STRATA_KVA:'1',STRATA_ROUTE_TAIL_SKIP:'12',STRATA_PCIE_FRAC_DEFAULT:'old'};
 assert.deepEqual(studioNativeEnv(previous),{STRATA_KVA:'1',STRATA_PCIE_FRAC_DEFAULT:'old'});
 assert.deepEqual(validateStudioNativeSettings({parallel:2,env:{STRATA_ROUTE_TAIL_SKIP:'5'}}),{parallel:2,env:{STRATA_ROUTE_TAIL_SKIP:'5'}});
 const tail=SPEED_SWITCHES.find(s=>s.id==='route_tail_skip');
 for(const [value] of tail.choices)if(value)assert.doesNotThrow(()=>validateStudioNativeSettings({env:{STRATA_ROUTE_TAIL_SKIP:value}}));
 for(const value of [{args:['--host']},{mcp_timeout_s:30},{env:{STRATA_TOKEN:'changed'}},{env:{STRATA_ROUTE_TAIL_SKIP:'12'}}])assert.throws(()=>validateStudioNativeSettings(value));
 assert.deepEqual(restoreStudioNativeEnv({STRATA_ROUTE_TAIL_SKIP:'5'},previous),{PATH:'/native/bin',STRATA_TOKEN:'private',STRATA_ROUTE_TAIL_SKIP:'5'});
 assert.deepEqual(restoreStudioNativeEnv({STRATA_KVA:'1'},previous),{PATH:'/native/bin',STRATA_TOKEN:'private',STRATA_KVA:'1',STRATA_ROUTE_TAIL_SKIP:'12'});
});
test('chat accepts bounded attached images and rejects remote or oversized image payloads',()=>{
 const photo={name:'photo.png',url:'data:image/png;base64,aGVsbG8='};assert.deepEqual(validateChatImages([photo]),[photo]);
 assert.throws(()=>validateChatImages([{url:'https://private.test/image.png'}]));assert.throws(()=>validateChatImages(Array(5).fill(photo)));assert.throws(()=>validateChatImages([{url:'data:image/png;base64,'+Buffer.alloc(6*1024*1024+1).toString('base64')}]));
});
