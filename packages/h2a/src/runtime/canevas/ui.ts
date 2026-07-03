// Canevas ③ — self-hosted UI (served at GET / by the local Hono server, NOT a
// claude.ai Artifact: an Artifact cannot reach localhost/api). Self-contained:
// inline CSS + vanilla JS, no CDN. tranche-3b — the answer buttons are LIVE: they
// POST the human decision through the guarded reply-bridge, carrying the per-run
// write token injected same-origin at GET / (`__CANEVAS_TOKEN__`).

export const CANEVAS_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>h2a canevas — décisions</title>
<style>
  :root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#e6edf3;--muted:#8b949e;--accent:#3b82f6;--alert:#f85149;--decide:#d29922;--advise:#3fb950}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
  header{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
  header h1{font-size:15px;margin:0;font-weight:600}
  .count{color:var(--muted);font-size:13px}
  main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px;padding:16px 20px;height:calc(100vh - 52px)}
  .col{min-width:0;display:flex;flex-direction:column}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px}
  .chan{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:999px}
  .chan.alert{background:rgba(248,81,73,.15);color:var(--alert)}
  .chan.decide{background:rgba(210,153,34,.15);color:var(--decide)}
  .chan.advise{background:rgba(63,185,80,.15);color:var(--advise)}
  .q{font-size:18px;font-weight:600;margin:14px 0}
  .meta{color:var(--muted);font-size:12px;display:flex;flex-wrap:wrap;gap:12px}
  .nav{display:flex;align-items:center;gap:10px;margin-top:auto;padding-top:16px}
  button{font:inherit;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:8px 14px;cursor:pointer}
  button:hover:not(:disabled){border-color:var(--accent)}
  button:disabled{opacity:.5;cursor:not-allowed}
  .answers{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
  .answers button{border-color:var(--accent)}
  .answerStatus{margin-top:10px;font-size:13px;min-height:18px}
  .answerStatus.ok{color:var(--advise)}
  .answerStatus.err{color:var(--alert)}
  .pane{background:#010409;border:1px solid var(--border);border-radius:10px;padding:12px;overflow:auto;flex:1;display:flex;flex-direction:column}
  .pane .label{color:var(--muted);font-size:11px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
  .pane pre{margin:0;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;color:#c9d1d9}
  .empty{color:var(--muted);text-align:center;margin-top:40px}
</style>
</head>
<body>
<header>
  <h1>h2a canevas ③</h1>
  <span class="count" id="count">…</span>
  <span style="margin-left:auto;color:var(--muted);font-size:12px">← → pour naviguer</span>
</header>
<main>
  <section class="col">
    <div id="card" class="card"><div class="empty">Chargement…</div></div>
    <div class="nav">
      <button id="prev">← Précédent</button>
      <button id="next">Suivant →</button>
      <span class="count" id="pos"></span>
    </div>
    <div class="answerStatus" id="answerStatus" role="status" aria-live="polite"></div>
  </section>
  <section class="col">
    <div class="pane"><div class="label" id="paneLabel">Session CLI</div><pre id="pane">—</pre></div>
  </section>
</main>
<script>
(function(){
  // Per-run write token, injected same-origin at GET /. A cross-origin page can
  // neither read it nor (CORS-closed) reach /api — so only this page can POST.
  var TOKEN="__CANEVAS_TOKEN__";
  var decisions=[],idx=0,paneTimer=null;
  function esc(s){return String(s==null?"":s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}
  function setStatus(msg,ok){var s=document.getElementById("answerStatus");s.textContent=msg;s.className="answerStatus"+(msg?(ok?" ok":" err"):"")}
  async function answer(decisionId,answerId,btn){
    setStatus("Envoi de la réponse…",true);
    if(btn){btn.disabled=true}
    try{
      var r=await fetch("/api/decisions/"+encodeURIComponent(decisionId)+"/answer",{method:"POST",headers:{"content-type":"application/json","x-canevas-token":TOKEN},body:JSON.stringify({answerId:answerId})});
      var j={};try{j=await r.json()}catch(e){}
      if(r.ok){setStatus("✓ Réponse « "+answerId+" » transmise à l'agent.",true)}
      else{setStatus("✗ "+(j&&j.error?j.error:("échec ("+r.status+")")),false)}
    }catch(e){setStatus("✗ erreur réseau — réessayez.",false)}
    load();
  }
  async function load(){
    try{var r=await fetch("/api/decisions");var j=await r.json();decisions=(j.decisions||[])}catch(e){decisions=[]}
    if(idx>=decisions.length)idx=Math.max(0,decisions.length-1);
    render();
  }
  function render(){
    document.getElementById("count").textContent=decisions.length+" décision"+(decisions.length>1?"s":"")+" en attente";
    var card=document.getElementById("card");
    if(!decisions.length){card.innerHTML='<div class="empty">Aucune décision en attente 🎉</div>';document.getElementById("pos").textContent="";setPane(null);return}
    var d=decisions[idx];
    var opts=(d.options&&d.options.length)?d.options:[{id:"go",label:"Valider"},{id:"veto",label:"Refuser"},{id:"defer",label:"Différer"}];
    card.innerHTML=
      '<span class="chan '+esc(d.channel||"")+'">'+esc(d.channel||"décision")+'</span>'+
      '<div class="q">'+esc(d.question)+'</div>'+
      '<div class="meta"><span>agent: '+esc(d.instance)+'</span>'+(d.workspace?'<span>ws: '+esc(d.workspace)+'</span>':'')+(d.createdAt?'<span>'+esc(d.createdAt)+'</span>':'')+'</div>'+
      '<div class="answers">'+opts.map(function(o){return '<button class="ans" data-a="'+esc(o.id)+'">'+esc(o.label)+'</button>'}).join("")+'</div>';
    Array.prototype.forEach.call(card.querySelectorAll(".ans"),function(btn){
      btn.onclick=function(){answer(d.id,btn.getAttribute("data-a"),btn)};
    });
    document.getElementById("pos").textContent=(idx+1)+" / "+decisions.length;
    setPane(d.sessionRef&&d.sessionRef.tmuxName?d.sessionRef.tmuxName:null);
  }
  function setPane(tmuxName){
    if(paneTimer){clearInterval(paneTimer);paneTimer=null}
    var pre=document.getElementById("pane"),label=document.getElementById("paneLabel");
    if(!tmuxName){pre.textContent="— (pas de session tmux liée)";label.textContent="Session CLI";return}
    label.textContent="Session CLI · "+tmuxName;
    async function poll(){
      try{var r=await fetch("/api/sessions/"+encodeURIComponent(tmuxName)+"/pane?lines=200");var j=await r.json();
        pre.textContent=j.degraded?"(runtime indisponible — capturePane degraded)":(j.text||"(pane vide)")}catch(e){pre.textContent="(erreur de lecture du pane)"}
    }
    poll();paneTimer=setInterval(poll,2000);
  }
  function go(delta){if(!decisions.length)return;idx=(idx+delta+decisions.length)%decisions.length;render()}
  document.getElementById("prev").onclick=function(){go(-1)};
  document.getElementById("next").onclick=function(){go(1)};
  document.addEventListener("keydown",function(e){if(e.key==="ArrowLeft")go(-1);else if(e.key==="ArrowRight")go(1)});
  load();setInterval(load,5000);
})();
</script>
</body>
</html>`;
