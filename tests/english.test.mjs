import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEnglishService, LESSONS } from '../lib/english.mjs';
import { wavDuration } from '../lib/provider.mjs';
import { addWebmDuration } from '../public/media-utils.js';

test('first English lesson has three independently recordable lines',()=>{
  assert.equal(LESSONS.length,1);assert.equal(LESSONS[0].lines.length,3);assert.equal(new Set(LESSONS[0].lines.map(l=>l.id)).size,3);
  assert.equal(LESSONS[0].lines[0].english,'Hello! I am a cat.');assert.ok(LESSONS[0].lines.every(l=>l.english&&l.chinese&&l.word));
});
test('unknown lessons are rejected before synthesis',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'little-voice-invalid-'));const service=createEnglishService(dir);await assert.rejects(()=>service.voice('../private'),error=>error.status===404);
});
test('English examples generate real WAV, share concurrent requests and persist cache',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'little-voice-tts-')),service=createEnglishService(dir);
  const [first,second]=await Promise.all([service.voice('animal-friends'),service.voice('animal-friends')]);assert.deepEqual(first,second);assert.equal(first.lines.length,3);
  for(const l of first.lines){const b=await readFile(join(dir,l.url.slice(1)));const dur=l.url.endsWith('.mp3')?b.length*8/48000:wavDuration(b);assert.ok(dur>.5);assert.ok(dur<12)}
  const afterRestart=await createEnglishService(dir).voice('animal-friends');assert.deepEqual(first,afterRestart);
});
test('student recordings get local WebM duration without uploading their content',async()=>{
  const bytes=Uint8Array.from([0x1a,0x45,0xdf,0xa3,0x80,0x18,0x53,0x80,0x67,0xff,0x15,0x49,0xa9,0x66,0x87,0x2a,0xd7,0xb1,0x83,0x0f,0x42,0x40,0x1f,0x43,0xb6,0x75,0xff,1,2,3]);
  const result=await addWebmDuration(new Blob([bytes],{type:'video/webm'}),4.5),b=Buffer.from(await result.arrayBuffer());
  assert.equal(b.length,bytes.length+11);const at=b.indexOf(Buffer.from([0x44,0x89,0x88]));assert.equal(b.readDoubleBE(at+3),4500);
  const mp4=new Blob(['example'],{type:'video/mp4'});assert.equal(await addWebmDuration(mp4,5),mp4);
});
