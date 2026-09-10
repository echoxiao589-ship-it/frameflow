const $ = id => document.getElementById(id);
const STEPS = ['script','outline','scenes','visuals','audio','review','export'];
const LABELS = ['生成脚本','生成大纲','拆分分镜','生成分镜画面','生成分镜声音','预览与修改','录屏输出'];
let project=null, projects=[], config=null, view=0, selected=0, busy=false, dirty=false, recording=false;
let playing=false, position=0, lastFrame=0, subtitles=true, images=[], frames=[], mediaKey='', preparedRevision=-1;
let audioContext, mix, musicGain, audioBuffers=[], musicBuffer=null, audioSources=[];
let recorder=null, capture=null, recordingComplete=false, recordProject=null, exportToken=null, recordedParts=[];
let confirmResolve, timer, pollTimer, loadingMedia=Promise.resolve();
const canvas=$('video'), ctx=canvas.getContext('2d');
const escapeText = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
const total = () => project?.scenes.reduce((n,s)=>n+s.duration,0)||0;
const firstPending = () => project ? STEPS.findIndex(s=>project.steps[s].status!=='completed') : 0;
const done = step => project?.steps[step].status==='completed';
function notify(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('toast').style.display='none',4500)}
function ask(title,message){$('dialogTitle').textContent=title;$('dialogMessage').textContent=message;$('confirmDialog').showModal();return new Promise(resolve=>confirmResolve=resolve)}
function closeDialog(value){$('confirmDialog').close();confirmResolve?.(value);confirmResolve=null}
function previewExport(url){if(recording||busy)return;$('exportPlayer').src=url;$('videoDialog').showModal()}
function closeExportPlayer(){$('exportPlayer').pause();$('videoDialog').close()}
$('videoDialog').addEventListener('close',()=>$('exportPlayer').pause());
$('confirmDialog').addEventListener('cancel',()=>closeDialog(false));
async function api(path, options={}) {
  const headers={'X-Frameflow-Client':'studio',...options.headers};
  if(options.body && !(options.body instanceof Blob)){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body)}
  let response;
  try {response=await fetch('/api'+path,{...options,headers})} catch {throw Error('无法连接后台，请检查服务是否正在运行')}
  const result=await response.json();if(!response.ok)throw Error(result.error||'请求失败');return result;
}
async function safely(action){try{await action()}catch(error){notify(error.message);$('stageError').hidden=false;$('stageError').textContent=error.message}}
async function refreshProjects(){projects=await api('/projects');renderProjects()}
function renderProjects(){
  if(project){const item=projects.find(p=>p.id===project.id);if(item)Object.assign(item,{title:project.title,steps:project.steps,revision:project.revision})}
  $('projects').innerHTML=projects.map(p=>`<div class="project ${p.id===project?.id?'active':''}" role="button" tabindex="0" onclick="openProject('${p.id}')" onkeydown="if(event.key==='Enter')openProject('${p.id}')"><span class="picon">${p.mode==='image'?'▧':'⌘'}</span><div><strong>${escapeText(p.title)}</strong><small>${p.mode==='image'?'图片轮播':'HTML 视频'} · ${Object.values(p.steps).filter(s=>s.status==='completed').length}/7</small></div></div>`).join('')||'<p class="hint">还没有项目，从首页新建一个。</p>';
  $('recentHome').innerHTML=projects.length?`<div class="recent-list">${projects.slice(0,5).map(p=>`<button onclick="openProject('${p.id}')">${escapeText(p.title)}<small>${p.mode==='image'?'图片轮播':'HTML 视频'} · 继续创作 ↗</small></button>`).join('')}</div>`:'';
}
async function canLeave(){if(recording||busy){notify('当前任务进行中，请完成后再操作');return false}if(dirty&&!await ask('离开编辑？','尚未保存的编辑将丢失。'))return false;dirty=false;return true}
function goHome(){safely(async()=>{if(!await canLeave())return;pause();document.body.classList.remove('edit');await refreshProjects()})}
function showHistory(){if(projects.length)openProject(projects[0].id);else notify('还没有项目，请先选择创作模式')}
function start(mode){safely(async()=>{if(!config)throw Error('后台尚未连接，请运行 start.cmd 后访问 http://127.0.0.1:4173');if(!await canLeave())return;const p=await api('/projects',{method:'POST',body:{mode}});await loadProject(p);await refreshProjects();$('prompt').focus()})}
function openProject(id){safely(async()=>{if(!await canLeave())return;await loadProject(await api('/projects/'+id))})}
async function loadProject(p){pause();project=p;position=0;selected=0;preparedRevision=-1;mediaKey='';view=Math.max(0,firstPending());if(view===-1)view=6;if(STEPS.every(s=>done(s)))view=6;document.body.classList.add('edit');$('prompt').value='';dirty=false;render();if(p.busy)watchJob()}
function render(){
  if(!project)return;
  $('modeBadge').textContent=project.mode==='image'?'图片轮播':'HTML 视频';$('projectTitle').textContent=project.title;
  $('projectMeta').textContent=`${project.scenes.length} 个分镜 · ${clock(total())} · 16:9 · 版本 ${project.revision}`;
  $('saveState').textContent=recording?'录制中…':(busy||project.busy)?'生成中…':dirty?'未保存':'已保存到后台';
  let next=firstPending();if(next<0)next=6;
  $('pipeline').innerHTML=STEPS.map((step,i)=>{const state=project.steps[step];return `<button class="${state.status==='completed'?'done':state.status} ${view===i?'active':''}" ${i>next||busy||recording?'disabled':''} onclick="chooseStep(${i})"><span class="circle">${state.status==='completed'?'✓':state.status==='failed'?'!':i+1}</span>${LABELS[i]}</button>`}).join('');
  $('stageNumber').textContent=`STEP 0${view+1} / 07`;$('stageTitle').textContent=LABELS[view];
  const state=project.steps[STEPS[view]];
  $('stageError').hidden=state.status!=='failed';$('stageError').textContent=state.error||'';
  $('nextBtn').hidden=view>=5;
  const target=state.status==='completed'?Math.min(view+1,5):view;
  $('nextBtn').textContent=(busy||project.busy)?'正在生成…':state.status==='failed'?'重试此步骤 ↻':target===5?'进入预览与修改 →':LABELS[target]+' →';
  $('nextBtn').disabled=busy||recording||project.busy;
  $('autoBtn').hidden=done('audio');$('autoBtn').disabled=busy||recording||project.busy;
  $('sendBtn').disabled=busy||recording||project.busy;
  $('prompt').disabled=busy||recording||project.busy;
  $('composerLabel').textContent=project.prompt?'修改创意会重新开始完整制作流程':'输入创意，开始生成脚本';
  const preview=view>=2;
  $('documentPanel').hidden=preview;$('previewPanel').hidden=!preview;
  if(!preview)renderDocument();else renderPreview();
  renderChat();renderProjects();renderControls();
  if(busy||recording||project.busy)document.querySelectorAll('#documentPanel input,#documentPanel textarea,#documentPanel button,#sceneEditor input,#sceneEditor textarea,#sceneEditor button').forEach(el=>el.disabled=true);
}
function chooseStep(i){safely(async()=>{if(!await canLeave())return;pause();view=i;render()})}
function renderDocument(){
  const panel=$('documentPanel');
  if(view===0&&!done('script')){panel.innerHTML=`<div class="start-empty"><div class="start-symbol">✦</div><h4>先把想法，写成一个故事。</h4><p>在右侧输入视频的主题、受众与风格。<br>系统先生成完整脚本，再从脚本提炼大纲。</p><div class="flow-note">脚本 → 大纲 → 分镜 → 画面 → 声音<br>每一步都依赖前一步的结果。</div></div>`;return}
  if(view===0){panel.innerHTML=`<h4>完整视频脚本</h4><p>先确定故事内容。修改脚本后，大纲及其后续内容需要重新生成。</p><textarea id="scriptEditor" aria-label="脚本内容" oninput="markDirty()" ${busy?'disabled':''}>${escapeText(project.script)}</textarea><div class="document-actions"><button onclick="regenerate('script')">重新生成</button><button class="primary" onclick="saveScript()">保存脚本</button></div>`;return}
  if(!done('outline')){panel.innerHTML=`<div class="start-empty"><div class="start-symbol">≡</div><h4>从脚本提炼叙事大纲</h4><p>脚本已准备好。点击上方按钮生成大纲，<br>再将大纲拆分为可制作的分镜。</p></div>`;return}
  panel.innerHTML=`<h4>叙事大纲 <span class="muted">/ ${project.outline.length} 章</span></h4><p>大纲基于已生成的脚本提炼，修改后将重新拆分分镜。</p>${project.outline.map((o,i)=>`<div class="outline-item"><label class="field">章节 ${i+1}<input data-outline-title value="${escapeText(o.title)}" maxlength="60" oninput="markDirty()"></label><label class="field">内容摘要<textarea data-outline-summary oninput="markDirty()">${escapeText(o.summary)}</textarea></label></div>`).join('')}<div class="document-actions"><button onclick="regenerate('outline')">重新生成</button><button class="primary" onclick="saveOutline()">保存大纲</button></div>`;
}
function markDirty(){dirty=true;$('saveState').textContent='未保存'}
function renderChat(){
  const generated=project.messages||[];
  const intro=`<div class="assistantLabel"><span class="mini">✦</span>帧序创作助手</div><div class="bubble">${project.prompt?'你的故事正在按制作流程推进。每一步完成后都可以检查结果。':'你好，先告诉我你想制作什么视频。我们将严格按照七个步骤完成作品。'}</div>`;
  const progress=`<div class="steps">${STEPS.map((s,i)=>`<div class="step"><span>${done(s)?'✓':project.steps[s].status==='running'?'◌':project.steps[s].status==='failed'?'!':'○'}</span>${LABELS[i]}${project.steps[s].status==='running'?' · 进行中':''}</div>`).join('')}</div>`;
  const source=`<div class="hint">${config?.provider==='demo'?'本地模式：脚本与画面使用模板；HTML 为真实网页动画，配音由 Windows 中文语音生成。':'网关模式：脚本、画面与声音通过已配置的生成服务制作。'}</div>`;
  $('chatlog').innerHTML=intro+progress+source+generated.slice(-12).map(m=>m.role==='user'?`<div class="bubble userbubble">${escapeText(m.text)}</div>`:`<div class="assistantLabel"><span class="mini">✦</span>制作进度</div><div class="bubble">${escapeText(m.text)}</div>`).join('');
  if(!project.prompt)$('chatlog').insertAdjacentHTML('beforeend','<div class="chips"><button onclick="fillPrompt(\'制作一支关于周末山野旅行的治愈短片\')">周末山野旅行</button><button onclick="fillPrompt(\'介绍一款让创作更简单的 AI 产品\')">AI 产品介绍</button></div>');
  $('chatlog').scrollTop=$('chatlog').scrollHeight;
}
function fillPrompt(text){$('prompt').value=text;$('prompt').focus()}
function renderPreview(){
  $('sceneCount').textContent='/ '+String(project.scenes.length).padStart(2,'0');
  $('previewLabel').textContent=project.mode==='html'?'HTML 网页动画预览':config?.provider==='demo'?'图片预览 · 本地示例插画':'分镜图片预览';
  $('previewEmpty').hidden=done('visuals');$('previewEmpty').textContent=busy?'正在制作，请稍候…':view===2&&!done('scenes')?'点击上方按钮，从大纲拆分分镜。':'完成分镜画面生成后，这里将呈现你的故事。';
  selected=Math.min(selected,Math.max(0,project.scenes.length-1));
  $('scenes').innerHTML=project.scenes.map((s,i)=>`<button class="scene ${selected===i?'selected':''}" onclick="selectScene(${i})" ${busy||recording?'disabled':''}><div class="thumb">${s.visual?.kind==='image'?`<img src="${s.visual.url}" alt="${escapeText(s.title)}">`:`<div class="html-icon">${s.visual?'✦ HTML MOTION':'待生成画面'}</div>`}<span class="num">${String(i+1).padStart(2,'0')}</span></div><strong>${escapeText(s.title)}</strong><small>${s.duration.toFixed(1)} 秒 · ${s.audio?'配音就绪':'待生成声音'}</small></button>`).join('');
  renderSceneEditor();
  $('reviewBox').hidden=view!==5||done('review');$('reviewCheck').checked=false;
  $('exportBtn').disabled=!done('review')||busy||project.busy;
  $('exportBtn').textContent=recording?'■ 取消录制':'↥ 录屏输出';
  $('musicStyle').value=project.musicStyle;$('musicStyle').disabled=busy||recording||!done('visuals');
  $('musicLabel').textContent=done('audio')?'旁白已生成 · '+(project.music?'配乐已就绪':'无背景音乐'):'声音待生成';
  $('exportPanel').innerHTML=(view===6?`<h4>录屏输出</h4><p class="small-copy">${project.mode==='html'?'HTML 动画使用浏览器标签页录屏。请选择当前标签页，录制时预览会铺满页面；支持区域裁剪的浏览器会自动裁剪到画面。':'图片轮播直接录制 1280 × 720 画布。'} 导出包含字幕、真实旁白及配乐。保持页面在前台，按 Esc 可取消；文件保存为浏览器支持的 WebM 或 MP4。</p><button class="primary" onclick="exportVideo()" ${recording||busy?'disabled':''}>开始录屏 · ${clock(total())}</button>`:'')+(project.exports.length?`<h4>已导出文件 <span class="muted">/ 历史版本</span></h4>`+project.exports.map(e=>`<div class="export-item">▣<span>${new Date(e.at).toLocaleString()} · ${(e.bytes/1024/1024).toFixed(1)} MB<br>项目版本 ${e.revision}</span><button onclick="previewExport(&apos;${e.url}&apos;)">播放</button><a href="${e.url}" download>下载 ↗</a></div>`).join(''):'');
  syncMedia();
}
function renderSceneEditor(){const s=project.scenes[selected];if(!s){$('sceneEditor').innerHTML='<p class="hint">分镜将在拆分完成后显示。</p>';return}
  $('sceneEditor').innerHTML=`<details ${view===2?'open':''}><summary>编辑第 ${selected+1} 幕 · ${escapeText(s.title)}</summary><div class="scene-fields"><label class="field">标题<input id="sceneTitle" maxlength="60" value="${escapeText(s.title)}" oninput="markDirty()"></label><label class="field">最短时长（秒）<input id="sceneDuration" type="number" min="3" max="60" step="0.5" value="${s.duration.toFixed(1)}" oninput="markDirty()"></label><label class="field wide">画面描述<textarea id="sceneVisual" oninput="markDirty()">${escapeText(s.visualPrompt)}</textarea></label><label class="field wide">旁白与字幕<textarea id="sceneNarration" maxlength="400" oninput="markDirty()">${escapeText(s.narration)}</textarea></label></div><div class="hint">为保持严格流程，修改分镜后需重新生成画面与声音。实际时长会自动适配配音长度。</div><div class="document-actions"><button class="primary" onclick="saveScene()" ${busy||recording?'disabled':''}>保存分镜</button></div></details><div class="document-actions">${done('scenes')?'<button onclick="regenerate(\'scenes\')">重新拆分分镜</button>':''}${done('visuals')?'<button onclick="regenerate(\'visuals\')">↶ 返回生成画面</button>':''}${done('audio')?'<button onclick="regenerate(\'audio\')">重新生成声音</button>':''}</div>`;
}
async function patch(data){if(recording||busy||project.busy)throw Error('任务进行中，暂时不能修改');pause();project=await api('/projects/'+project.id,{method:'PATCH',body:{revision:project.revision,...data}});dirty=false;preparedRevision=-1;await refreshProjects();render()}
function saveScript(){safely(async()=>{await patch({script:$('scriptEditor').value});notify('脚本已保存，大纲与后续步骤已重置')})}
function saveOutline(){safely(async()=>{const titles=[...document.querySelectorAll('[data-outline-title]')],summaries=[...document.querySelectorAll('[data-outline-summary]')];await patch({outline:titles.map((e,i)=>({title:e.value,summary:summaries[i].value}))});notify('大纲已保存，请重新拆分分镜')})}
function saveScene(){safely(async()=>{await patch({scene:{id:project.scenes[selected].id,title:$('sceneTitle').value,narration:$('sceneNarration').value,visualPrompt:$('sceneVisual').value,duration:Number($('sceneDuration').value)}});view=3;render();notify('分镜已保存，请依次重新生成画面和声音')})}
function changeMusic(style){safely(async()=>{if(dirty){$('musicStyle').value=project.musicStyle;throw Error('请先保存分镜修改')}await patch({musicStyle:style});view=4;render();notify('配乐设置已保存，请重新生成声音')})}
function sendPrompt(event){event.preventDefault();safely(async()=>{const prompt=$('prompt').value.trim();if(!prompt)throw Error('请先输入创作提示词');if(project.prompt&&!await ask('重新制作这个项目？','更新创意将重置脚本及全部后续步骤；已导出的历史文件会保留。'))return;await patch({prompt});$('prompt').value='';view=0;await runStage('script')})}
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('sendBtn').click()}});
async function ensureClean(){if(dirty)throw Error('请先保存当前编辑，再继续制作');if(recording||busy||project.busy)throw Error('当前任务仍在进行中')}
async function runStage(step){
  await ensureClean();if(step==='script'&&!project.prompt)throw Error('请先在右侧输入创作提示词');pause();busy=true;view=STEPS.indexOf(step);render();
  const id=project.id;
  const revision=project.revision;
  project.steps[step]={status:'running'};render();
  try{project=await api('/projects/'+id+'/run',{method:'POST',body:{stage:step,revision}});preparedRevision=-1;notify(LABELS[view]+'完成')}
  catch(error){project=await api('/projects/'+id);throw error}
  finally{busy=false;await refreshProjects();render()}
}
function nextAction(){safely(async()=>{await ensureClean();let target=done(STEPS[view])?view+1:view;if(target>=5){view=5;render();return}await runStage(STEPS[target])})}
function runAll(){safely(async()=>{await ensureClean();if(!project.prompt)throw Error('请先输入创意并生成脚本');for(let i=0;i<5;i++){if(!done(STEPS[i]))await runStage(STEPS[i])}view=5;render();notify('画面和声音已生成，请预览并确认')})}
function regenerate(step){safely(async()=>{await ensureClean();if(!await ask('重新'+LABELS[STEPS.indexOf(step)]+'？','本步骤和后续结果将重新制作，已有预览确认会失效。已导出文件保留。'))return;await runStage(step)})}
function confirmReview(){safely(async()=>{await ensureClean();if(!$('reviewCheck').checked)throw Error('请先勾选确认已检查预览');project=await api('/projects/'+project.id+'/review',{method:'POST',body:{revision:project.revision,confirmed:true}});view=6;render();notify('预览已确认，可以录屏输出')})}
function deleteProject(){safely(async()=>{await ensureClean();if(!await ask('删除当前项目？','项目记录将从列表移除，此操作不可撤销。已保存的媒体文件仍保留在服务器 data 目录。'))return;await api('/projects/'+project.id,{method:'DELETE',body:{revision:project.revision}});pause();project=null;document.body.classList.remove('edit');await refreshProjects();notify('项目已删除')})}
function watchJob(){clearInterval(pollTimer);pollTimer=setInterval(async()=>{try{if(!project||busy)return;const p=await api('/projects/'+project.id);project=p;if(!p.busy){clearInterval(pollTimer);render()}else{$('saveState').textContent='后台生成中…'}}catch{clearInterval(pollTimer)}},2000)}

// HTML is rendered in isolated documents; only this controller may run scripts.
function animationDocument(html){
  const doc=new DOMParser().parseFromString(html,'text/html');
  doc.querySelectorAll('script,iframe,object,embed,meta,base,link,form,foreignObject').forEach(n=>n.remove());
  doc.querySelectorAll('*').forEach(el=>{for(const a of [...el.attributes])if(/^on/i.test(a.name)||['srcdoc','action','formaction','href','xlink:href'].includes(a.name.toLowerCase()))el.removeAttribute(a.name)});
  const nonce=crypto.randomUUID().replaceAll('-','');
  const policy=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: ${location.origin}/assets/; media-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';`;
  const originalStyles=[...doc.querySelectorAll('style')].map(n=>n.outerHTML).join('');doc.querySelectorAll('style').forEach(n=>n.remove());
  const runner=`const stage=document.getElementById('stage');function size(){const s=Math.min(innerWidth/1280,innerHeight/720);stage.style.transform='translate(-50%,-50%) scale('+s+')'}addEventListener('resize',size);size();function seek(ms){document.getAnimations().forEach(a=>{a.pause();a.currentTime=ms})}seek(0);addEventListener('message',e=>{if(e.source!==parent||e.data.type!=='frameflow-clock')return;seek(e.data.time)});`;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}">${originalStyles}<style>html{width:100%;height:100%;overflow:hidden;background:#111}body{margin:0!important;width:100%;height:100%;overflow:hidden}#stage{position:absolute!important;left:50%!important;top:50%!important;width:1280px!important;height:720px!important;transform-origin:center!important;overflow:hidden!important}</style></head><body><div id="stage">${doc.body.innerHTML}</div><script nonce="${nonce}">${runner}</script></body></html>`;
}
function syncMedia(){
  const key=project.id+':'+project.scenes.map(s=>s.visual?.url||s.visual?.html||'').join('|');
  if(key===mediaKey)return;mediaKey=key;frames=[];images=[];$('htmlFrames').innerHTML='';
  $('htmlFrames').hidden=project.mode!=='html';canvas.hidden=project.mode==='html';$('subtitle').hidden=project.mode!=='html';
  const loads=[];
  project.scenes.forEach((s,i)=>{
    if(s.visual?.kind==='image'){const image=new Image();images[i]=image;loads.push(new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('分镜图片加载失败，请重新生成画面'));image.src=s.visual.url}))}
    if(s.visual?.kind==='html'){const iframe=document.createElement('iframe');iframe.title='分镜 '+(i+1)+' '+s.title;iframe.sandbox='allow-scripts';iframe.setAttribute('allow','');iframe.referrerPolicy='no-referrer';loads.push(new Promise(resolve=>iframe.onload=resolve));iframe.srcdoc=animationDocument(s.visual.html);$('htmlFrames').appendChild(iframe);frames[i]=iframe}
  });
  loadingMedia=Promise.all(loads);loadingMedia.catch(error=>notify(error.message));
}
function currentAt(time){let start=0;for(let i=0;i<(project?.scenes.length||0);i++){if(time<start+project.scenes[i].duration||i===project.scenes.length-1)return {index:i,local:Math.max(0,time-start),start};start+=project.scenes[i].duration}return {index:0,local:0,start:0}}
function draw(){if(!project||!done('visuals'))return;const at=currentAt(position),s=project.scenes[at.index];if(!s)return;
  if(project.mode==='html'){frames.forEach((f,i)=>{if(f){f.style.visibility=i===at.index?'visible':'hidden';if(i===at.index)f.contentWindow?.postMessage({type:'frameflow-clock',time:at.local*1000},'*')}});$('subtitle').innerHTML=subtitles?'<span>'+escapeText(s.narration)+'</span>':'';return}
  const image=images[at.index];ctx.fillStyle='#131817';ctx.fillRect(0,0,1280,720);
  if(image?.complete&&image.naturalWidth){const ratio=Math.max(1280/image.width,720/image.height)*(1+at.local/s.duration*.045),w=image.width*ratio,h=image.height*ratio;ctx.drawImage(image,(1280-w)/2,(720-h)/2,w,h)}
  if(subtitles){ctx.font='25px "Microsoft YaHei",sans-serif';ctx.textAlign='center';const lines=[''];for(const c of s.narration){if(ctx.measureText(lines.at(-1)+c).width>1110)lines.push(c);else lines[lines.length-1]+=c}lines.slice(0,5).forEach((line,i)=>{let y=680-(Math.min(lines.length,5)-1-i)*34,w=ctx.measureText(line).width;ctx.fillStyle='#000a';ctx.fillRect(640-w/2-14,y-26,w+28,35);ctx.fillStyle='#fff';ctx.fillText(line,640,y)})}
}
function renderControls(){$('playBtn').textContent=playing?'Ⅱ':'▶';$('playBtn').disabled=!done('visuals')||recording||busy;$('seek').max=total();$('seek').value=position;$('seek').disabled=!done('visuals')||recording||busy;$('time').textContent=clock(position)+' / '+clock(total())}
function stopAudio(){audioSources.forEach(source=>{try{source.stop()}catch{}});audioSources=[]}
function setupAudio(){if(audioContext)return;audioContext=new AudioContext();mix=audioContext.createMediaStreamDestination();musicGain=audioContext.createGain();musicGain.gain.value=.65;musicGain.connect(audioContext.destination);musicGain.connect(mix)}
async function prepareAudio(){setupAudio();await audioContext.resume();if(preparedRevision===project.revision)return;audioBuffers=[];musicBuffer=null;const decode=async url=>{const r=await fetch(url);if(!r.ok)throw Error('音频文件加载失败');return audioContext.decodeAudioData(await r.arrayBuffer())};if(done('audio')){audioBuffers=await Promise.all(project.scenes.map(s=>decode(s.audio.url)));if(project.music)musicBuffer=await decode(project.music.url)}preparedRevision=project.revision}
function scheduleAudio(){stopAudio();if(!done('audio'))return;let offset=0;project.scenes.forEach((s,i)=>{const buffer=audioBuffers[i];if(buffer&&position<offset+buffer.duration){const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioContext.destination);source.connect(mix);source.start(audioContext.currentTime+Math.max(0,offset-position),Math.max(0,position-offset));audioSources.push(source)}offset+=s.duration});if(musicBuffer&&position<musicBuffer.duration){const source=audioContext.createBufferSource();source.buffer=musicBuffer;source.connect(musicGain);source.start(0,position);audioSources.push(source)}}
function pause(){playing=false;stopAudio();renderControls()}
async function play(){if(!done('visuals'))throw Error('请先生成画面');await loadingMedia;await prepareAudio();if(position>=total())position=0;scheduleAudio();playing=true;lastFrame=performance.now();renderControls()}
function togglePlay(){safely(async()=>{if(recording||busy)return;if(playing)pause();else await play()})}
function selectScene(index){safely(async()=>{if(recording||busy)return;if(dirty)throw Error('请先保存当前分镜修改');pause();selected=index;position=project.scenes.slice(0,index).reduce((n,s)=>n+s.duration,0);renderPreview();renderControls();if(done('visuals'))await play()})}
$('seek').addEventListener('input',()=>{if(recording||busy)return;position=Number($('seek').value);if(playing)scheduleAudio();renderControls()});
function toggleSubs(){if(recording)return;subtitles=!subtitles;$('subBtn').classList.toggle('on',subtitles)}
function fullScreen(){safely(async()=>{if(!document.fullscreenElement)await $('screen').requestFullscreen();else await document.exitFullscreen()})}
function tick(now){const dt=lastFrame?(now-lastFrame)/1000:0;lastFrame=now;if(playing){position=Math.min(total(),position+dt);const index=currentAt(position).index;if(index!==selected&&!dirty){selected=index;document.querySelectorAll('.scene').forEach((el,i)=>el.classList.toggle('selected',i===selected));renderSceneEditor();if(recording)document.querySelectorAll('#sceneEditor input,#sceneEditor textarea,#sceneEditor button').forEach(el=>el.disabled=true)}if(position>=total()){playing=false;stopAudio();if(recording)stopRecording(true)}renderControls()}draw();requestAnimationFrame(tick)}requestAnimationFrame(tick);

async function exportVideo(){
  if(recording){stopRecording(false);return}
  let captured;
  try{
    await ensureClean();if(!done('review'))throw Error('请先完成预览确认');if(!window.MediaRecorder)throw Error('请使用支持 MediaRecorder 的新版 Chrome 或 Edge');
    pause();
    // Call the browser picker from the user gesture before waiting on the backend.
    const capturePromise=project.mode==='html'?navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser',frameRate:30},audio:false,preferCurrentTab:true,selfBrowserSurface:'include'}):null;
    busy=true;render();
    if(capturePromise)captured=await capturePromise;
    await loadingMedia;await prepareAudio();position=0;selected=0;draw();await new Promise(resolve=>requestAnimationFrame(()=>{draw();resolve()}));
    if(captured){capture=captured;const track=captured.getVideoTracks()[0];if(track.getSettings().displaySurface&&track.getSettings().displaySurface!=='browser')throw Error('请选择当前浏览器标签页，以确保仅录制视频页面');document.body.classList.add('capture-mode');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(window.CropTarget&&track.cropTo){try{const target=await CropTarget.fromElement($('screen'));await track.cropTo(target)}catch{/* Full-tab preview remains the fallback. */}}}
    else capture=canvas.captureStream(30);
    const ticket=await api('/projects/'+project.id+'/export/start',{method:'POST',body:{revision:project.revision}});project.revision=ticket.revision;exportToken=ticket.token;recordProject=project.id;
    const stream=new MediaStream([...capture.getVideoTracks(),...mix.stream.getAudioTracks()]);
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw Error('浏览器没有支持的录制编码');
    recordedParts=[];recordingComplete=false;recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000});
    recorder.ondataavailable=e=>{if(e.data.size)recordedParts.push(e.data)};
    recorder.onstop=()=>finishExport(mime);
    recorder.onerror=()=>{notify('浏览器录制失败');stopRecording(false)};
    capture.getVideoTracks()[0].onended=()=>{if(recording)stopRecording(false)};
    position=0;selected=0;draw();recording=true;busy=false;recorder.start(250);scheduleAudio();playing=true;lastFrame=performance.now();renderControls();$('saveState').textContent='录制中…';$('exportBtn').textContent='■ 取消录制';$('exportBtn').disabled=false;$('exportBtn').classList.add('record');
    if(project.mode==='image')notify('正在录制，请保持页面前台；按 Esc 取消');
  }catch(error){captured?.getTracks().forEach(t=>t.stop());capture?.getVideoTracks().forEach(t=>t.stop());capture=null;busy=false;recording=false;document.body.classList.remove('capture-mode');notify(error.name==='NotAllowedError'?'录屏选择已取消，未产生导出文件':error.message);render()}
}
function stopRecording(complete){recordingComplete=complete;playing=false;stopAudio();if(recorder?.state==='recording')recorder.stop()}
async function finishExport(mime){
  capture?.getVideoTracks().forEach(t=>{t.onended=null;t.stop()});capture=null;document.body.classList.remove('capture-mode');recording=false;busy=true;render();
  try{
    if(!recordingComplete){notify('录制已取消，未保存不完整视频');return}
    const blob=new Blob(recordedParts,{type:mime});if(!blob.size)throw Error('录制未产生有效视频');
    try{project=await api('/projects/'+recordProject+'/export',{method:'POST',headers:{'Content-Type':mime,'X-Export-Token':exportToken},body:blob});notify('视频已保存到后台，可下载文件');view=6;await refreshProjects()}
    catch(error){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Frameflow-unsaved.'+(mime.includes('mp4')?'mp4':'webm');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);throw Error(error.message+'；已尝试下载本地备份，后台导出状态未完成')}
  }catch(error){notify(error.message)}finally{busy=false;recordedParts=[];render();$('exportBtn').classList.remove('record')}
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&recording)stopRecording(false)});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(recording){stopRecording(false);notify('页面进入后台，录制已取消')}else pause()}});
window.addEventListener('beforeunload',event=>{if(recording||busy||dirty){event.preventDefault();event.returnValue=''}});
safely(async()=>{config=await api('/config');$('connection').textContent='后台已连接 · '+(config.provider==='demo'?'本地模式':'AI 网关');$('providerNote').textContent=config.provider==='demo'?'本地模板 + HTML 动画 + Windows 中文语音':'AI 生成网关已启用';$('providerSide').textContent=config.provider==='demo'?'本地模板 / Windows 中文语音':'AI 生成网关';$('agentMode').textContent=config.provider==='demo'?'本地模式':'AI 网关';$('chatHint').textContent=config.provider==='demo'?'本地模式不向外部服务发送创作内容。':'创作内容会发送至已配置的 AI 生成网关。';await refreshProjects()});
