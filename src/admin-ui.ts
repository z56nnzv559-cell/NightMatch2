export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="theme-color" content="#100d14" />
  <title>NightMatch 運営</title>
  <style>
    :root{color-scheme:dark;--bg:#100d14;--panel:#191520;--panel2:#211b2a;--line:#342c3e;--text:#f6f1f8;--muted:#aaa1b0;--accent:#b69af7;--danger:#ff8e9a;--ok:#8fe0b4;--warn:#f0c67b}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    button,input,textarea{font:inherit} button{cursor:pointer}
    .shell{max-width:1120px;margin:auto;padding:24px 18px 70px}.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:22px}
    .brand{font-size:25px;font-weight:800;letter-spacing:.02em}.sub{color:var(--muted);font-size:13px;margin-top:5px}
    .tabs{display:flex;gap:8px;overflow:auto;padding-bottom:8px;margin-bottom:16px}.tab{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;padding:10px 16px;white-space:nowrap}.tab.active{background:var(--text);color:var(--bg);border-color:var(--text)}
    .panel{display:none}.panel.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px}.card h3{margin:0 0 8px;font-size:16px}.meta{color:var(--muted);font-size:13px;line-height:1.7}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}.stack{display:grid;gap:10px}
    .input,.textarea{width:100%;border:1px solid var(--line);border-radius:12px;background:#0e0b12;color:var(--text);padding:11px 12px}.textarea{min-height:88px;resize:vertical}.btn{border:0;border-radius:12px;padding:10px 14px;background:var(--accent);color:#120d18;font-weight:700}.btn.secondary{background:var(--panel2);color:var(--text);border:1px solid var(--line)}.btn.danger{background:var(--danger);color:#1b090c}.btn:disabled{opacity:.45;cursor:not-allowed}
    .badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:4px 9px;font-size:12px;color:var(--muted)}.badge.ok{color:var(--ok)}.badge.warn{color:var(--warn)}.badge.danger{color:var(--danger)}
    .empty{padding:32px;text-align:center;color:var(--muted);background:var(--panel);border:1px dashed var(--line);border-radius:18px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 12px}.section-title h2{font-size:18px;margin:0}.count{font-size:12px;color:var(--muted)}
    .detail{margin-top:14px;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px}.money{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.money>div{background:var(--panel2);border-radius:14px;padding:14px}.money small{display:block;color:var(--muted);margin-bottom:5px}.money strong{font-size:22px}.mismatch{border:1px solid var(--danger);color:var(--danger);padding:11px;border-radius:12px;margin:10px 0}.match{border:1px solid #315744;color:var(--ok);padding:11px;border-radius:12px;margin:10px 0}
    .lineitem,.timeline{padding:10px 0;border-top:1px solid var(--line)}.lineitem:first-child,.timeline:first-child{border-top:0}.small{font-size:12px;color:var(--muted)}
    .score{font-size:22px;font-weight:800;color:var(--warn)}.toast{position:fixed;right:16px;bottom:18px;max-width:360px;background:#292130;border:1px solid var(--line);padding:12px 15px;border-radius:13px;box-shadow:0 10px 40px #0008;display:none;z-index:20}.toast.show{display:block}.toast.error{border-color:var(--danger)}
    .loading{opacity:.55;pointer-events:none}.sensitive{font-size:12px;color:var(--muted);border-left:3px solid var(--accent);padding-left:10px;margin:8px 0 14px}
    @media(max-width:600px){.shell{padding:18px 12px 60px}.top{align-items:flex-start;flex-direction:column}.money{grid-template-columns:1fr}.btn{width:100%}.row.actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.row.actions .btn{width:100%}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top"><div><div class="brand">NightMatch 運営</div><div class="sub">Cloudflare Access で保護された管理画面</div></div><button class="btn secondary" id="reload">再読み込み</button></header>
    <nav class="tabs" aria-label="管理機能">
      <button class="tab active" data-tab="shops">店舗確認</button>
      <button class="tab" data-tab="invoices">請求</button>
      <button class="tab" data-tab="reviews">中抜け審査</button>
    </nav>

    <section class="panel active" id="panel-shops">
      <div class="section-title"><h2>確認待ちの店舗</h2><span class="count" id="shops-count"></span></div>
      <div class="grid" id="shops-list"></div>
    </section>

    <section class="panel" id="panel-invoices">
      <div class="section-title"><h2>請求書</h2><span class="count" id="invoices-count"></span></div>
      <div class="grid" id="invoices-list"></div>
      <div id="invoice-detail"></div>
    </section>

    <section class="panel" id="panel-reviews">
      <div class="section-title"><h2>審査待ち</h2><span class="count" id="reviews-count"></span></div>
      <p class="sensitive">会話本文は表示しません。審査では、システムが記録した兆候と出来事の時系列だけを確認します。</p>
      <div class="grid" id="reviews-list"></div>
      <div id="review-detail"></div>
    </section>
  </main>
  <div class="toast" id="toast" role="status"></div>

<script>
(function(){
  'use strict';
  var toastTimer;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function yen(v){return new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(v||0));}
  function toast(msg,error){var el=document.getElementById('toast');el.textContent=msg;el.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.className='toast';},3500);}
  async function api(path,opts){var res=await fetch(path,Object.assign({headers:{'content-type':'application/json'}},opts||{}));var body={};try{body=await res.json();}catch(e){}if(!res.ok){var err=new Error(body.error||('HTTP '+res.status));err.body=body;err.status=res.status;throw err;}return body;}
  function empty(el,text){el.innerHTML='<div class="empty">'+esc(text)+'</div>';}
  function statusBadge(status){var cls=status==='draft'?'warn':status==='paid'?'ok':status==='sent'?'ok':'';return '<span class="badge '+cls+'">'+esc(status)+'</span>';}

  async function loadShops(){var el=document.getElementById('shops-list');el.classList.add('loading');try{var data=await api('/admin/shops/pending');var rows=data.shops||[];document.getElementById('shops-count').textContent=rows.length+'件';if(!rows.length){empty(el,'確認待ちの店舗はありません');return;}el.innerHTML=rows.map(function(s){return '<article class="card"><div class="row between"><h3>'+esc(s.name)+'</h3><span class="badge warn">確認待ち</span></div><div class="meta">'+esc(s.area)+' ・ '+esc(s.business_type)+'<br>最寄り: '+esc(s.station||'未入力')+'<br>オーナー: '+esc(s.owner_email||'未登録')+'</div><div class="stack" style="margin-top:12px"><input class="input" id="license-'+esc(s.id)+'" placeholder="風営法の許可番号" autocomplete="off"><button class="btn" data-verify="'+esc(s.id)+'">確認して有効化</button></div></article>';}).join('');}catch(e){empty(el,'読み込みに失敗しました');toast(e.message,true);}finally{el.classList.remove('loading');}}

  async function verifyShop(id,button){var input=document.getElementById('license-'+id);var license=(input&&input.value||'').trim();if(!license){toast('許可番号を入力してください',true);return;}button.disabled=true;try{await api('/admin/shops/'+encodeURIComponent(id)+'/verify',{method:'POST',body:JSON.stringify({licenseNo:license})});toast('店舗を確認しました');await loadShops();}catch(e){toast(e.body&&e.body.error==='not_pending'?'確認待ちの店舗ではありません':e.message,true);button.disabled=false;}}

  async function loadInvoices(){var el=document.getElementById('invoices-list');el.classList.add('loading');try{var data=await api('/admin/invoices');var rows=data.invoices||[];document.getElementById('invoices-count').textContent=rows.length+'件';if(!rows.length){empty(el,'請求書はありません');return;}el.innerHTML=rows.map(function(i){return '<button class="card" data-invoice="'+esc(i.id)+'" style="text-align:left;color:inherit"><div class="row between"><h3>'+esc(i.name)+'</h3>'+statusBadge(i.status)+'</div><div class="meta">'+esc(i.period)+' ・ '+yen(i.subtotal)+'</div></button>';}).join('');}catch(e){empty(el,'読み込みに失敗しました');toast(e.message,true);}finally{el.classList.remove('loading');}}

  async function showInvoice(id){var el=document.getElementById('invoice-detail');el.innerHTML='<div class="detail loading">読み込み中…</div>';try{var d=await api('/admin/invoices/'+encodeURIComponent(id));var inv=d.invoice||{};var mismatch=!!d.mismatch;var lines=d.lines||[];el.innerHTML='<section class="detail"><div class="row between"><div><h3 style="margin:0">'+esc(inv.shop_name||'請求詳細')+'</h3><div class="small">'+esc(inv.period||'')+' / '+esc(inv.status||'')+'</div></div>'+statusBadge(inv.status||'')+'</div><div class="money"><div><small>請求書 subtotal</small><strong>'+yen(inv.subtotal)+'</strong></div><div><small>台帳の合計</small><strong>'+yen(d.ledgerTotal)+'</strong></div></div>'+(mismatch?'<div class="mismatch">金額が一致していません。自動修正せず、送付を停止します。</div>':'<div class="match">台帳と請求書の金額が一致しています。</div>')+'<div class="stack">'+(lines.length?lines.map(function(l){return '<div class="lineitem"><div class="row between"><strong>'+esc(l.nickname)+' / '+esc(l.kind)+'</strong><strong>'+yen(l.amount)+'</strong></div><div class="small">案件 '+esc(l.deal_id)+' ・ '+esc(l.state)+' ・ '+esc(l.occurred_at)+'</div></div>';}).join(''):'<div class="empty">明細はありません</div>')+'</div><div style="margin-top:14px"><button class="btn" id="send-invoice" '+(mismatch||inv.status!=='draft'?'disabled':'')+'>請求を確定して送付</button></div></section>';var b=document.getElementById('send-invoice');if(b&&!b.disabled)b.onclick=function(){sendInvoice(id,b);};}catch(e){el.innerHTML='';toast(e.message,true);}}

  async function sendInvoice(id,button){if(!confirm('台帳と請求額を確認しました。請求書を確定して送付しますか？'))return;button.disabled=true;try{await api('/admin/invoices/'+encodeURIComponent(id)+'/send',{method:'POST',body:'{}'});toast('請求書を送付しました');await loadInvoices();await showInvoice(id);}catch(e){var b=e.body||{};if(b.error==='ledger_mismatch')toast('台帳 '+yen(b.ledger)+' と請求書 '+yen(b.invoice)+' が一致しません',true);else toast(e.message,true);button.disabled=false;}}

  async function loadReviews(){var el=document.getElementById('reviews-list');el.classList.add('loading');try{var data=await api('/admin/review');var rows=data.cases||[];document.getElementById('reviews-count').textContent=rows.length+'件';if(!rows.length){empty(el,'審査待ちはありません');return;}el.innerHTML=rows.map(function(r){return '<button class="card" data-review="'+esc(r.id)+'" style="text-align:left;color:inherit"><div class="row between"><h3>'+esc(r.shop_name)+' × '+esc(r.nickname)+'</h3><span class="score">'+esc(r.score)+'</span></div><div class="meta">'+esc(r.reason)+'<br>案件 '+esc(r.deal_id)+' ・ '+esc(r.stage)+'</div></button>';}).join('');}catch(e){empty(el,'読み込みに失敗しました');toast(e.message,true);}finally{el.classList.remove('loading');}}

  async function showReview(id){var el=document.getElementById('review-detail');el.innerHTML='<div class="detail loading">読み込み中…</div>';try{var d=await api('/admin/review/'+encodeURIComponent(id));var signals=d.signals||[];var events=d.events||[];var timeline=[];signals.forEach(function(s){timeline.push({at:s.created_at,html:'<strong>兆候: '+esc(s.signal)+'</strong> <span class="badge warn">+'+esc(s.weight)+'</span><div class="small">'+esc(s.detail||'')+'</div>'});});events.forEach(function(e){timeline.push({at:e.occurred_at,html:'<strong>出来事: '+esc(e.type)+'</strong><div class="small">actor: '+esc(e.actor)+'</div>'});});timeline.sort(function(a,b){return String(a.at).localeCompare(String(b.at));});el.innerHTML='<section class="detail"><h3 style="margin-top:0">審査の時系列</h3><p class="sensitive">会話の本文は取得していません。下記はシステムの記録のみです。</p><div>'+(timeline.length?timeline.map(function(x){return '<div class="timeline">'+x.html+'<div class="small">'+esc(x.at)+'</div></div>';}).join(''):'<div class="empty">記録がありません</div>')+'</div><textarea class="textarea" id="review-note" placeholder="判定理由（必須）"></textarea><div class="row actions" style="margin-top:10px"><button class="btn" id="review-clear">問題なし・保留解除</button><button class="btn danger" id="review-confirm">違反を確認</button></div></section>';document.getElementById('review-clear').onclick=function(){resolveReview(id,'cleared');};document.getElementById('review-confirm').onclick=function(){resolveReview(id,'confirmed');};}catch(e){el.innerHTML='';toast(e.message,true);}}

  async function resolveReview(id,verdict){var note=(document.getElementById('review-note').value||'').trim();if(!note){toast('判定理由を入力してください',true);return;}if(!confirm(verdict==='cleared'?'問題なしとして保留を解除しますか？':'違反を確認済みにしますか？'))return;try{var r=await api('/admin/review/'+encodeURIComponent(id)+'/resolve',{method:'POST',body:JSON.stringify({verdict:verdict,note:note})});toast(verdict==='cleared'?'保留を解除しました（再送 '+Number(r.payoutsRequeued||0)+'件）':'違反として処理しました');document.getElementById('review-detail').innerHTML='';await loadReviews();}catch(e){toast(e.message,true);}}

  function loadActive(){var active=document.querySelector('.tab.active').dataset.tab;if(active==='shops')loadShops();if(active==='invoices')loadInvoices();if(active==='reviews')loadReviews();}
  document.querySelectorAll('.tab').forEach(function(btn){btn.onclick=function(){document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active');});document.querySelectorAll('.panel').forEach(function(x){x.classList.remove('active');});btn.classList.add('active');document.getElementById('panel-'+btn.dataset.tab).classList.add('active');loadActive();};});
  document.getElementById('reload').onclick=loadActive;
  document.addEventListener('click',function(e){var v=e.target.closest('[data-verify]');if(v)verifyShop(v.dataset.verify,v);var i=e.target.closest('[data-invoice]');if(i)showInvoice(i.dataset.invoice);var r=e.target.closest('[data-review]');if(r)showReview(r.dataset.review);});
  loadShops();
})();
</script>
</body>
</html>`;
