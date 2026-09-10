import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { makeMusic, wavDuration, createProvider } from '../lib/provider.mjs';
import { createStore, STEPS } from '../lib/store.mjs';
import { finalizeWebm } from '../lib/webm.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
let child,base,gateway,dir,failNext=false,delayNext=false;
const tinyPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function startServer(){
  child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:'0',AI_PROVIDER:'gateway',DATA_DIR:dir,AI_GATEWAY_URL:`http://127.0.0.1:${gateway.address().port}`,HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('server timeout '+output)),10000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0])}});child.stderr.on('data',b=>output+=b);child.once('exit',code=>{clearTimeout(timeout);reject(Error('server exited '+code+' '+output))})});
}
async function stopServer(){if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped}}
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'frameflow-test-'));
  gateway=http.createServer(async(req,res)=>{
    let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);
    if(delayNext){delayNext=false;await new Promise(r=>setTimeout(r,150))}
    if(failNext){failNext=false;res.writeHead(503);return res.end('retry')}
    const answer=p.stage==='script'?{script:'完整脚本：以清晨出发开启山野故事。\n\n结尾：带着宁静回到日常。'}:
      p.stage==='outline'?{outline:[{title:'开场',summary:'清晨出发。'},{title:'收束',summary:'宁静归来。'}]}:
      p.stage==='scenes'?{scenes:p.outline.map(o=>({title:o.title,narration:o.summary,visualPrompt:'绿色山野，柔和晨光',duration:3}))}:
      p.stage==='visuals'?{visuals:p.scenes.map(()=>p.mode==='html'?{html:'<style>h1{animation:fade 3s}@keyframes fade{from{opacity:0}to{opacity:1}}</style><h1>清晨山野</h1>'}:{mime:'image/png',base64:tinyPng})}:
      {audio:p.scenes.map(()=>({base64:makeMusic(.2).toString('base64')}))};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(answer));
  });gateway.listen(0,'127.0.0.1');await once(gateway,'listening');await startServer();
});
after(async()=>{await stopServer();gateway.close();await once(gateway,'close')});
async function request(path,method='GET',body,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{'X-Frameflow-Client':'studio',...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()}}
async function create(mode='image'){const r=await request('/projects','POST',{mode,prompt:'山野旅行'});assert.equal(r.status,201);return r.data}
async function run(p,stage){const r=await request('/projects/'+p.id+'/run','POST',{stage,revision:p.revision});assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
async function throughAudio(mode='image'){let p=await create(mode);for(const stage of STEPS.slice(0,5))p=await run(p,stage);return p}

test('strict order: cannot skip script, outline, visuals, audio, or review',async()=>{
  let p=await create();
  for(const stage of ['outline','scenes','visuals','audio'])assert.equal((await request('/projects/'+p.id+'/run','POST',{stage,revision:p.revision})).status,409);
  assert.equal((await request('/projects/'+p.id+'/review','POST',{revision:p.revision,confirmed:true})).status,409);
  assert.equal((await request('/projects/'+p.id+'/export/start','POST',{revision:p.revision})).status,409);
  p=await run(p,'script');assert.ok(p.script.includes('完整脚本'));assert.equal(p.outline.length,0);
  assert.equal((await request('/projects/'+p.id+'/run','POST',{stage:'scenes',revision:p.revision})).status,409);
});
test('both modes produce assets, real HTML, WAV and background music in sequence',async()=>{
  for(const mode of ['image','html']){
    const p=await throughAudio(mode);for(const s of STEPS.slice(0,5))assert.equal(p.steps[s].status,'completed');
    assert.equal(p.scenes[0].visual.kind,mode);assert.ok(p.scenes[0].audio.seconds>0);
    if(mode==='html')assert.match(p.scenes[0].visual.html,/@keyframes/);else assert.equal((await fetch(base+p.scenes[0].visual.url)).status,200);
    const wav=Buffer.from(await(await fetch(base+p.scenes[0].audio.url)).arrayBuffer());assert.ok(wavDuration(wav)>0);
    const range=await fetch(base+p.music.url,{headers:{Range:'bytes=0-43'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,44);
    assert.equal(p.steps.review.status,'pending');assert.equal(p.steps.export.status,'pending');
  }
});
test('upstream scene edits invalidate visuals, audio, review and export while retaining script',async()=>{
  let p=await throughAudio();p=(await request('/projects/'+p.id+'/review','POST',{revision:p.revision,confirmed:true})).data;
  const r=await request('/projects/'+p.id,'PATCH',{revision:p.revision,scene:{...p.scenes[0],narration:'修改后的旁白',duration:4}});assert.equal(r.status,200);p=r.data;
  assert.equal(p.steps.script.status,'completed');assert.equal(p.steps.scenes.status,'completed');
  for(const s of ['visuals','audio','review','export'])assert.equal(p.steps[s].status,'pending');
  assert.equal(p.scenes[0].visual,null);assert.equal(p.scenes[0].audio,null);assert.equal(p.music,null);
  assert.equal((await request('/projects/'+p.id+'/run','POST',{stage:'audio',revision:p.revision})).status,409);
});
test('voice-to-visual loop clears audio, then allows sound regeneration',async()=>{
  let p=await throughAudio('html');p=await run(p,'visuals');assert.equal(p.steps.audio.status,'pending');assert.equal(p.scenes[0].audio,null);
  p=await run(p,'audio');assert.equal(p.steps.audio.status,'completed');
  const edited=await request('/projects/'+p.id,'PATCH',{revision:p.revision,script:'新的完整脚本'});assert.equal(edited.status,200);assert.equal(edited.data.outline.length,0);assert.equal(edited.data.scenes.length,0);
});
test('stale revisions and concurrent generation are rejected',async()=>{
  let p=await create();const initial=p.revision;p=await run(p,'script');
  assert.equal((await request('/projects/'+p.id,'PATCH',{revision:initial,script:'过期版本'})).status,409);
  delayNext=true;const pending=request('/projects/'+p.id+'/run','POST',{stage:'outline',revision:p.revision});
  await new Promise(r=>setTimeout(r,40));assert.equal((await request('/projects/'+p.id+'/run','POST',{stage:'outline',revision:p.revision})).status,409);assert.equal((await pending).status,200);
});
test('provider failures persist and can be retried without skipping',async()=>{
  let p=await create();failNext=true;const r=await request('/projects/'+p.id+'/run','POST',{stage:'script',revision:p.revision});assert.equal(r.status,502);
  p=(await request('/projects/'+p.id)).data;assert.equal(p.steps.script.status,'failed');assert.equal(p.steps.outline.status,'pending');p=await run(p,'script');assert.equal(p.steps.script.status,'completed');
});
test('invalid edits are atomic and cross-origin writes are blocked',async()=>{
  const p=await throughAudio();
  assert.equal((await request('/projects/'+p.id,'PATCH',{revision:p.revision,scene:{...p.scenes[0],title:'不应保存',duration:-1}})).status,400);
  const same=(await request('/projects/'+p.id)).data;assert.equal(same.scenes[0].title,p.scenes[0].title);assert.equal(same.revision,p.revision);
  assert.equal((await request('/projects','POST',{mode:'image'},{Origin:'https://example.com'})).status,403);
  assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"mode":"image"}'})).status,403);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
});
test('exports require confirmation, validate session/content, survive server restart',async()=>{
  let p=await throughAudio();assert.equal((await request('/projects/'+p.id+'/review','POST',{revision:p.revision,confirmed:false})).status,400);
  p=(await request('/projects/'+p.id+'/review','POST',{revision:p.revision,confirmed:true})).data;
  const ticket=(await request('/projects/'+p.id+'/export/start','POST',{revision:p.revision})).data;
  await stopServer();await startServer();
  let r=await fetch(base+'/api/projects/'+p.id+'/export',{method:'POST',headers:{'X-Frameflow-Client':'studio','X-Export-Token':ticket.token,'Content-Type':'video/webm'},body:Buffer.alloc(160)});assert.equal(r.status,400);
  // Transport test fixture only: correct container magic, not a playable video.
  const fixture=Buffer.alloc(160);fixture.set([26,69,223,163]);
  r=await fetch(base+'/api/projects/'+p.id+'/export',{method:'POST',headers:{'X-Frameflow-Client':'studio','X-Export-Token':ticket.token,'Content-Type':'video/webm'},body:fixture});assert.equal(r.status,201);p=await r.json();assert.equal(p.steps.export.status,'completed');assert.equal((await fetch(base+p.exports[0].url)).status,200);
  assert.ok((await readFile(join(dir,'projects.json'),'utf8')).includes(p.id));
});
test('interrupted tasks recover as failed and corrupted stores never silently reset',async()=>{
  const local=await mkdtemp(join(tmpdir(),'frameflow-store-'));let store=createStore(local);const p=store.add('image','测试');p.steps.script={status:'running'};store.touch(p);store=createStore(local);assert.equal(store.get(p.id).steps.script.status,'failed');
  await writeFile(join(local,'projects.json'),'{broken');assert.throws(()=>createStore(local));
});
test('Windows local provider generates actual speech files', {skip:process.platform!=='win32'}, async()=>{
  const assets=await mkdtemp(join(tmpdir(),'frameflow-speech-'));const local=createProvider(assets,{provider:'demo'});
  const result=await local.generate('audio',{musicStyle:'none',scenes:[{narration:'你好，欢迎使用帧序。',duration:3}]});assert.ok(result.audio[0].seconds>1);assert.ok(['Windows SAPI','Edge 神经语音 · 温柔女声'].includes(result.audio[0].source));assert.equal(result.music,null);
});
test('streaming WebM receives duration metadata without changing encoded frames',()=>{
  const header=Buffer.from([0x1a,0x45,0xdf,0xa3,0x80,0x18,0x53,0x80,0x67,0xff,0x15,0x49,0xa9,0x66,0x87,0x2a,0xd7,0xb1,0x83,0x0f,0x42,0x40]);
  const frames=Buffer.from([0x1f,0x43,0xb6,0x75,0xff,1,2,3]);const source=Buffer.concat([header,frames]);
  const output=finalizeWebm(source,12.5);assert.equal(output.length,source.length+11);const index=output.indexOf(Buffer.from([0x44,0x89,0x88]));assert.equal(output.readDoubleBE(index+3),12500);assert.ok(output.subarray(-frames.length).equals(frames));assert.ok(finalizeWebm(Buffer.from('invalid'),2).equals(Buffer.from('invalid')));
});
