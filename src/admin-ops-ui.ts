export const ADMIN_OPS_HTML = String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="theme-color" content="#100d14" />
  <title>NightMatch 運営管理</title>
  <style>
    :root{color-scheme:dark;--bg:#100d14;--panel:#1b1620;--panel2:#241d2a;--line:#3a3044;--text:#f4eef6;--muted:#a99cb0;--gold:#e2b968;--danger:#e57d8b;--ok:#7dd2bb}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,textarea{font:inherit}button{cursor:pointer}.shell{max-width:1180px;margin:auto;padding:22px 16px 80px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.brand{font-size:24px;font-weight:800}.sub{color:var(--muted);font-size:12px;margin-top:4px}.link{color:var(--gold);text-decoration:none;font-size:13px}.tabs{display:flex;gap:8px;overflow:auto;margin-bottom:16px}.tab{border:1px solid var(--line);background:var(--panel);color:var(--muted);padding:10px 15px;border-radius:999px;white-space:nowrap}.tab.active{background:var(--gold);border-color:var(--gold);color:#171018;font-weight:700}.panel{display:none}.panel.active{display:block}.notice{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:12px 14px;color:var(--muted);font-size:12px;line-height:1.7;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.card{border:1px solid var(--line);background:var(--panel);border-radius:18px;padding:15px}.card button.cardbtn{width:100%;text-align:left;background:transparent;border:0;color:inherit;padding:0}.row{display:flex;gap:10px;align-items:center}.between{justify-content:space-between}.meta{color:var(--muted);font-size:12px;line-height:1.7}.badge{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:11px;color:var(--muted)}.badge.warn{color:var(--gold)}.badge.ok{color:var(--ok)}.detail{margin-top:14px;border:1px solid var(--line);background:var(--panel);border-radius:20px;padding:16px}.detail h2{margin:0 0 6px;font-size:20px}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:14px 0}.photo{border:1px solid var(--line);background:#09070b;border-radius:14px;overflow:hidden}.photo .label{padding:8px 10px;color:var(--muted);font-size:11px;border-bottom:1px solid var(--line)}.photo img{width:100%;aspect-ratio:4/3;object-fit:contain;display:block;background:#08060a}.form{display:grid;gap:10px;margin-top:12px}.input,.textarea{width:100%;border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:12px;padding:11px 12px}.textarea{min-height:80px;resize:vertical}.actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.btn{border:0;border-radius:12px;padding:11px 12px;background:var(--gold);color:#171018;font-weight:750}.btn.secondary{background:var(--panel2);color:var(--text);border:1px solid var(--line)}.btn.danger{background:var(--danger);color:#1b0a0d}.btn:disabled{opacity:.45;cursor:not-allowed}.empty{padding:30px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:16px}.chat-layout{display:grid;grid-template-columns:360px 1fr;gap:12px}.chat-list{display:grid;gap:8px;max-height:68vh;overflow:auto}.chat-item{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:12px;color:inherit;text-align:left}.chat-item.active{border-color:var(--gold)}.chatbox{border:1px solid var(--line);background:var(--panel);border-radius:18px;min-height:420px;display:flex;flex-direction:column;overflow:hidden}.chathead{padding:13px 14px;border-bottom:1px solid var(--line)}.messages{padding:14px;display:grid;gap:9px;overflow:auto;max-height:62vh}.msg{max-width:82%;border-radius:14px;padding:10px 12px;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word}.msg.worker{justify-self:start;background:#30263a}.msg.shop{justify-self:end;background:#3a3020}.msg .who{display:block;color:var(--muted);font-size:10px;margin-bottom:3px}.toast{position:fixed;right:16px;bottom:18px;max-width:360px;background:#2a2230;border:1px solid var(--line);border-radius:13px;padding:12px 14px;display:none;z-index:40}.toast.show{display:block}.toast.error{border-color:var(--danger)}
    @media(max-width:760px){.chat-layout{grid-template-columns:1fr}.chat-list{max-height:300px}.actions{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.detail{padding:13px}.images{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main class="shell">
  <header class="top">
    <div><div class="brand">NightMatch 運営管理</div><div class="sub">本人確認とチャット監査 / Cloudflare Access 保護</div></div>
    <a class="link" href="/admin">既存の店舗・請求管理へ →</a>
  </header>

  <nav class="tabs">
    <button class="tab active" data-tab="kyc">本人確認</button>
    <button class="tab" data-tab="chats">チャット</button>
  </nav>

  <section id="panel-kyc" class="panel active">
    <div class="notice">本人確認書類は承認・却下後にR2から削除します。閲覧操作は運営監査ログに記録されます。マイナンバーカードは表面のみを扱います。</div>
    <div id="kyc-list" class="grid"></div>
    <div id="kyc-detail"></div>
  </section>

  <section id="panel-chats" class="panel">
    <div class="notice">チャット本文は運営トラブル対応・安全管理のための読み取り専用です。誰がどの会話を閲覧したか監査ログに残します。</div>
    <div class="chat-layout">
      <div id="chat-list" class="chat-list"></div>
      <div id="chat-box" class="chatbox"><div class="empty" style="margin:auto">会話を選択してください</div></div>
    </div>
  </section>
</main>
<div id="toast" class="toast" role="status"></div>
<script>
(function(){
  'use strict';
  var kycRows=[];var activeDeal='';var toastTimer;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function toast(msg,error){var el=document.getElementById('toast');el.textContent=msg;el.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.className='toast';},3600);}
  async function api(path,opts){var res=await fetch(path,Object.assign({headers:{'content-type':'application/json'}},opts||{}));var body={};try{body=await res.json();}catch(e){}if(!res.ok){var err=new Error(body.error||('HTTP '+res.status));err.body=body;throw err;}return body;}

  document.querySelectorAll('.tab').forEach(function(tab){tab.addEventListener('click',function(){document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('active',t===tab);});document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});document.getElementById('panel-'+tab.dataset.tab).classList.add('active');if(tab.dataset.tab==='chats')loadChats();});});

  async function loadKyc(){var el=document.getElementById('kyc-list');el.innerHTML='<div class="empty">読み込み中…</div>';try{var d=await api('/admin/kyc/pending');kycRows=d.checks||[];if(!kycRows.length){el.innerHTML='<div class="empty">本人確認の審査待ちはありません</div>';document.getElementById('kyc-detail').innerHTML='';return;}el.innerHTML=kycRows.map(function(r){var doc=r.document_type==='mynumber'?'マイナンバーカード':'運転免許証';return '<article class="card"><button class="cardbtn" data-kyc="'+esc(r.id)+'"><div class="row between"><strong>'+esc(r.nickname)+'</strong><span class="badge warn">審査待ち</span></div><div class="meta" style="margin-top:8px">'+esc(doc)+'<br>自己申告生年月日: '+esc(r.birth_date)+'<br>提出: '+esc(r.checked_at)+'</div></button></article>';}).join('');}catch(e){el.innerHTML='<div class="empty">読み込みに失敗しました</div>';toast(e.message,true);}}

  function showKyc(id){var r=kycRows.find(function(x){return x.id===id;});if(!r)return;var doc=r.document_type==='mynumber'?'マイナンバーカード':'運転免許証';var back=r.document_type==='license'?'<div class="photo"><div class="label">運転免許証 裏面</div><img src="/admin/kyc/'+encodeURIComponent(id)+'/file/back" alt="運転免許証 裏面"></div>':'';document.getElementById('kyc-detail').innerHTML='<section class="detail"><div class="row between"><div><h2>'+esc(r.nickname)+' の本人確認</h2><div class="meta">'+esc(doc)+' / 自己申告: '+esc(r.birth_date)+'</div></div><span class="badge warn">要確認</span></div><div class="images"><div class="photo"><div class="label">本人確認書類 表面</div><img src="/admin/kyc/'+encodeURIComponent(id)+'/file/front" alt="本人確認書類 表面"></div>'+back+'<div class="photo"><div class="label">セルフィー</div><img src="/admin/kyc/'+encodeURIComponent(id)+'/file/selfie" alt="セルフィー"></div></div><div class="form"><label class="meta">書類に記載された生年月日<input id="kyc-birth" class="input" type="date" autocomplete="off"></label><label class="meta">運営メモ（任意）<textarea id="kyc-note" class="textarea" placeholder="顔写真一致、記載事項確認など"></textarea></label><div class="actions"><button class="btn" id="kyc-approve">確認して登録完了</button><button class="btn secondary" id="kyc-retry">再提出を依頼</button><button class="btn danger" id="kyc-block">利用不可として却下</button></div></div></section>';document.getElementById('kyc-approve').onclick=function(){approveKyc(id);};document.getElementById('kyc-retry').onclick=function(){rejectKyc(id,false);};document.getElementById('kyc-block').onclick=function(){rejectKyc(id,true);};document.getElementById('kyc-detail').scrollIntoView({behavior:'smooth',block:'start'});}

  async function approveKyc(id){var birth=document.getElementById('kyc-birth').value;var note=document.getElementById('kyc-note').value.trim();if(!birth){toast('書類に記載された生年月日を入力してください',true);return;}if(!confirm('身分証とセルフィーが同一人物で、年齢条件を満たすことを確認しましたか？'))return;try{await api('/admin/kyc/'+encodeURIComponent(id)+'/approve',{method:'POST',body:JSON.stringify({birthDate:birth,note:note})});toast('本人確認を承認し、登録を完了しました');await loadKyc();}catch(e){var b=e.body||{};if(b.error==='age_not_eligible')toast('年齢条件を満たしていません: '+String(b.reason||''),true);else toast(e.message,true);}}

  async function rejectKyc(id,block){var note=document.getElementById('kyc-note').value.trim();if(!note){toast('却下理由・再提出理由を運営メモに入力してください',true);return;}var text=block?'このアカウントを利用不可として却下しますか？':'本人確認を却下して再提出を依頼しますか？';if(!confirm(text))return;try{await api('/admin/kyc/'+encodeURIComponent(id)+'/reject',{method:'POST',body:JSON.stringify({note:note,block:block})});toast(block?'利用不可として却下しました':'再提出待ちにしました');await loadKyc();}catch(e){toast(e.message,true);}}

  document.getElementById('kyc-list').addEventListener('click',function(e){var b=e.target.closest('[data-kyc]');if(b)showKyc(b.dataset.kyc);});

  async function loadChats(){var el=document.getElementById('chat-list');el.innerHTML='<div class="empty">読み込み中…</div>';try{var d=await api('/admin/chats');var rows=d.conversations||[];if(!rows.length){el.innerHTML='<div class="empty">会話はありません</div>';return;}el.innerHTML=rows.map(function(r){return '<button class="chat-item '+(activeDeal===r.id?'active':'')+'" data-deal="'+esc(r.id)+'"><div class="row between"><strong>'+esc(r.shop_name)+'</strong><span class="badge">'+esc(r.stage)+'</span></div><div class="meta" style="margin-top:6px">'+esc(r.nickname)+' / '+esc(r.area)+' '+esc(r.business_type)+'<br>更新: '+esc(r.updated_at)+'</div></button>';}).join('');}catch(e){el.innerHTML='<div class="empty">読み込みに失敗しました</div>';toast(e.message,true);}}

  async function showChat(dealId){activeDeal=dealId;loadChats();var box=document.getElementById('chat-box');box.innerHTML='<div class="empty" style="margin:auto">読み込み中…</div>';try{var d=await api('/admin/chats/'+encodeURIComponent(dealId));var deal=d.deal||{};var msgs=d.messages||[];box.innerHTML='<div class="chathead"><strong>'+esc(deal.shop_name||'店舗')+' × '+esc(deal.nickname||'求職者')+'</strong><div class="meta">案件 '+esc(dealId)+' / '+esc(deal.stage||'')+'</div></div><div class="messages">'+(msgs.length?msgs.map(function(m){var shop=String(m.from||'').indexOf('shop:')===0;var at=m.at?new Date(Number(m.at)).toLocaleString('ja-JP'):'';return '<div class="msg '+(shop?'shop':'worker')+'"><span class="who">'+(shop?'店舗':'求職者')+' ・ '+esc(at)+'</span>'+esc(m.body||'')+'</div>';}).join(''):'<div class="empty">メッセージはありません</div>')+'</div>';var m=box.querySelector('.messages');if(m)m.scrollTop=m.scrollHeight;}catch(e){box.innerHTML='<div class="empty" style="margin:auto">会話を読み込めませんでした</div>';toast(e.message,true);}}

  document.getElementById('chat-list').addEventListener('click',function(e){var b=e.target.closest('[data-deal]');if(b)showChat(b.dataset.deal);});
  loadKyc();
})();
</script>
</body>
</html>`;
