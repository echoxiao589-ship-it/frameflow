import http from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createStore, STEPS, LABELS, Problem, requireValue, textValue, invalidate, assertPrevious } from './lib/store.mjs';
import { createProvider } from './lib/provider.mjs';
import { finalizeWebm } from './lib/webm.mjs';
import { createEnglishService } from './lib/english.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataRoot = resolve(process.env.DATA_DIR || join(root,'data'));
// 监听地址：本地双击 start.cmd 时未注入 PORT，监听 127.0.0.1 且只放行本机（安全默认）；
// 云平台 / 容器一定会注入 PORT，此时监听 0.0.0.0 并放行任意域名，供反向代理与公网访问。
const bindHost = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const hostRules = (process.env.ALLOWED_HOSTS !== undefined ? process.env.ALLOWED_HOSTS : (bindHost === '0.0.0.0' ? '*' : '')).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const store = createStore(dataRoot), locks = new Set();
const english = createEnglishService(dataRoot);
const provider = createProvider(join(dataRoot,'assets'), { provider:process.env.AI_PROVIDER || 'demo', url:process.env.AI_GATEWAY_URL, key:process.env.AI_GATEWAY_KEY });
requireValue(['demo','gateway'].includes(provider.kind),'AI_PROVIDER 只能为 demo 或 gateway');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.webm':'video/webm','.mp4':'video/mp4'};
function publicProject(p) { const {exportTicket,...rest}=p; return {...rest,busy:locks.has(p.id)}; }
function reply(res,status,value) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
async function bytes(req,max=1024*1024) { let size=0; const parts=[]; for await (const part of req) {size+=part.length;requireValue(size<=max,'请求内容过大',413);parts.push(part)}return Buffer.concat(parts); }
async function json(req) { const b=await bytes(req);if(!b.length)return {};try{return JSON.parse(b.toString())}catch{throw new Problem(400,'请求必须为有效 JSON')} }
function unlocked(p,body) { requireValue(!locks.has(p.id),'项目正在生成，请稍后操作',409);requireValue(body.revision===p.revision,'项目已发生变化，请刷新后重试',409); }
function log(p,role,text) {p.messages.push({role,text,at:new Date().toISOString()});p.messages=p.messages.slice(-100)}
async function run(p,body) {
  unlocked(p,body); const stage=body.stage;requireValue(STEPS.slice(0,5).includes(stage),'该步骤不能自动生成');
  assertPrevious(p,stage);if(stage==='script')p.prompt=textValue(p.prompt,'创作提示词',3000);
  invalidate(p,stage);p.steps[stage]={status:'running',startedAt:new Date().toISOString()};locks.add(p.id);store.touch(p);
  try {
    const result=await provider.generate(stage,structuredClone(p));
    if(stage==='script')p.script=result.script;
    if(stage==='outline')p.outline=result.outline;
    if(stage==='scenes')p.scenes=result.scenes;
    if(stage==='visuals')p.scenes.forEach((s,i)=>{s.visual=result.visuals[i]});
    if(stage==='audio'){p.scenes.forEach((s,i)=>{s.audio=result.audio[i];s.duration=Math.max(s.duration,s.audio.seconds+.5)});p.music=result.music}
    p.steps[stage]={status:'completed',completedAt:new Date().toISOString(),source:stage==='audio'?(result.audio&&result.audio[0]&&result.audio[0].source||provider.kind):provider.kind};
    log(p,'assistant',`${LABELS[STEPS.indexOf(stage)]}已完成。${stage==='audio'?'请播放检查画面与声音，确认后才能录屏输出。':'可以检查并编辑结果，然后继续下一步。'}`);
  } catch(error) {p.steps[stage]={status:'failed',error:error.status?error.message:'生成失败，请稍后重试'};throw error}
  finally {locks.delete(p.id);store.touch(p)}
}
async function serveFile(req,res,file,download=false) {
  let info;try{info=await stat(file)}catch{throw new Problem(404,'文件不存在')}
  const headers={'Content-Type':types[extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
  if(download)headers['Content-Disposition']=`attachment; filename="${file.split(/[\\/]/).pop()}"`;
  let start=0,end=info.size-1,status=200;
  if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);requireValue(m,'无效媒体范围',416);start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end;requireValue(start<=end&&start<info.size,'媒体范围超出文件',416);status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`}
  headers['Content-Length']=end-start+1;res.writeHead(status,headers);
  if(req.method==='HEAD')return res.end();createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try {
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    // 主机白名单：默认只放行本机（DNS 重绑定防护）。部署到服务器时把 HOST 设为 0.0.0.0，
    // 即视为主动对外开放，自动放行任意域名；也可用 ALLOWED_HOSTS 精确指定，例如
    // ALLOWED_HOSTS=example.com,www.example.com
    const host=(req.headers.host||'').split(':')[0].toLowerCase();
    const openHosts=hostRules.includes('*');
    requireValue(openHosts||hostRules.includes(host)||['127.0.0.1','localhost',(bindHost||'127.0.0.1').toLowerCase()].includes(host),'不允许的访问主机',403);
    if(!['GET','HEAD'].includes(req.method)) {
      if(req.headers.origin){
        let originHost='';try{originHost=new URL(req.headers.origin).host.toLowerCase()}catch{originHost=''}
        // 反代后浏览器 Origin 为 https://域名，而 Host 为 域名，这里只比主机名以兼容 HTTPS 与端口差异
        requireValue(openHosts||originHost===req.headers.host.toLowerCase(),'不允许跨站修改项目',403);
      }
      requireValue(req.headers['x-frameflow-client']==='studio','缺少客户端标识',403);
    }
    if(path==='/api/config'&&req.method==='GET')return reply(res,200,{provider:provider.kind,steps:STEPS,labels:LABELS,speech:provider.kind==='demo'?(process.platform==='win32'?'Windows SAPI 中文语音':'静音占位（当前服务器无中文语音，可配置生成网关接入真人配音）'):'生成网关',gatewayConfigured:!!process.env.AI_GATEWAY_URL});
    if(path==='/api/english/lessons'&&req.method==='GET')return reply(res,200,english.lessons());
    const englishVoice=/^\/api\/english\/lessons\/([a-z-]+)\/voice$/.exec(path);
    if(englishVoice&&req.method==='POST')return reply(res,200,await english.voice(englishVoice[1]));
    if(path==='/api/projects') {
      if(req.method==='GET')return reply(res,200,store.list().map(p=>({id:p.id,title:p.title,mode:p.mode,updatedAt:p.updatedAt,steps:p.steps,revision:p.revision})));
      if(req.method==='POST'){const body=await json(req);const p=store.add(body.mode,body.prompt?textValue(body.prompt,'提示词',3000):'');
        if(body.template==='essay'){requireValue(body.essay&&typeof body.essay==='object','作文讲解项目需要携带批改数据');const essay=JSON.parse(JSON.stringify(body.essay));requireValue(JSON.stringify(essay).length<200000,'批改数据过大',413);p.template='essay';p.essay=essay;store.touch(p)}
        return reply(res,201,publicProject(p))}
    }
    // ---------- 作文批改存档：学生提交后教师可在班级管理中查看 ----------
    if(path==='/api/essays'){
      if(req.method==='GET')return reply(res,200,await readFile(join(dataRoot,'essays.json'),'utf8').then(JSON.parse).catch(()=>[]));
      if(req.method==='POST'){
        const body=await json(req);
        requireValue(typeof body.user==='string'&&body.user.length>=1&&body.user.length<=40,'账号无效',400);
        requireValue(typeof body.text==='string'&&body.text.trim().length>=10&&body.text.length<30000,'作文正文无效',400);
        requireValue(['cet4','cet6','ielts'].includes(body.standard),'评分标准无效',400);
        requireValue(body.score&&typeof body.score==='object','得分数据无效',400);
        const list=await readFile(join(dataRoot,'essays.json'),'utf8').then(JSON.parse).catch(()=>[]);
        const rec={id:randomUUID(),user:body.user.slice(0,40),student:String(body.student||body.user).slice(0,40),cls:String(body.cls||'').slice(0,60),
          title:String(body.title||'').slice(0,120),standard:body.standard,text:body.text,
          revised:String(body.revised||'').slice(0,30000),
          trace:Array.isArray(body.trace)?body.trace.slice(0,80).map(t=>({orig:String(t.orig||'').slice(0,400),rep:String(t.rep||'').slice(0,400),tip:String(t.tip||'').slice(0,300)})):[],
          score:{label:String(body.score.label||'').slice(0,20),value:String(body.score.value||'').slice(0,12),total:Math.round(Number(body.score.total)||0),cefr:String(body.score.cefr||'').slice(0,6)},
          words:Math.round(Number(body.words)||0),issues:Math.round(Number(body.issues)||0),engine:String(body.engine||'local').slice(0,10),time:new Date().toLocaleString('zh-CN')};
        list.unshift(rec);await mkdir(dataRoot,{recursive:true});await writeFile(join(dataRoot,'essays.json'),JSON.stringify(list.slice(0,500),null,2));
        return reply(res,201,{ok:true,id:rec.id});
      }
    }
    const match=/^\/api\/projects\/([a-f0-9-]+)(?:\/(.*))?$/.exec(path);
    if(match){const p=store.get(match[1]),action=match[2];
      if(!action&&req.method==='GET')return reply(res,200,publicProject(p));
      if(!action&&req.method==='DELETE'){const body=await json(req);unlocked(p,body);store.remove(p.id);return reply(res,200,{ok:true})}
      if(!action&&req.method==='PATCH'){
        const body=await json(req);unlocked(p,body);
        if(body.prompt!==undefined){p.prompt=textValue(body.prompt,'提示词',3000);p.title=p.prompt.slice(0,24);p.script='';invalidate(p,'script');log(p,'user',p.prompt)}
        else if(body.script!==undefined){requireValue(p.steps.script.status==='completed','请先生成脚本',409);p.script=textValue(body.script,'脚本');invalidate(p,'outline');log(p,'assistant','脚本已修改，大纲及后续步骤需要重新生成。')}
        else if(body.outline!==undefined){requireValue(p.steps.outline.status==='completed','请先生成大纲',409);requireValue(Array.isArray(body.outline)&&body.outline.length>0&&body.outline.length<=12,'大纲需要 1–12 个章节');const validated=body.outline.map(o=>({title:textValue(o.title,'章节标题',60),summary:textValue(o.summary,'章节内容',1500)}));p.outline=validated;invalidate(p,'scenes')}
        else if(body.scene){requireValue(p.steps.scenes.status==='completed','请先拆分分镜',409);const target=p.scenes.find(s=>s.id===body.scene.id);requireValue(target,'分镜不存在',404);
          const edited={title:textValue(body.scene.title,'分镜标题',60),narration:textValue(body.scene.narration,'旁白',400),visualPrompt:textValue(body.scene.visualPrompt,'画面描述',2000),duration:Number(body.scene.duration)};
          requireValue(Number.isFinite(edited.duration)&&edited.duration>=3&&edited.duration<=60,'分镜时长必须为 3–60 秒');Object.assign(target,edited);invalidate(p,'visuals');log(p,'assistant','分镜已修改。请重新生成画面与声音，再进行预览确认。')
        }else if(body.musicStyle!==undefined){requireValue(['gentle','bright','none'].includes(body.musicStyle),'未知配乐类型');p.musicStyle=body.musicStyle;invalidate(p,'audio')}
        else throw new Problem(400,'没有可保存的修改');
        store.touch(p);return reply(res,200,publicProject(p));
      }
      if(action==='run'&&req.method==='POST'){await run(p,await json(req));return reply(res,200,publicProject(p))}
      if(action==='review'&&req.method==='POST'){const body=await json(req);unlocked(p,body);assertPrevious(p,'review');requireValue(body.confirmed===true,'请确认已检查预览');p.steps.review={status:'completed',completedAt:new Date().toISOString()};p.reviewedAt=new Date().toISOString();p.steps.export={status:'pending'};p.exportTicket=null;log(p,'assistant','预览已确认，现在可以录屏输出。');store.touch(p);return reply(res,200,publicProject(p))}
      if(action==='export/start'&&req.method==='POST'){const body=await json(req);unlocked(p,body);assertPrevious(p,'export');p.exportTicket={token:randomUUID(),expires:Date.now()+30*60*1000,revision:p.revision+1};store.touch(p);return reply(res,200,{token:p.exportTicket.token,revision:p.revision})}
      if(action==='export'&&req.method==='POST'){
        requireValue(!locks.has(p.id),'项目正在生成',409);assertPrevious(p,'export');const ticket=p.exportTicket;
        requireValue(ticket&&ticket.expires>Date.now()&&ticket.revision===p.revision,'导出会话已过期或项目已修改，请重新录制',409);
        const token=String(req.headers['x-export-token']||'');requireValue(token.length===ticket.token.length&&timingSafeEqual(Buffer.from(token),Buffer.from(ticket.token)),'无效导出会话',403);
        const contentType=(req.headers['content-type']||'').split(';')[0];requireValue(['video/webm','video/mp4'].includes(contentType),'导出格式仅支持 WebM / MP4');
        locks.add(p.id);
        try {const b=await bytes(req,150*1024*1024);requireValue(b.length>128,'视频内容为空');requireValue(contentType==='video/webm'?b.subarray(0,4).equals(Buffer.from([26,69,223,163])):b.toString('ascii',4,8)==='ftyp','视频格式与内容不一致');
          const duration=p.scenes.reduce((sum,s)=>sum+s.duration,0),output=contentType==='video/webm'?finalizeWebm(b,duration):b;
          const file=randomUUID()+(contentType==='video/mp4'?'.mp4':'.webm');await mkdir(join(dataRoot,'exports'),{recursive:true});await writeFile(join(dataRoot,'exports',file),output);
          p.exports.unshift({id:randomUUID(),url:'/exports/'+file,bytes:output.length,duration,at:new Date().toISOString(),revision:p.revision});p.steps.export={status:'completed',completedAt:new Date().toISOString()};p.exportTicket=null;log(p,'assistant','录制文件已保存到后台，可随时下载。');store.touch(p);
        }finally{locks.delete(p.id)}return reply(res,201,publicProject(p));
      }
    }
    if(['GET','HEAD'].includes(req.method)){
      if(/^\/(assets|exports)\/[a-f0-9-]+\.(svg|png|jpg|webp|wav|webm|mp4|mp3)$/.test(path))return await serveFile(req,res,join(dataRoot,path.slice(1)),path.startsWith('/exports/'));
      if(path==='/'&&req.method==='GET'&&!url.searchParams.has('studio')){res.writeHead(302,{Location:'/essay'});return res.end();}
      const allowed={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/base.css':'base.css','/studio':'index.html','/studio/':'index.html','/english':'english.html','/english/':'english.html','/english.css':'english.css','/english.js':'english.js','/media-utils.js':'media-utils.js','/essay':'essay.html','/essay/':'essay.html','/essay.html':'essay.html'};
      if(allowed[path])return await serveFile(req,res,join(root,'public',allowed[path]));
    }
    throw new Problem(404,'接口或页面不存在');
  }catch(error){if(!res.headersSent)reply(res,error.status||500,{error:error.status?error.message:'服务器内部错误，请稍后重试'});else res.destroy();if(!error.status)console.error(error)}
});
server.requestTimeout=180000;
server.listen(Number(process.env.PORT||4173),bindHost,()=>console.log(`Frameflow ready: http://${bindHost}:${server.address().port} · ${provider.kind} · hosts=${hostRules.join('|')||'local'}`));
