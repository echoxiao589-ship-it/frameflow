import { addWebmDuration } from '/media-utils.js';
const $=id=>document.getElementById(id),canvas=$('cartoon'),ctx=canvas.getContext('2d');
let lesson=null,selected=0,voice=null,voicePromise=null,state='idle',seconds=0,started=0,showChinese=true;
let demoAudio=new Audio(),takes=[],recorder=null,micStream=null,canvasStream=null,micContext=null,analyser=null,peak=0;
let generation=0,cancelled=false,clipSeconds=0,playlist=false,noticeTimer,animStarted=0,page='home';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const blocked=()=>['requesting','countdown','recording','saving','loading'].includes(state);
const line=()=>lesson?.lines[selected];
function notify(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('toast').style.display='none',5500)}
function setState(next){state=next;renderButtons()}
function renderButtons(){
  const frozen=blocked();$('listenBtn').disabled=frozen;$('watchBtn').disabled=frozen;$('nextBtn').disabled=frozen;$('speed').disabled=frozen;$('translationBtn').disabled=frozen;
  $('recordBtn').disabled=['requesting','countdown','saving','loading'].includes(state);
  $('recordBtn').innerHTML=state==='recording'?'■ 录好了，停止':state==='requesting'?'等待麦克风…':state==='countdown'?'准备好，马上开始':state==='saving'?'正在保存这句话…':'<span>●</span> '+(takes[selected]?'再配一次':'我来配音');
  $('recordBtn').classList.toggle('is-recording',state==='recording');
  $('listenBtn').innerHTML=state==='loading'?'正在准备英语示范…':state==='demo'?'<span>Ⅱ</span> 停止示范':'<span>♫</span> 听英语示范';
  $('playerState').textContent=({idle:'轮到你成为小主角啦',watch:'动画播放中',demo:'仔细听听 Coco 怎么说',loading:'正在准备英语示范',requesting:'请在浏览器里允许使用麦克风',countdown:'准备开口啦',recording:'Coco 正在用你的声音说话',saving:'正在保存你的配音',replay:'正在播放你的配音'})[state];
  $('micNote').textContent=state==='recording'?'读完就点停止；最多录制 12 秒。':state==='requesting'?'浏览器可能弹出麦克风提示，按 Esc 可以取消。':'点击后允许使用麦克风，就可以开始啦。';
  document.querySelectorAll('.sentence-choice').forEach(b=>b.disabled=frozen);
}
function renderLesson(){if(!lesson)return;
  const s=line();$('sentenceNumber').textContent=`第 ${selected+1} 句 / 共 ${lesson.lines.length} 句`;$('englishLine').textContent=s.english;$('chineseLine').textContent=s.chinese;$('focusWord').textContent=s.word;$('wordMeaning').textContent=s.meaning;$('practiceTip').textContent=s.tip;
  $('sentenceStrip').innerHTML=lesson.lines.map((l,i)=>`<button class="sentence-choice ${i===selected?'selected':''}" onclick="selectLine(${i})" aria-pressed="${i===selected}"><span>0${i+1}</span><strong lang="en">${esc(l.english)}</strong><em>${takes[i]?'✓ 已经录过音':'等你来配音'}</em></button>`).join('');
  const count=takes.filter(Boolean).length;$('practiceProgress').textContent=`已练习 ${count} / ${lesson.lines.length} 句`;$('workCount').textContent=count;$('takePanel').hidden=!takes[selected];
  $('nextBtn').textContent=selected===lesson.lines.length-1?'去听我的作品 →':'练习下一句 →';
  $('encouragement').textContent=takes[selected]?'你为 Coco 加上了自己的声音，试着听一听吧！':'不着急，先听清楚，再勇敢开口。';
  renderButtons();draw();
}
function stopPlayback(){demoAudio.pause();demoAudio.currentTime=0;$('myVideo').pause();$('myVideo').hidden=true;playlist=false;seconds=0;if(!blocked())setState('idle')}
function showPage(name){page=name;$('courseHome').hidden=name!=='home';$('lessonPage').hidden=name!=='lesson';$('workPage').hidden=name!=='work';$('learnNav').classList.toggle('nav-active',name!=='work');window.scrollTo({top:0,behavior:'instant'})}
function backToCourses(){if(blocked()){notify('先录完这一句吧，按 Esc 可以取消。');return}stopPlayback();showPage('home')}
async function openLesson(){if(blocked())return;if(!lesson){notify('课程还在加载，请稍等。');return}stopPlayback();showPage('lesson');renderLesson()}
function selectLine(index){if(blocked())return;stopPlayback();selected=index;renderLesson()}
function nextSentence(){if(blocked())return;if(selected===lesson.lines.length-1)showMyWork();else selectLine(selected+1)}
function toggleTranslation(){if(blocked())return;showChinese=!showChinese;$('translationBtn').textContent=showChinese?'中英字幕 ✓':'只看英文';$('translationBtn').setAttribute('aria-pressed',showChinese);draw()}
function watchAnimation(){if(blocked())return;if(state==='watch'){stopPlayback();return}stopPlayback();animStarted=performance.now();seconds=0;setState('watch')}
async function getVoice(){if(voice)return voice;if(!voicePromise)voicePromise=fetch('/api/english/lessons/'+lesson.id+'/voice',{method:'POST',headers:{'X-Frameflow-Client':'studio'}}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error);voice=value;return value}).finally(()=>voicePromise=null);return voicePromise}
async function listenDemo(){
  if(blocked())return;if(state==='demo'){stopPlayback();return}stopPlayback();const token=++generation;setState('loading');
  try{const result=await getVoice();if(token!==generation)return;demoAudio.src=result.lines[selected].url;demoAudio.playbackRate=Number($('speed').value);await demoAudio.play();if(token!==generation){demoAudio.pause();return}setState('demo')}
  catch{if(token!==generation)return;notify('英语示范暂时没有准备好。请让大人检查网站服务，然后再点一次。');setState('idle')}
}
demoAudio.addEventListener('ended',()=>{seconds=0;setState('idle')});
demoAudio.addEventListener('error',()=>{if(state==='demo'){setState('idle');notify('这段示范没有播放成功，请再试一次。')}});
function releaseMic(){micStream?.getTracks().forEach(t=>t.stop());canvasStream?.getTracks().forEach(t=>t.stop());micStream=null;canvasStream=null;micContext?.close().catch(()=>{});micContext=null;analyser=null}
function cancelRecording(){
  generation++;cancelled=true;$('countdown').hidden=true;$('recordFlag').hidden=true;
  if(recorder?.state==='recording'){recorder.stop();return}releaseMic();setState('idle');notify('这次录音已取消，之前的配音还在。');
}
async function recordVoice(){
  if(state==='recording'){finishRecording();return}if(blocked())return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder||!canvas.captureStream){notify('这个浏览器暂时不能录音，请用新版 Chrome 或 Edge 打开本地网站。');return}
  stopPlayback();const token=++generation,recordIndex=selected;cancelled=false;setState('requesting');
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    if(token!==generation){stream.getTracks().forEach(t=>t.stop());return}micStream=stream;
    micContext=new AudioContext();await micContext.resume();analyser=micContext.createAnalyser();analyser.fftSize=256;micContext.createMediaStreamSource(stream).connect(analyser);peak=0;
    setState('countdown');$('countdown').hidden=false;
    for(let i=3;i>=1;i--){$('countdown').textContent=i;await new Promise(r=>setTimeout(r,1000));if(token!==generation)return}
    $('countdown').hidden=true;seconds=0;draw();
    canvasStream=canvas.captureStream(30);
    const mixed=new MediaStream([...canvasStream.getVideoTracks(),...stream.getAudioTracks()]);
    const mime=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime)throw Error('format');
    const chunks=[];recorder=new MediaRecorder(mixed,{mimeType:mime,videoBitsPerSecond:1800000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    recorder.onerror=()=>{cancelled=true;notify('录音出了点小问题，再试一次吧。');if(recorder.state==='recording')recorder.stop();else{releaseMic();setState('idle')}};
    recorder.onstop=async()=>{
      releaseMic();$('recordFlag').hidden=true;$('countdown').hidden=true;
      if(cancelled){setState('idle');notify('这次录音已取消，之前的配音还在。');return}
      setState('saving');
      try{
        if(clipSeconds<.8||!chunks.length){notify('时间有点短，试着把整句话读出来吧。');return}
        const blob=await addWebmDuration(new Blob(chunks,{type:mime}),clipSeconds);
        if(takes[recordIndex])URL.revokeObjectURL(takes[recordIndex].url);
        takes[recordIndex]={blob,url:URL.createObjectURL(blob),seconds:clipSeconds,downloaded:false};
        notify(peak<.005?'已经录好啦。声音可能有些轻，先听一听，需要时可以再录一次。':'录好啦！点击“听我的配音”，看看你的作品。');
      }catch{notify('这次配音没有保存成功，请再录一次。')}
      finally{seconds=0;setState('idle');renderLesson()}
    };
    started=performance.now();recorder.start(200);setState('recording');$('recordFlag').hidden=false;
    stream.getAudioTracks()[0].onended=()=>{if(state==='recording')cancelRecording()};
  }catch(error){if(token!==generation)return;releaseMic();$('countdown').hidden=true;setState('idle');
    const message=error.name==='NotAllowedError'?'麦克风还没有打开。请让大人帮忙允许这个网站使用麦克风。':error.name==='NotFoundError'?'没有找到麦克风，请让大人检查设备。':'暂时不能录音，请检查麦克风后再试一次。';notify(message)
  }
}
function finishRecording(){if(state!=='recording')return;clipSeconds=(performance.now()-started)/1000;setState('saving');$('recordFlag').hidden=true;if(recorder?.state==='recording')recorder.stop()}
async function replayTake(index=selected){if(blocked())return;const take=takes[index];if(!take){notify('先给这一句录个音吧。');return}stopPlayback();selected=index;showPage('lesson');renderLesson();$('myVideo').src=take.url;$('myVideo').hidden=false;
  try{await $('myVideo').play();setState('replay')}catch{setState('idle');$('myVideo').hidden=true;notify('这段配音没有播放成功，可以先保存到电脑上听一听。')}
}
$('myVideo').addEventListener('ended',()=>{setState('idle');$('playerState').textContent='这就是你的声音，真有趣！'});
function downloadTake(index=selected){const take=takes[index];if(!take||blocked())return;const a=document.createElement('a');a.href=take.url;a.download=`Little-Voice-Coco-${index+1}.${take.blob.type.includes('mp4')?'mp4':'webm'}`;a.click();notify('配音视频已开始下载，请检查浏览器的下载列表。')}
function showMyWork(){if(blocked()){notify('先录完这一句吧。');return}stopPlayback();showPage('work');
  const count=takes.filter(Boolean).length;
  $('workList').innerHTML=count?lesson.lines.map((l,i)=>takes[i]?`<article class="work-item"><span>🐱</span><div><h3 lang="en">${esc(l.english)}</h3><p>动物朋友 · 第 ${i+1} 句 · ${takes[i].seconds.toFixed(1)} 秒</p></div><button onclick="replayTake(${i})">▷ 播放作品</button><button class="primary" onclick="downloadTake(${i})">↓ 保存视频</button></article>`:'').join(''):'<div class="empty-work"><strong>♫</strong><p>这里等着收藏你的第一段配音。</p><button class="primary" onclick="openLesson()">去给 Coco 配音 →</button></div>';
}

function ellipse(x,y,rx,ry,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill()}
function path(points,fill){ctx.fillStyle=fill;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill()}
function draw(){
  if(!lesson)return;const s=line(),moving=['watch','demo','recording'].includes(state),time=moving?seconds:0;
  ctx.fillStyle='#e7eddf';ctx.fillRect(0,0,1280,720);ellipse(1020,148,72,72,'#f8e9b4');
  ctx.fillStyle='#d2dfc7';ctx.beginPath();ctx.moveTo(0,390);ctx.bezierCurveTo(220,210,520,310,690,415);ctx.bezierCurveTo(910,230,1130,290,1280,330);ctx.lineTo(1280,720);ctx.lineTo(0,720);ctx.fill();
  ctx.fillStyle='#c2d5b7';ctx.beginPath();ctx.moveTo(0,495);ctx.bezierCurveTo(340,380,740,550,1280,410);ctx.lineTo(1280,720);ctx.lineTo(0,720);ctx.fill();
  ellipse(144,502,55,43,'#a5be9c');ellipse(209,497,72,58,'#acc49f');ellipse(1150,488,72,63,'#a9c098');
  [90,340,990,1160].forEach((x,i)=>{ctx.fillStyle='#92ad87';ctx.fillRect(x,555-i%2*10,4,35);ellipse(x+2,555-i%2*10,9,9,'#f8f0ca');ellipse(x+2,555-i%2*10,4,4,'#dab76b')});
  const bounce=moving?Math.sin(time*2.5)*7:0;
  ctx.save();ctx.translate(640,325+bounce);ellipse(0,195,145,20,'#99b18c55');
  ctx.strokeStyle='#d9a269';ctx.lineWidth=32;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(98,130);ctx.quadraticCurveTo(230,155,170,65+Math.sin(time*2)*10);ctx.stroke();
  ellipse(0,115,98,112,'#edb77c');ellipse(0,142,60,60,'#f7d8ab');ellipse(-54,205,49,22,'#f0c18a');ellipse(54,205,49,22,'#f0c18a');
  path([[-111,-49],[-108,-157],[-30,-88]],'#efbd83');path([[111,-49],[108,-157],[30,-88]],'#efbd83');path([[-89,-65],[-86,-128],[-47,-82]],'#dfa18d');path([[89,-65],[86,-128],[47,-82]],'#dfa18d');ellipse(0,-20,124,101,'#f3c58f');
  ellipse(-44,-31,9,14,'#5c4b44');ellipse(44,-31,9,14,'#5c4b44');ellipse(-67,2,17,9,'#eaa49577');ellipse(67,2,17,9,'#eaa49577');ellipse(0,-4,11,7,'#b5786d');
  ctx.strokeStyle='#755c4b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,1);ctx.lineTo(0,12);ctx.quadraticCurveTo(-12,27,-22,12);ctx.moveTo(0,12);ctx.quadraticCurveTo(12,27,22,12);ctx.stroke();
  if(moving&&Math.sin(time*9)>.1)ellipse(0,24,11,6+Math.sin(time*9)*4,'#bc8170');
  ctx.strokeStyle='#b5916d';ctx.lineWidth=2;[-1,1].forEach(side=>{ctx.beginPath();ctx.moveTo(side*83,8);ctx.lineTo(side*136,0);ctx.moveTo(side*83,22);ctx.lineTo(side*139,27);ctx.stroke()});
  ctx.save();ctx.translate(-84,90);ctx.rotate(s.action==='wave'&&moving?-.55+Math.sin(time*5)*.3:.2);ellipse(0,-18,24,46,'#f7ce9d');ctx.restore();ellipse(86,105,22,42,'#f7ce9d');ctx.restore();
  if(s.action==='fish'){ctx.save();ctx.translate(952,340+Math.sin(time*2)*9);ellipse(0,0,70,31,'#90b9bb');path([[52,0],[102,-42],[102,42]],'#7ca8ae');ellipse(-33,-8,4,4,'#4c7279');ctx.restore()}
  if(s.action==='play'){const x=970+Math.sin(time*2)*40,y=490-Math.abs(Math.sin(time*2))*70;ellipse(x,y,42,42,'#bba3d8');ctx.strokeStyle='#e9dff6';ctx.lineWidth=5;ctx.beginPath();ctx.arc(x,y,25,-1,2);ctx.stroke()}
  ctx.textAlign='left';ctx.font='15px Arial';ctx.fillStyle='#80947a';ctx.fillText('COCO & FRIENDS',45,50);ctx.textAlign='right';ctx.fillText(`0${selected+1} / 03`,1235,50);
  ctx.fillStyle='#fffcf0ed';ctx.beginPath();ctx.roundRect(180,589,920,showChinese?107:79,20);ctx.fill();ctx.textAlign='center';ctx.fillStyle='#675646';ctx.font='600 39px Arial';ctx.fillText(s.english,640,638);if(showChinese){ctx.font='22px "Microsoft YaHei",sans-serif';ctx.fillStyle='#a3917d';ctx.fillText(s.chinese,640,677)}
}
function tick(now){if(state==='watch'){seconds=(now-animStarted)/1000;if(seconds>6){seconds=0;setState('idle')}}if(state==='demo')seconds=demoAudio.currentTime;if(state==='recording'){seconds=(now-started)/1000;$('recordTime').textContent='00:'+String(Math.floor(seconds)).padStart(2,'0');if(analyser){const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);peak=Math.max(peak,Math.sqrt(values.reduce((n,v)=>n+v*v,0)/values.length))}if(seconds>=12)finishRecording()}if(page==='lesson')draw();requestAnimationFrame(tick)}requestAnimationFrame(tick);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(['requesting','countdown','recording'].includes(state))cancelRecording();else if(state==='loading'){generation++;setState('idle')}else stopPlayback()}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(['requesting','countdown','recording'].includes(state))cancelRecording();else if(state!=='saving'){generation++;stopPlayback();setState('idle')}}});
window.addEventListener('beforeunload',e=>{if(takes.some(Boolean)||blocked()){e.preventDefault();e.returnValue=''}});
Object.assign(window,{backToCourses,openLesson,selectLine,nextSentence,toggleTranslation,watchAnimation,listenDemo,recordVoice,replayTake,downloadTake,showMyWork});
fetch('/api/english/lessons').then(async r=>{if(!r.ok)throw Error();const list=await r.json();lesson=list[0];if(!lesson)throw Error();takes=lesson.lines.map(()=>null);renderLesson()}).catch(()=>{notify('课程没有加载成功，请让大人确认网站已经启动，再刷新一次。');$('heroStart').disabled=true;$('lessonCard').disabled=true});
