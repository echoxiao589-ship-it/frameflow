import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Problem, requireValue, textValue } from './store.mjs';
const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function wavDuration(buffer) {
  requireValue(buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE', '声音服务必须返回 PCM WAV 文件', 502);
  let rate = 0, size = 0;
  for (let at = 12; at + 8 <= buffer.length;) {
    const type = buffer.toString('ascii', at, at + 4), length = buffer.readUInt32LE(at + 4);
    requireValue(at + 8 + length <= buffer.length, 'WAV 数据不完整', 502);
    if (type === 'fmt ' && length >= 16) { requireValue(buffer.readUInt16LE(at + 8) === 1, '仅支持 PCM WAV', 502); rate = buffer.readUInt32LE(at + 16); }
    if (type === 'data') size += length;
    at += 8 + length + length % 2;
  }
  requireValue(rate > 0 && size > 0, '声音文件没有有效音轨', 502);
  const seconds = size / rate;
  requireValue(seconds <= 60, '单个分镜声音不能超过 60 秒', 502);
  return seconds;
}
export function makeMusic(seconds, style = 'gentle') {
  const rate = 22050, samples = Math.ceil(seconds * rate), b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  const freqs = style === 'bright' ? [261.63, 329.63, 392] : [130.81, 164.81, 196];
  for (let i = 0; i < samples; i++) {
    const t = i / rate, envelope = Math.min(1, t / 2, (seconds - t) / 2);
    const wave = freqs.reduce((sum, f, k) => sum + Math.sin(t * f * Math.PI * 2) * (0.35 + 0.15 * Math.sin(t * .5 + k)) / (k + 1), 0);
    b.writeInt16LE(Math.round(wave * envelope * 2600), 44 + i * 2);
  }
  return b;
}
export function silentWav(seconds) {
  const rate = 22050, samples = Math.max(1, Math.ceil(seconds * rate)), b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}
function demoImage(scene, index) {
  const hue = 140 + index * 25;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="hsl(${hue},18%,58%)"/><stop offset="1" stop-color="#efcf9d"/></linearGradient><linearGradient id="land" x2="0" y2="1"><stop stop-color="hsl(${hue},17%,38%)"/><stop offset="1" stop-color="#19332d"/></linearGradient></defs><rect width="1280" height="720" fill="url(#sky)"/><circle cx="${900-index*100}" cy="180" r="57" fill="#ffe8b4" opacity=".75"/><path d="M0 480L180 200 330 350 490 160 760 420 970 240 1280 430V720H0" fill="hsl(${hue},16%,43%)" opacity=".5"/><path d="M0 510L150 350 350 460 640 290 900 480 1140 320 1280 430V720H0" fill="url(#land)"/><path d="M710 490Q460 555 760 620T670 720H1020Q1160 650 870 585T740 490" fill="#b7b69a" opacity=".45"/><path d="M0 490Q180 510 430 720H0M1280 510Q1160 550 1100 720H1280" fill="#203c33"/><text x="640" y="300" text-anchor="middle" fill="#fff5df" font-size="18" font-family="sans-serif" letter-spacing="6">FRAMEFLOW · STORY ${index+1}</text><text x="640" y="383" text-anchor="middle" fill="#fff5df" font-size="44" font-family="sans-serif">${esc(scene.title.slice(0,22))}</text><text x="55" y="665" fill="#fff9" font-size="15" font-family="sans-serif">本地示例插画 · AI 图像服务未启用</text></svg>`;
}
function demoHtml(scene, index) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#17151f;color:#f5efff;font-family:Arial,'Microsoft YaHei',sans-serif;overflow:hidden}.grid{position:absolute;inset:0;background:linear-gradient(#ffffff06 1px,transparent 1px),linear-gradient(90deg,#ffffff06 1px,transparent 1px);background-size:64px 64px}.glow{position:absolute;inset:0;background:radial-gradient(ellipse at 75% 40%,hsl(${260+index*25},25%,30%),transparent 70%)}.orb{position:absolute;top:180px;left:850px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle at 30% 25%,#fff3fc,#b59ade 45%,#4b3a64 85%);box-shadow:0 30px 80px #0004;animation:float 6s ease-in-out infinite}.ring{position:absolute;top:220px;left:770px;width:420px;height:160px;border:1px solid #ddc6ff77;border-radius:50%;transform:rotate(-28deg);animation:ring 8s linear infinite}.copy{position:absolute;left:90px;top:145px;width:680px;animation:enter 1s both}.eyebrow{font-size:15px;letter-spacing:5px;color:#bdaecf}h1{font-size:70px;line-height:1.25;font-weight:600;margin:42px 0;max-width:680px;overflow-wrap:anywhere}p{font-size:21px;color:#b4a7c5}.footer{position:absolute;left:90px;bottom:90px;font:14px monospace;color:#9f90b0}@keyframes float{50%{transform:translateY(-35px) scale(1.08)}}@keyframes ring{to{transform:rotate(332deg)}}@keyframes enter{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}</style></head><body><div class="grid"></div><div class="glow"></div><div class="orb"></div><div class="ring"></div><div class="copy"><div class="eyebrow">FRAMEFLOW / CHAPTER 0${index+1}</div><h1>${esc(scene.title)}</h1><p>${esc(scene.visualPrompt.slice(0,42))}</p></div><div class="footer">IDEAS DESERVE TO BE SEEN. / HTML + CSS</div></body></html>`;
}
/* ===== 作文批改讲解模板（template='essay'）=====
   由 essay.html 提交的真实批改结果（project.essay）驱动：每一幕的画面与旁白都对应具体数据，
   本地生成、结构严格可控，不走 AI 网关（避免改写数据丢失准确性）。 */
const essayInput = project => project.template === 'essay' && project.essay && typeof project.essay === 'object' ? project.essay : null;
const brief = (value, max) => { const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max) + '…' : s; };
const cardText = pairs => ['类型=' + pairs['类型']].concat(Object.keys(pairs).filter(k => k !== '类型').map(k => `${k}=${String(pairs[k] == null ? '' : pairs[k]).replace(/[\r\n]+/g, ' ')}`)).join('\n');
function cardData(scene) {
  const data = { 类型: 'list' };
  String(scene.visualPrompt || '').split('\n').forEach(line => { const at = line.indexOf('='); if (at > 0) data[line.slice(0, at).trim()] = line.slice(at + 1).trim(); });
  return data;
}
const cardItems = data => Object.keys(data).filter(k => /^项\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(k => data[k]).filter(Boolean);
export function essayPlan(essay) {
  const strings = list => (Array.isArray(list) ? list : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  const ranked = (Array.isArray(essay.categories) ? essay.categories : []).filter(c => c && Array.isArray(c.items) && c.items.length)
    .slice().sort((a, b) => (Number(b.sev) || 0) - (Number(a.sev) || 0) || b.items.length - a.items.length);
  const dims = essay.dims && typeof essay.dims === 'object' ? essay.dims : {};
  const plan = [{
    title: `综合评分 ${essay.score} 分 · ${essay.cefr}`,
    narration: `这是一篇《${brief(essay.title, 18)}》，全文 ${essay.words} 词、${essay.sents} 个句子。综合得分 ${essay.score} 分，对应 CEFR ${essay.cefr} 水平。接下来分步看它的亮点和需要改进的地方。`,
    duration: 11,
    card: cardText({ 类型: 'score', 主值: essay.score, 徽章: essay.cefr, 说明: `${essay.words} 词 · ${essay.sents} 句 · ${essay.issues} 处可改进`, ...dims })
  }];
  const strengths = strings(essay.strengths).slice(0, 3);
  if (strengths.length) plan.push({
    title: '值得肯定的地方',
    narration: `先说亮点。这篇作文${brief(strengths.join('；').replace(/[。；,，]+$/, ''), 66)}。这些方面请继续保持。`,
    duration: 10,
    card: cardText({ 类型: 'list', 标题: '值得肯定的地方', ...Object.fromEntries(strengths.map((s, i) => ['项' + (i + 1), brief(s, 40)])) })
  });
  ranked.slice(0, 2).forEach((c, i) => {
    const sample = c.items.find(it => it && it.orig) || c.items[0] || {};
    plan.push({
      title: `${c.label} · ${c.items.length} 处`,
      narration: `第 ${i + 1} 类问题是${c.label}，共 ${c.items.length} 处。${brief(sample.tip, 76) || '建议按画面提示修改。'}`,
      duration: 13,
      card: cardText({ 类型: 'issue', 标签: c.label, 计数: `${c.items.length} 处`, 错: brief(sample.orig, 46) || '（此处需要修改）', 对: brief(sample.rep, 46) || '（删除多余内容）', 解: brief(sample.tip, 62) })
    });
  });
  const upgrades = strings(essay.upgrades).slice(0, 4);
  if (upgrades.length) plan.push({
    title: '让表达更地道',
    narration: '再看用词和句式。把常见表达换成更地道的说法，文章会更出彩，画面上列出了可以直接替换的例子。',
    duration: 10,
    card: cardText({ 类型: 'upgrade', 标题: '让表达更地道', ...Object.fromEntries(upgrades.map((u, i) => ['项' + (i + 1), u])) })
  });
  const advice = strings(essay.advice).slice(0, 4);
  plan.push({
    title: '下一步怎么练',
    narration: advice.length ? `最后是练习建议。${brief(advice.join('；').replace(/[。；,，]+$/, ''), 64)}。改完再读一遍，进步会看得见。` : '最后建议把修改后的全文朗读一遍，检查句子是否通顺。改完再读一遍，进步会看得见。',
    duration: 11,
    card: cardText({ 类型: 'list', 标题: '下一步怎么练', ...Object.fromEntries((advice.length ? advice : ['把修改后的全文朗读一遍，检查是否通顺']).map((a, i) => ['项' + (i + 1), brief(a, 40)])) })
  });
  return plan.slice(0, 6);
}
function demoEssayHtml(scene, index, count) {
  const data = cardData(scene), items = cardItems(data);
  const dots = Array.from({ length: count }, (_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('');
  let body;
  if (data.类型 === 'score') {
    const bars = ['准确性', '词汇', '句式', '连贯'].filter(k => data[k] != null && data[k] !== '')
      .map(k => `<div class="bar"><span>${esc(k)}</span><div class="track"><i style="width:${Math.max(0, Math.min(100, Number(data[k]) || 0))}%"></i></div><b>${esc(data[k])}</b></div>`).join('');
    body = `<div class="score"><div class="num">${esc(data.主值)}<small>分</small></div><div class="badge">CEFR ${esc(data.徽章)}</div></div><p class="meta">${esc(data.说明)}</p>${bars ? `<div class="bars">${bars}</div>` : ''}`;
  } else if (data.类型 === 'issue') {
    body = `<div class="tag">${esc(data.标签)}<span>${esc(data.计数)}</span></div><div class="pair"><div class="wrong">${esc(data.错)}</div><div class="arrow">↓</div><div class="right">${esc(data.对)}</div></div><p class="tip">${esc(data.解)}</p>`;
  } else if (data.类型 === 'upgrade') {
    body = `<div class="tag">用词升级</div><ul class="swap">${items.map(t => { const p = t.split('→'); return `<li><span class="old">${esc((p[0] || '').trim())}</span><b>→</b><span class="new">${esc((p[1] || '').trim())}</span></li>`; }).join('')}</ul>`;
  } else {
    body = `<div class="tag">${esc(data.标题 || '要点')}</div><ul class="list">${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;overflow:hidden;background:linear-gradient(135deg,#0c1a23,#15303d 58%,#0e2331);color:#eef6f4;font-family:Arial,'Microsoft YaHei',sans-serif}.grid{position:absolute;inset:0;background:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:72px 72px}.glow{position:absolute;inset:0;background:radial-gradient(ellipse at 80% 20%,#2f8f8555,transparent 62%)}.head{position:absolute;left:78px;right:78px;top:56px;display:flex;justify-content:space-between;align-items:center;font:14px/1 monospace;letter-spacing:4px;color:#7fb3ab}.dots i{display:inline-block;width:9px;height:9px;border-radius:50%;background:#ffffff2e;margin-left:9px}.dots i.on{background:#7fd1c0}.card{position:absolute;left:78px;right:78px;top:126px;bottom:92px;background:#ffffff0a;border:1px solid #ffffff1c;border-radius:26px;padding:48px 56px;display:flex;flex-direction:column;justify-content:center;animation:rise .9s both}.tag{align-self:flex-start;display:flex;align-items:center;gap:14px;font-size:17px;letter-spacing:2px;color:#0c2230;background:#7fd1c0;padding:9px 22px;border-radius:999px;margin-bottom:30px;animation:rise .9s .1s both}.tag span{background:#0c2230;color:#7fd1c0;font-size:14px;padding:3px 12px;border-radius:999px}.score{display:flex;align-items:baseline;gap:34px}.num{font-size:132px;line-height:1;font-weight:600;color:#ffe4a3}.num small{font-size:28px;margin-left:8px;color:#bfd6d0}.badge{font-size:24px;letter-spacing:2px;color:#0c2230;background:#ffe4a3;padding:8px 22px;border-radius:999px}.meta{font-size:22px;color:#a9c4bf;margin:26px 0 34px}.bars{display:grid;grid-template-columns:1fr 1fr;gap:18px 46px}.bar{display:flex;align-items:center;gap:14px;font-size:18px;color:#cfe3df}.bar span{width:56px;flex:none}.track{flex:1;height:10px;border-radius:999px;background:#ffffff1f;overflow:hidden}.track i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#7fd1c0,#ffe4a3);animation:grow 1.2s .3s both}.bar b{width:42px;text-align:right;color:#ffe4a3}.pair{font-family:Georgia,'Times New Roman',serif}.wrong{font-size:38px;color:#ff9d9d;text-decoration:line-through;text-decoration-thickness:3px}.arrow{font-size:22px;color:#7fb3ab;margin:14px 0}.right{font-size:38px;color:#8ff0b4}.tip{font-size:20px;line-height:1.7;color:#cfe3df;margin-top:34px}.swap,.list{margin:0;padding:0;list-style:none}.swap li{display:flex;align-items:center;gap:20px;font-family:Georgia,'Times New Roman',serif;font-size:30px;padding:15px 0;border-bottom:1px dashed #ffffff1c}.swap .old{color:#c8b7a5}.swap b{font-family:Arial;color:#7fb3ab;font-size:22px}.swap .new{color:#8ff0b4}.list li{position:relative;font-size:26px;line-height:1.55;padding:14px 0 14px 42px;color:#e6f2ef}.list li:before{content:'✓';position:absolute;left:4px;color:#7fd1c0;font-size:22px}.foot{position:absolute;left:78px;bottom:44px;font:14px monospace;color:#7f9d99;letter-spacing:2px}@keyframes rise{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}@keyframes grow{from{width:0}}</style></head><body><div class="grid"></div><div class="glow"></div><div class="head"><span>ESSAY REVIEW / ${String(index + 1).padStart(2, '0')}</span><span class="dots">${dots}</span></div><div class="card">${body}</div><div class="foot">WriteRight · AI 作文批改讲解 · 第 ${index + 1} / ${count} 幕</div></body></html>`;
}
function essayGenerate(stage, essay, project) {
  const plan = essayPlan(essay);
  if (stage === 'script') return { script: textValue(plan.map((s, i) => `【第 ${i + 1} 幕 · ${s.title}】\n${s.narration}`).join('\n\n'), '脚本') };
  if (stage === 'outline') return { outline: plan.map(s => ({ title: textValue(s.title, '大纲标题', 60), summary: textValue(s.narration, '大纲内容', 1500) })) };
  if (stage === 'scenes') return { scenes: plan.map(s => ({ id: randomUUID(), title: textValue(s.title, '分镜标题', 60), narration: textValue(s.narration, '旁白', 400), visualPrompt: textValue(s.card, '画面内容', 2000), duration: Math.max(3, Math.min(60, Number(s.duration) || 10)), visual: null, audio: null })) };
  if (stage === 'visuals') return { visuals: project.scenes.map((scene, i) => ({ kind: 'html', html: demoEssayHtml(scene, i, project.scenes.length), source: '作文讲解模板' })) };
  throw new Problem(400, '该步骤不是生成任务');
}
export function createProvider(assetRoot, config = {}) {
  const provider = config.provider || 'demo';
  async function asset(buffer, ext) {
    await mkdir(assetRoot, { recursive: true }); const name = randomUUID() + '.' + ext;
    await writeFile(join(assetRoot, name), buffer); return '/assets/' + name;
  }
  async function gateway(stage, project) {
    requireValue(config.url, '请在 .env 配置 AI_GATEWAY_URL 后重启服务', 503);
    const endpoint = new URL(config.url);
    requireValue(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)), '生成网关必须使用 HTTPS（本机服务可使用 HTTP）', 503);
    let response;
    try { response = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json', ...(config.key ? { Authorization:'Bearer ' + config.key } : {}) },
      body:JSON.stringify({ stage, mode:project.mode, prompt:project.prompt, script:project.script, outline:project.outline,
        scenes:project.scenes.map(({id,title,narration,visualPrompt,duration})=>({id,title,narration,visualPrompt,duration})) }), signal:AbortSignal.timeout(120000) }); }
    catch { throw new Problem(502, '无法连接生成网关或请求超时，请检查服务配置后重试'); }
    requireValue(response.ok, `生成网关返回 HTTP ${response.status}`, 502);
    const chunks=[]; let bytes=0;
    for await (const chunk of response.body) { bytes+=chunk.length; requireValue(bytes<=45*1024*1024,'生成网关响应超过 45 MB',502); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Problem(502,'生成网关未返回有效 JSON'); }
  }
  async function generate(stage, project) {
    const essay = essayInput(project);
    if (essay && stage !== 'audio') return essayGenerate(stage, essay, project);
    const remote = provider === 'gateway' ? await gateway(stage, project) : null;
    if (stage === 'script') {
      const subject = project.prompt.replace(/^(请|帮我|制作|生成|一支|一个|一款)+/g, '').slice(0,60);
      return { script:textValue(remote ? remote.script : `【开场】关于${subject}，我们从一个值得关注的瞬间开始。\n\n【展开】走近${subject}，观察它的细节，发现平常容易忽略的美好。\n\n【核心】好的故事不只是被看见，更能让人产生共鸣。让这一刻成为记忆的一部分。\n\n【收束】这就是${subject}。带着新的发现，开启下一段旅程。`, '脚本') };
    }
    if (stage === 'outline') {
      const paragraphs = project.script.split(/\n\s*\n|\n/).map(s=>s.trim()).filter(Boolean);
      const outline = remote ? remote.outline : paragraphs.map((p,i)=>({title:['引入主题','展开叙事','核心表达','留下回响'][i%4],summary:p}));
      requireValue(Array.isArray(outline)&&outline.length>=1&&outline.length<=12,'大纲必须包含 1–12 个章节',502);
      return { outline:outline.map(o=>({title:textValue(o.title,'大纲标题',60),summary:textValue(o.summary,'大纲内容',1500)})) };
    }
    if (stage === 'scenes') {
      const scenes = remote ? remote.scenes : project.outline.map((o,i)=>({title:o.title,narration:o.summary.replace(/【[^】]*】/g,''),visualPrompt:`${o.title}；${o.summary.slice(0,70)}；${project.mode==='html'?'动态排版、柔和形状、渐进出现':'电影感构图、自然光、低饱和色彩'}`,duration:8}));
      requireValue(Array.isArray(scenes)&&scenes.length>0&&scenes.length<=12,'分镜数量必须为 1–12 个',502);
      return { scenes:scenes.map(s=>({id:randomUUID(),title:textValue(s.title,'分镜标题',60),narration:textValue(s.narration,'旁白',400),visualPrompt:textValue(s.visualPrompt,'画面描述',2000),duration:Math.max(3,Math.min(60,Number(s.duration)||8)),visual:null,audio:null})) };
    }
    if (stage === 'visuals') {
      if (remote) requireValue(Array.isArray(remote.visuals)&&remote.visuals.length===project.scenes.length,'画面数量与分镜不一致',502);
      const visuals=[];
      for (let i=0;i<project.scenes.length;i++) {
        if(project.mode==='html') {
          const html = textValue(remote ? remote.visuals[i].html : demoHtml(project.scenes[i],i),'HTML 动画',150000);
          visuals.push({kind:'html',html,source:provider});
        } else if (remote) {
          const v=remote.visuals[i]; requireValue(['image/png','image/jpeg','image/webp'].includes(v.mime),'图片仅支持 PNG、JPEG、WebP',502);
          requireValue(typeof v.base64==='string'&&v.base64.length<15*1024*1024,'图片内容无效或过大',502);
          const b=Buffer.from(v.base64,'base64');
          const valid=v.mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):v.mime==='image/jpeg'?b[0]===255&&b[1]===216:b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
          requireValue(valid,'图片格式与内容不匹配',502);
          visuals.push({kind:'image',url:await asset(b,{'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[v.mime]),source:provider});
        } else visuals.push({kind:'image',url:await asset(demoImage(project.scenes[i],i),'svg'),source:'demo'});
      }
      return { visuals };
    }
    if (stage === 'audio') {
      if(remote) requireValue(Array.isArray(remote.audio)&&remote.audio.length===project.scenes.length,'声音数量与分镜不一致',502);
      const audio=[];
      let silentFallback=false;
      for (let i=0;i<project.scenes.length;i++) {
        let b;
        if(remote) { requireValue(typeof remote.audio[i].base64==='string'&&remote.audio[i].base64.length<12*1024*1024,'WAV 声音数据无效',502); b=Buffer.from(remote.audio[i].base64,'base64'); }
        else if(process.platform==='win32') {
          await mkdir(assetRoot,{recursive:true});
          const stem=join(assetRoot,randomUUID()),input=stem+'.json',output=stem+'.wav';
          await writeFile(input,JSON.stringify({text:project.scenes[i].narration,language:project.language||'zh'}));
          try { await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(here,'speech.ps1'),'-InputPath',input,'-OutputPath',output],{windowsHide:true,timeout:60000}); b=await readFile(output); }
          catch { throw new Problem(503,'本地语音合成失败，请安装 Windows 中文语音或配置生成网关'); }
          finally { await unlink(input).catch(()=>{}); await unlink(output).catch(()=>{}); }
        }
        else {
          // 非 Windows 服务器（Linux 容器 / 云主机）没有本地中文语音：
          // 生成与分镜等长的静音音轨，让「配音 → 预览 → 录屏导出」整条流程仍能完整跑通，
          // 画面、字幕、背景配乐、时长全部正常；配置 AI_PROVIDER=gateway 后可换成真人配音。
          silentFallback=true;
          b=silentWav(Math.max(1,Math.min(60,(Number(project.scenes[i].duration)||8)-0.5)));
        }
        const seconds=wavDuration(b); audio.push({url:await asset(b,'wav'),seconds,source:remote?'gateway':(silentFallback?'silent':'Windows SAPI')});
      }
      const total=audio.reduce((sum,a,i)=>sum+Math.max(project.scenes[i].duration,a.seconds+.5),0);
      return {audio,music:project.musicStyle==='none'?null:{url:await asset(makeMusic(total,project.musicStyle),'wav'),style:project.musicStyle,source:'本地合成配乐'}};
    }
    throw new Problem(400,'该步骤不是生成任务');
  }
  return {generate,asset,kind:provider};
}
