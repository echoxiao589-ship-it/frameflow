import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createProvider } from './provider.mjs';
import { requireValue } from './store.mjs';

export const LESSONS = [{
  id:'animal-friends', title:'动物朋友', englishTitle:'Meet Coco the cat',
  level:'入门 · 简单句', description:'今天，你来当小猫 Coco 的声音！',
  lines:[
    {id:'hello',english:'Hello! I am a cat.',chinese:'你好！我是一只小猫。',word:'cat',meaning:'小猫',action:'wave',tip:'先听一遍，再像 Coco 一样介绍自己。'},
    {id:'fish',english:'I like fish.',chinese:'我喜欢鱼。',word:'fish',meaning:'鱼',action:'fish',tip:'想一想你喜欢的食物，用开心的声音读出来。'},
    {id:'play',english:"Let's play!",chinese:'我们一起玩吧！',word:'play',meaning:'玩耍',action:'play',tip:'像邀请好朋友一样，把这句话读出来。'}
  ]
}];

export function createEnglishService(dataRoot) {
  const local=createProvider(join(dataRoot,'assets'),{provider:'demo'}),pending=new Map();
  async function make(lesson){
    const folder=join(dataRoot,'english'),manifest=join(folder,lesson.id+'-en-v1.json');
    try{const cached=JSON.parse(await readFile(manifest,'utf8'));if(cached.lines?.length===lesson.lines.length){await Promise.all(cached.lines.map(l=>stat(join(dataRoot,l.url.replace(/^\//,'')))));return cached}}catch{}
    const generated=await local.generate('audio',{language:'en',musicStyle:'none',scenes:lesson.lines.map(l=>({narration:l.english,duration:4}))});
    const result={lessonId:lesson.id,source:'Windows English TTS',lines:generated.audio.map((a,i)=>({id:lesson.lines[i].id,url:a.url,seconds:a.seconds}))};
    await mkdir(folder,{recursive:true});await writeFile(manifest+'.tmp',JSON.stringify(result));await rename(manifest+'.tmp',manifest);return result;
  }
  return {
    lessons:()=>LESSONS,
    async voice(id){const lesson=LESSONS.find(l=>l.id===id);requireValue(lesson,'课程不存在',404);
      if(!pending.has(id))pending.set(id,make(lesson).finally(()=>pending.delete(id)));
      return pending.get(id);
    }
  };
}
