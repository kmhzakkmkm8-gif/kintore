// ブラウザ連携ページ（アプリが http://localhost:PORT/ で配信）
#include "BrowserBridge.h"

namespace ul {

const char* const companionPageHtml = R"HTML(<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UTAWAKU LIVE 連携</title>
<style>
:root{color-scheme:dark;--a:#ff4f8b;--b:#5ad1ff;--m:#8b93a7}
body{margin:0;background:#0f1115;color:#e8eaf0;font:14px/1.6 system-ui,"Hiragino Sans","Yu Gothic UI",sans-serif;display:grid;place-items:center;min-height:100vh}
main{width:min(560px,92vw);background:#171a21;border:1px solid #2a2f3a;border-radius:14px;padding:24px}
h1{margin:0 0 4px;font-size:18px;letter-spacing:.08em}h1 b{color:var(--a)}
p{color:var(--m);margin:6px 0}
button{background:var(--a);color:#fff;border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;width:100%;margin:14px 0 8px}
button.stop{background:#2a2f3a}
.st{display:flex;gap:8px;align-items:center;margin:6px 0}.dot{width:10px;height:10px;border-radius:50%;background:#2a2f3a}
.on{background:#3ddc97;box-shadow:0 0 8px #3ddc97}.err{background:#ff5a5a}
canvas{width:100%;height:14px;background:#0a0b0e;border-radius:4px}
ol{color:var(--m);padding-left:20px}
</style></head><body><main>
<h1>UTAWAKU <b>LIVE</b> ブラウザ連携</h1>
<p>YouTube などのタブの音を、デスクトップアプリの「伴奏」に送ります。</p>
<button id="go">YouTube タブを取り込む</button>
<div class="st"><span class="dot" id="dApp"></span><span id="sApp">アプリに接続中…</span></div>
<div class="st"><span class="dot" id="dTab"></span><span id="sTab">タブ未選択</span></div>
<canvas id="meter" width="500" height="14"></canvas>
<ol>
<li>カラオケ動画を<strong>別のタブ</strong>で開いておく</li>
<li>上のボタン →「タブ」からそのタブを選び<strong>「タブの音声も共有する」をオン</strong></li>
<li>このページは開いたままにしておく（閉じると伴奏が止まります）</li>
</ol>
<p>タブ側のスピーカー再生は自動で止まり、アプリ経由でだけ聞こえます。画面全体の共有は選ばないでください（ハウリングします）。</p>
</main>
<script>
const $=s=>document.querySelector(s);
const workletSrc=`class Tap extends AudioWorkletProcessor{constructor(){super();this.f=480;this.b=new Float32Array(this.f*2);this.n=0;this.pk=0;this.t=0}
process(inputs){const i=inputs[0];if(i&&i.length){const L=i[0],R=i[1]||i[0];for(let k=0;k<L.length;k++){const l=L[k],r=R[k];this.b[this.n*2]=l;this.b[this.n*2+1]=r;
const a=Math.max(Math.abs(l),Math.abs(r));if(a>this.pk)this.pk=a;if(++this.n===this.f){this.port.postMessage(this.b.buffer,[this.b.buffer]);this.b=new Float32Array(this.f*2);this.n=0}}}
if(++this.t>=20){this.t=0;this.port.postMessage({peak:this.pk});this.pk=0}return true}}registerProcessor('ul-tap',Tap);`;
let ws=null,ctx=null,stream=null,label='',peak=0;
function connect(){
  ws=new WebSocket(`ws://${location.host}/audio`);ws.binaryType='arraybuffer';
  ws.onopen=()=>{$('#dApp').className='dot on';$('#sApp').textContent='アプリに接続しました';hello()};
  ws.onclose=()=>{$('#dApp').className='dot err';$('#sApp').textContent='アプリと切断（再接続します…）';setTimeout(connect,1000)};
}
function hello(){if(ws&&ws.readyState===1&&ctx)ws.send(JSON.stringify({sampleRate:ctx.sampleRate,channels:2,label}))}
async function start(){
  stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:1,width:{ideal:320},height:{ideal:180}},
    audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,suppressLocalAudioPlayback:true},
    preferCurrentTab:false,selfBrowserSurface:'exclude',surfaceSwitching:'include',systemAudio:'exclude',monitorTypeSurfaces:'exclude'});
  const at=stream.getAudioTracks()[0];
  if(!at){stream.getTracks().forEach(t=>t.stop());alert('音声が共有されていません。「タブ」を選び「タブの音声も共有する」をオンにしてください。');return}
  label=(stream.getVideoTracks()[0]||at).label||'タブ';
  ctx=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([workletSrc],{type:'text/javascript'})));
  const src=ctx.createMediaStreamSource(new MediaStream([at]));
  const tap=new AudioWorkletNode(ctx,'ul-tap',{channelCount:2,channelCountMode:'explicit'});
  const mute=ctx.createGain();mute.gain.value=0;
  src.connect(tap).connect(mute).connect(ctx.destination);
  tap.port.onmessage=e=>{if(e.data instanceof ArrayBuffer){if(ws&&ws.readyState===1&&ws.bufferedAmount<192000)ws.send(e.data)}else peak=Math.max(peak,e.data.peak)};
  hello();
  $('#dTab').className='dot on';$('#sTab').textContent='送信中: '+label;
  $('#go').textContent='共有を停止';$('#go').className='stop';
  at.onended=stop;
}
function stop(){if(stream)stream.getTracks().forEach(t=>t.stop());if(ctx)ctx.close();stream=null;ctx=null;
  $('#dTab').className='dot';$('#sTab').textContent='タブ未選択';$('#go').textContent='YouTube タブを取り込む';$('#go').className=''}
$('#go').onclick=()=>stream?stop():start().catch(e=>{if(e.name!=='NotAllowedError')alert(e.message)});
(function draw(){const c=$('#meter'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);
  const db=peak>1e-5?20*Math.log10(peak):-100,w=Math.max(0,Math.min(1,(db+60)/60))*c.width;
  g.fillStyle=db>-1?'#ff5a5a':'#3ddc97';g.fillRect(0,0,w,c.height);peak*=0.85;requestAnimationFrame(draw)})();
connect();
</script></body></html>)HTML";

} // namespace ul
