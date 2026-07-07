/* ============================================================
   Monkey Wrench Ops 2.0 — frontend SPA
   ============================================================ */
const root = document.getElementById('root');
let ME = null, CFG = { office_domain: 'monkeywrench.in' };
let VIEW = null, APPROVAL_COUNT = 0, NOTIF_COUNT = 0, PRESENT_MODE = false;
let MASTERS = { verticals: null, teams: null, departments: null, clients: null, stages: null };

/* ---------- tiny utils ---------- */
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const INR = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const INRk = n => { n = +n||0; const a=Math.abs(n); if(a>=1e7)return '₹'+(n/1e7).toFixed(2)+'Cr'; if(a>=1e5)return '₹'+(n/1e5).toFixed(2)+'L'; if(a>=1e3)return '₹'+(n/1e3).toFixed(1)+'k'; return '₹'+Math.round(n); };
const fmtDate = iso => { if(!iso) return '—'; const d=new Date(iso+'T00:00:00'); return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); };
const fmtDateY = iso => { if(!iso) return '—'; const d=new Date(iso+'T00:00:00'); return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); };
const truncate = (s,n) => { s=s||''; return s.length>n? s.slice(0,n-1)+'…' : s; };
const initials = n => (n||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
const val = id => document.getElementById(id).value.trim();
const value = id => document.getElementById(id).value;

/* role helpers */
const isBackend = () => ME && (ME.role==='admin' || ME.role==='super_admin');     // reaches job CRUD
const isSuper   = () => ME && ME.role==='super_admin';
const hasCap    = c => !!(ME && ME.capabilities && ME.capabilities.includes(c));   // granular capability
const canMoney  = () => !!(ME && ME.can_see_money && !PRESENT_MODE);               // financial visibility

function toast(msg, bad){
  const t=document.getElementById('toast');
  t.className='toast show'+(bad?' bad':'');
  t.innerHTML=(bad?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg>'
    :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 13l4 4L19 7"/></svg>')+esc(msg);
  clearTimeout(t._t); t._t=setTimeout(()=>t.className='toast',2600);
}

async function api(method, path, body){
  const res = await fetch('/api'+path, {
    method, headers:{'Content-Type':'application/json'},
    body: body? JSON.stringify(body): undefined, credentials:'same-origin'
  });
  let data=null; try{ data=await res.json(); }catch{}
  if(!res.ok){ const e=new Error((data&&data.error)||'Request failed'); e.status=res.status; e.data=data; throw e; }
  return data;
}

const STAGES=['Pipeline','Pending','Studio','Review','Done','Approved'];
const STAGE_CLS={Pipeline:'pipeline',Pending:'pending',Studio:'studio',Review:'review',Done:'done',Approved:'approved'};
const STAGE_COLOR={Pipeline:'#7A8089',Pending:'#C9780B',Studio:'#516FB0',Review:'#6F5DA6',Done:'#56743A',Approved:'#3F5526'};
const TASK_COLORS={'Design':['var(--green-soft)','var(--green)'],'Ideation + Design':['var(--violet-soft)','var(--violet)'],
  'AW':['var(--blue-soft)','var(--blue)'],'Modification':['var(--amber-soft)','var(--amber)'],
  'Review':['var(--slate-soft)','var(--slate)'],'Image Correction':['var(--red-soft)','var(--red)']};
const APP_LABEL={none:'',submitted:'Awaiting lead',lead_approved:'Awaiting admin',admin_approved:'Awaiting super',approved:'Approved',rejected:'Rejected'};

/* cached masters */
async function masters(kind, force){
  if(force) MASTERS[kind]=null;
  if(!MASTERS[kind]) MASTERS[kind]=await api('GET','/masters/'+kind);
  return MASTERS[kind];
}
function clearMasters(){ MASTERS={verticals:null,teams:null,departments:null,clients:null,stages:null}; }

/* ============================================================
   Boot — restore session or show login
   ============================================================ */
(async function boot(){
  try{ CFG = await api('GET','/config'); }catch{}
  try{ const r=await api('GET','/me'); ME=r.user; mountApp(); }
  catch{ mountLogin(); }
})();

/* ============================================================
   Login / change-password
   ============================================================ */
const GLYPH='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-.6-.6-2.1z"/></svg>';
function loginShell(inner){ root.innerHTML=`<div class="login-wrap"><div class="login-card">
  <div class="brand"><div class="glyph">${GLYPH}</div><div><h1>Monkey Wrench</h1><span class="sub">Ops Console</span></div></div>
  ${inner}</div></div>`; }

function mountLogin(err){
  loginShell(`
    <label>Office email</label>
    <input id="email" type="email" placeholder="you@${esc(CFG.office_domain)}" autocomplete="username">
    <div class="domain-hint">Sign in with your @${esc(CFG.office_domain)} address.</div>
    <label>Password</label>
    <input id="pw" type="password" placeholder="••••••••" autocomplete="current-password">
    ${err?`<div class="err">${esc(err)}</div>`:''}
    <button class="btn pri" id="go" style="width:100%;justify-content:center;margin-top:18px;padding:11px">Sign in</button>
    <div class="domain-hint" style="text-align:center;margin-top:14px">Forgot your password? Ask an admin to reset it — or, for Super Admins, <span class="linkbtn" id="superForgot">reset by email</span>.</div>`);
  const submit=async()=>{
    try{ const r=await api('POST','/login',{email:val('email'),password:value('pw')}); ME=r.user; clearMasters(); mountApp(); }
    catch(e){ mountLogin(e.message); }
  };
  document.getElementById('go').onclick=submit;
  document.getElementById('pw').onkeydown=e=>{if(e.key==='Enter')submit();};
  document.getElementById('superForgot').onclick=()=>superResetRequest();
  document.getElementById('email').focus();
}

function superResetRequest(prefill){
  loginShell(`
    <h1 style="font-size:18px;margin:4px 0">Super Admin password reset</h1>
    <p style="color:var(--ink2);font-size:13px;margin:2px 0 8px">Enter your Super Admin email. If it's recognised, a 6-digit code is sent to that address (valid 15 minutes).</p>
    <label>Email</label>
    <input id="sr_email" type="email" value="${esc(prefill||'')}" placeholder="you@${esc(CFG.office_domain)}" autocomplete="username">
    <div id="sr_msg"></div>
    <button class="btn pri" id="sr_go" style="width:100%;justify-content:center;margin-top:16px;padding:11px">Send code</button>
    <div style="text-align:center;margin-top:14px"><span class="linkbtn" id="sr_have">I already have a code</span> · <span class="linkbtn" id="sr_back">← Back</span></div>`);
  document.getElementById('sr_back').onclick=()=>mountLogin();
  document.getElementById('sr_have').onclick=()=>superResetConfirm(val('sr_email'));
  document.getElementById('sr_go').onclick=async()=>{
    const email=val('sr_email'); if(!email)return;
    try{ await api('POST','/super-reset/request',{email}); superResetConfirm(email,true); }
    catch(e){ toast(e.message,true); }
  };
  document.getElementById('sr_email').focus();
}
function superResetConfirm(email,sent){
  loginShell(`
    <h1 style="font-size:18px;margin:4px 0">Enter your code</h1>
    ${sent?`<div class="note info" style="margin:4px 0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>If ${esc(email)} is a Super Admin, a code is on its way.</div>`:''}
    <label>Email</label><input id="sc_email" type="email" value="${esc(email||'')}" autocomplete="username">
    <label>6-digit code</label><input id="sc_code" inputmode="numeric" maxlength="6" placeholder="••••••">
    <label>New password</label><input id="sc_pw" type="password" autocomplete="new-password" placeholder="at least 8 characters">
    <div id="sc_msg"></div>
    <button class="btn pri" id="sc_go" style="width:100%;justify-content:center;margin-top:16px;padding:11px">Set new password</button>
    <div style="text-align:center;margin-top:14px"><span class="linkbtn" id="sc_resend">Send a new code</span> · <span class="linkbtn" id="sc_back">← Back to sign in</span></div>`);
  document.getElementById('sc_back').onclick=()=>mountLogin();
  document.getElementById('sc_resend').onclick=()=>superResetRequest(val('sc_email'));
  document.getElementById('sc_go').onclick=async()=>{
    try{ await api('POST','/super-reset/confirm',{email:val('sc_email'),code:val('sc_code'),new_password:value('sc_pw')});
      loginShell(`<div class="note info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>Password updated. You can sign in now.</div>
        <button class="btn pri" id="sc_done" style="width:100%;justify-content:center;margin-top:16px;padding:11px">Go to sign in</button>`);
      document.getElementById('sc_done').onclick=()=>mountLogin();
    }catch(e){ document.getElementById('sc_msg').innerHTML=`<div class="err">${esc(e.message)}</div>`; }
  };
  document.getElementById('sc_code').focus();
}

function changePwScreen(){
  loginShell(`
    <h1 style="font-size:18px;margin:4px 0">Set a new password</h1>
    <p style="color:var(--ink2);font-size:13px;margin-top:2px">Welcome ${esc(ME.name)}. Choose a password you'll use from now on.</p>
    <label>Current (temporary) password</label><input id="old" type="password" autocomplete="current-password">
    <label>New password</label><input id="new" type="password" autocomplete="new-password" placeholder="at least 8 characters">
    <div id="cperr"></div>
    <button class="btn pri" id="cpgo" style="width:100%;justify-content:center;margin-top:18px;padding:11px">Save password</button>`);
  document.getElementById('cpgo').onclick=async()=>{
    try{ await api('POST','/change-password',{old_password:value('old'),new_password:value('new')});
      ME.must_change_pw=false; toast('Password updated'); mountApp(); }
    catch(e){ document.getElementById('cperr').innerHTML=`<div class="err">${esc(e.message)}</div>`; }
  };
}

async function logout(){ try{await api('POST','/logout');}catch{} ME=null; PRESENT_MODE=false; clearMasters(); history.replaceState({},'','/'); mountLogin(); }

/* ============================================================
   App shell + nav (role-aware)
   ============================================================ */
function navFor(role){
  const nav=[];
  if(hasCap('view_finance')) nav.push(['dashboard','Dashboard',icon('chart')]);
  if(role==='member'){ nav.push(['my_jobs','My jobs',icon('check')]); if(hasCap('manage_jobs')) nav.push(['board','Jobs',icon('grid')]); }
  else if(role==='team_lead') nav.push(['my_jobs','My jobs',icon('check')],['board','Team board',icon('grid')]);
  else nav.push(['board','Jobs',icon('grid')]);
  nav.push(['timesheet','Timesheet',icon('clock')]);
  nav.push(role==='member'?['my_status','My approvals',icon('flag')]:['approvals','Approvals',icon('flag')]);
  if(hasCap('view_finance')) nav.push(['pnl','Profit & Loss',icon('trend')],['reports','Reports',icon('gauge')]);
  if(hasCap('manage_masters')) nav.push(['masters','Masters',icon('layers')]);
  if(hasCap('manage_users')) nav.push(['users','Users',icon('users')]);
  if(hasCap('view_activity')) nav.push(['activity','Activity',icon('history')]);
  if(isSuper()) nav.push(['permissions','Permissions',icon('key')],['data','Data',icon('database')]);
  return nav;
}
const VIEW_TITLES={
  my_jobs:["My jobs","What's on your plate today"],
  timesheet:['Timesheet','Log hours and submit your day'],
  my_status:['My approvals','Where your finished jobs stand'],
  board:[()=>ME.role==='team_lead'?'Team board':'Jobs','Jobs across the studio'],
  approvals:['Approvals','Sign-off queue waiting on you'],
  dashboard:['Dashboard','Studio health at a glance'],
  pnl:['Profit & Loss','What each client and job earns'],
  reports:['Reports','Bandwidth & year-on-year trends'],
  activity:['Activity','The audit trail across jobs'],
  permissions:['Permissions','Grant access, per person'],
  data:['Data management','Back up, export, restore & reset'],
  masters:['Masters','Verticals, teams, departments & clients'],
  users:['Users','People, roles, departments & rates'],
};

function mountApp(){
  if(ME.must_change_pw){ changePwScreen(); return; }
  const nav=navFor(ME.role);
  if(!VIEW || !nav.find(n=>n[0]===VIEW)) VIEW=nav[0][0];
  root.innerHTML=`
  <div class="app">
    <aside class="side" id="side">
      <div class="brand"><div class="glyph">${GLYPH}</div><div><b>Monkey Wrench</b><span>Ops Console</span></div></div>
      ${nav.map(n=>`<button class="navlink ${n[0]===VIEW?'on':''}" data-v="${n[0]}">${n[2]}${n[1]}${n[0]==='approvals'?`<span class="badge ${APPROVAL_COUNT?'':'hide'}" id="appBadge">${APPROVAL_COUNT}</span>`:''}</button>`).join('')}
      <div class="sp"></div>
      <div class="me"><div class="av">${initials(ME.name)}</div>
        <div><div class="nm">${esc(ME.name)}</div><div class="rl">${esc(ME.role.replace('_',' '))}${ME.teams&&ME.teams.length?' · '+esc(ME.teams.join(', ')):(ME.department?' · '+esc(ME.department):'')}</div></div>
        <button id="logout" title="Sign out">${icon('logout')}</button></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="menu-btn" id="menuBtn">${icon('menu')}</button>
        <div><h1 id="pgT"></h1><div class="sub" id="pgS"></div></div>
        <div class="sp"></div>
        <button class="bellbtn" id="bellBtn" title="Notifications">${icon('bell')}<span class="badge ${NOTIF_COUNT?'':'hide'}" id="notifBadge">${NOTIF_COUNT}</span></button>
        ${isSuper()?`<button class="present-toggle ${PRESENT_MODE?'on':''}" id="presentBtn" title="Hide financials while screen-sharing">${icon(PRESENT_MODE?'eyeoff':'eye')}${PRESENT_MODE?'Financials hidden':'Presentation mode'}</button>`:''}
        <div class="datestamp">${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</div>
        <span id="pageAction"></span>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`;
  root.querySelectorAll('.navlink').forEach(b=>b.onclick=()=>{VIEW=b.dataset.v; mountApp();});
  document.getElementById('logout').onclick=logout;
  document.getElementById('menuBtn').onclick=()=>document.getElementById('side').classList.toggle('open');
  const pb=document.getElementById('presentBtn');
  if(pb)pb.onclick=()=>{ PRESENT_MODE=!PRESENT_MODE; toast(PRESENT_MODE?'Presentation mode on — financials hidden':'Presentation mode off'); mountApp(); };
  const bell=document.getElementById('bellBtn'); if(bell)bell.onclick=notifPanel;
  const t=VIEW_TITLES[VIEW]; document.getElementById('pgT').textContent= typeof t[0]==='function'?t[0]():t[0];
  document.getElementById('pgS').textContent=t[1];
  refreshApprovalBadge();
  refreshNotifBadge();
  renderView();
}

async function refreshNotifBadge(){
  try{ const r=await api('GET','/notifications/count'); NOTIF_COUNT=r.count;
    const b=document.getElementById('notifBadge'); if(b){ b.textContent=r.count; b.classList.toggle('hide',!r.count);} }catch{}
}
async function refreshMe(){ try{ const r=await api('GET','/me'); ME=r.user; }catch{} }
async function notifPanel(){
  let list=[]; try{ list=await api('GET','/notifications'); }catch{}
  const body = list.length ? `<div class="notiflist">${list.map(n=>`
    <div class="notifrow ${n.read?'':'unread'}" ${n.job_id?`data-openjob="${n.job_id}"`:''}>
      <span class="ndot nd-${esc(n.kind)}"></span>
      <div class="ntext">${esc(n.message)}<div class="ntime">${fmtWhen(n.created_at)}</div></div>
    </div>`).join('')}</div>`
    : `<div style="text-align:center;color:var(--muted);padding:26px">No notifications yet.</div>`;
  modal('Notifications', body, list.some(n=>!n.read)?'Mark all read':'', async()=>{
    await api('POST','/notifications/read-all'); NOTIF_COUNT=0; refreshNotifBadge(); return true;
  });
  // mark-one-read + jump to job
  document.querySelectorAll('[data-openjob]').forEach(r=>r.onclick=async()=>{
    closeModal();
    try{ const j=await api('GET','/jobs/'+r.dataset.openjob); await api('POST','/notifications/read-all').catch(()=>{}); NOTIF_COUNT=0; refreshNotifBadge(); jobDetailModal(j); }
    catch(e){ toast(e.message,true); }
  });
}
function fmtWhen(iso){
  if(!iso) return '';
  const d=new Date(iso.replace(' ','T')+'Z'); if(isNaN(d)) return iso;
  const diff=(Date.now()-d.getTime())/1000;
  if(diff<60) return 'just now';
  if(diff<3600) return Math.floor(diff/60)+'m ago';
  if(diff<86400) return Math.floor(diff/3600)+'h ago';
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}

async function refreshApprovalBadge(){
  if(ME.role==='member') return;
  try{ const r=await api('GET','/approvals/count'); APPROVAL_COUNT=r.count;
    const b=document.getElementById('appBadge'); if(b){ b.textContent=r.count; b.classList.toggle('hide',!r.count);} }catch{}
}

function presentBanner(){
  return `<div class="present-banner">${icon('eyeoff')}Presentation mode is on — financial figures are hidden. Toggle it off in the top bar to view them.</div>`;
}

function renderView(){
  const C=document.getElementById('content'); C.innerHTML=`<div style="padding:40px;text-align:center"><span class="spin"></span></div>`;
  ({my_jobs:viewMyJobs,timesheet:viewTimesheet,my_status:viewMyStatus,board:viewBoard,
    approvals:viewApprovals,dashboard:viewDashboard,pnl:viewPnl,reports:viewReports,
    activity:viewActivity,permissions:viewPermissions,data:viewData,masters:viewMasters,users:viewUsers}[VIEW])(C);
}

/* ============================================================
   View: My jobs (member / lead)
   ============================================================ */
let TS_DATE=null;
async function viewMyJobs(C){
  let jobs;
  try{ jobs=await api('GET','/jobs/mine'); }
  catch(e){
    if(e.status===423){
      const owed=e.data.owed_date;
      C.innerHTML=`<div class="gate">
        <div class="lock">${icon('lock')}</div>
        <h2>Submit yesterday's timesheet first</h2>
        <p>Your job list for today is locked until you submit your timesheet for <span class="day">${esc(owed)}</span>.</p>
        <button class="btn pri" id="goTs" style="margin:0 auto">Go to timesheet</button>
      </div>`;
      document.getElementById('goTs').onclick=()=>{VIEW='timesheet'; TS_DATE=owed; mountApp();};
      return;
    }
    C.innerHTML=`<div class="empty"><b>Couldn't load your jobs</b>${esc(e.message)}</div>`; return;
  }
  if(!jobs.length){ C.innerHTML=`<div class="card empty">${icon('check')}<b>Nothing assigned right now</b>Enjoy the quiet, or ask your team lead.</div>`; return; }
  C.innerHTML = jobs.map(j=>myJobCard(j)).join('');
  C.querySelectorAll('[data-submit]').forEach(b=>b.onclick=async()=>{
    try{ await api('POST',`/jobs/${b.dataset.submit}/submit`); toast('Submitted for approval'); renderView(); }
    catch(e){ toast(e.message,true);} });
  C.querySelectorAll('[data-log]').forEach(b=>b.onclick=()=>logTimeModal(b.dataset.log));
  C.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>jobDetailModal(b.dataset.open));
}
function myJobCard(j){
  const tc=TASK_COLORS[j.task]||['var(--surface2)','var(--ink2)'];
  const rejected=j.approval_stage==='rejected';
  const inApproval=['submitted','lead_approved','admin_approved','approved'].includes(j.approval_stage);
  return `<div class="card" style="padding:16px 18px;margin-bottom:12px">
    <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:3px">
          <span class="jno linklike" data-open="${j.id}" title="Open details">${esc(j.job_no)}</span>
          <span class="ptag" style="text-transform:uppercase">${esc(j.client)}</span>
          ${j.task?`<span class="tasktag" style="background:${tc[0]};color:${tc[1]}">${esc(j.task)}</span>`:''}
        </div>
        <div style="font-weight:600;font-size:15px">${esc(j.brief)}</div>
        <div style="margin-top:6px;font-size:12px;color:var(--muted)">Due ${fmtDate(j.due_date)} · ${(j.teams&&j.teams.length?j.teams.map(t=>t.name).join(', '):(j.team||'—'))} team${(j.teams&&j.teams.length>1)?'s':''}</div>
        <div class="jindic" style="margin-top:6px">
          ${j.workflow_stage?`<span class="metachip">${esc(j.workflow_stage)}</span>`:''}
          ${j.subtasks_total?`<span class="metachip">${icon('check')}${j.subtasks_done}/${j.subtasks_total}</span>`:''}
          ${j.attachments?`<span class="metachip">${icon('paperclip')}${j.attachments}</span>`:''}
          ${j.open_issues?`<span class="blockchip">${icon('flag')}${j.open_issues}</span>`:''}
        </div>
        ${rejected?`<div class="note" style="margin-top:10px;margin-bottom:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg>Sent back: ${esc(j.reject_note||'rework needed')}</div>`:''}
      </div>
      <div style="text-align:right;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        ${inApproval?`<span class="appchip app-${j.approval_stage}">${esc(APP_LABEL[j.approval_stage])}</span>`
          :`<span class="appchip app-none">${esc(j.stage)}</span>`}
        <div style="display:flex;gap:6px">
          <button class="btn sm" data-open="${j.id}">${icon('layers')}Details</button>
          <button class="btn sm" data-log="${j.id}">${icon('clock')}Log time</button>
          ${(!inApproval)?`<button class="btn sm pri" data-submit="${j.id}">${icon('flag')}Submit for approval</button>`:''}
        </div>
      </div>
    </div></div>`;
}

/* ============================================================
   View: Timesheet
   ============================================================ */
async function viewTimesheet(C){
  const date=TS_DATE||new Date().toISOString().slice(0,10);
  TS_DATE=date;
  let entries=[], sub={submitted:false}, gate={locked:false};
  try{
    [entries,sub,gate]=await Promise.all([
      api('GET',`/timesheets/mine?date=${date}`),
      api('GET',`/timesheets/submitted?date=${date}`),
      api('GET','/timesheets/gate'),
    ]);
  }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const total=entries.reduce((s,e)=>s+e.hours,0);
  const owed=gate.owed_date;
  C.innerHTML=`
  ${owed?`<div class="note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg>
    Your job list is locked until you submit <b>&nbsp;${esc(owed)}</b>. Switch the date below to ${esc(owed)} and submit it.</div>`:''}
  <div class="filters" style="justify-content:space-between">
    <div style="display:flex;align-items:center;gap:10px">
      <label style="font-size:12px;color:var(--ink2);font-weight:600">Day</label>
      <input class="sel" id="tsDate" type="date" value="${date}" style="padding:0 11px">
      ${sub.submitted?`<span class="appchip app-approved">${icon('check')}Submitted</span>`:`<span class="appchip app-submitted">Open</span>`}
    </div>
    <div style="display:flex;gap:8px">
      ${!sub.submitted?`<button class="btn" id="addTs">${icon('plus')}Log time</button>
      <button class="btn pri" id="submitDay">${icon('flag')}Submit day</button>`:''}
    </div>
  </div>
  <div class="card" style="padding:18px 20px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
      <div class="minihead" style="padding:0">Entries for ${fmtDate(date)}</div>
      <div style="font-family:'JetBrains Mono';font-weight:600">${total} h</div>
    </div>
    ${entries.length?`<div class="tslist">${entries.map(e=>`
      <div class="tsrow"><span class="h">${e.hours}h</span>
        <div style="flex:1"><b>${esc(e.job_no)}</b> <span style="color:var(--muted)">${esc(truncate(e.brief,46))}</span>
        ${e.note?`<div style="font-size:12px;color:var(--muted)">${esc(e.note)}</div>`:''}</div>
        ${!sub.submitted?`<button class="icon-btn" data-del="${e.id}">${icon('trash')}</button>`:''}
      </div>`).join('')}</div>`
    :`<div style="text-align:center;color:var(--muted);padding:24px">No time logged for this day yet.</div>`}
  </div>
  ${sub.submitted?`<div class="note info" style="margin-top:16px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>This day is submitted and locked. Your next day's job list is unlocked.</div>`:''}`;
  document.getElementById('tsDate').onchange=e=>{TS_DATE=e.target.value; renderView();};
  const add=document.getElementById('addTs'); if(add)add.onclick=()=>logTimeModal(null,date);
  const sd=document.getElementById('submitDay'); if(sd)sd.onclick=async()=>{
    try{ await api('POST','/timesheets/submit-day',{work_date:date}); toast('Day submitted — job list unlocked'); renderView(); refreshApprovalBadge(); }
    catch(e){ toast(e.message,true);} };
  C.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    try{ await api('DELETE',`/timesheets/${b.dataset.del}`); renderView(); }catch(e){toast(e.message,true);} });
}

async function logTimeModal(jobId, date){
  date=date||TS_DATE||new Date().toISOString().slice(0,10);
  let jobs;
  try{ jobs = ME.role==='member'? await api('GET','/jobs/mine').catch(()=>[]) : await api('GET','/jobs'); }
  catch{ jobs=[]; }
  if(!Array.isArray(jobs)) jobs=[];
  const opts=jobs.map(j=>`<option value="${j.id}" ${j.id==jobId?'selected':''}>${esc(j.job_no)} — ${esc(truncate(j.brief,38))}</option>`).join('');
  modal(`Log time`, `
    <div class="formgrid">
      <div class="field full"><label>Job</label><select id="m_job">${opts||'<option>No jobs</option>'}</select></div>
      <div class="field"><label>Hours</label><input id="m_hours" type="number" min="0" step="0.5" value="1"></div>
      <div class="field"><label>Date</label><input id="m_date" type="date" value="${date}"></div>
      <div class="field full"><label>Note <span class="help">optional</span></label><input id="m_note" placeholder="What you worked on"></div>
    </div>`,
    'Log time', async()=>{
      const job_id=+document.getElementById('m_job').value, hours=+document.getElementById('m_hours').value;
      if(!(hours>0)) { toast('Enter hours > 0',true); return false; }
      await api('POST','/timesheets',{job_id,hours,work_date:document.getElementById('m_date').value,note:document.getElementById('m_note').value});
      toast('Time logged'); renderView(); return true;
    });
}

/* ============================================================
   View: My approvals (member) — status of submitted jobs
   ============================================================ */
async function viewMyStatus(C){
  let jobs;
  try{ jobs=await api('GET','/jobs'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const inflight=jobs.filter(j=>j.approval_stage&&j.approval_stage!=='none');
  if(!inflight.length){ C.innerHTML=`<div class="card empty">${icon('flag')}<b>Nothing in approval</b>Finish a job and hit "Submit for approval".</div>`; return; }
  C.innerHTML=`<div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Job</th><th>Brief</th><th>Stage</th><th>Status</th></tr></thead><tbody>
    ${inflight.map(j=>`<tr><td><span class="jno">${esc(j.job_no)}</span></td>
      <td>${esc(truncate(j.brief,42))}</td><td>${esc(j.stage)}</td>
      <td><span class="appchip app-${j.approval_stage}">${esc(APP_LABEL[j.approval_stage]||j.approval_stage)}</span>
        ${j.approval_stage==='rejected'&&j.reject_note?`<div style="font-size:11px;color:var(--muted);margin-top:3px">${esc(j.reject_note)}</div>`:''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

/* ============================================================
   View: Board (team lead = team, backend = all)
   ============================================================ */
let bf={q:'',stage:''};
async function viewBoard(C){
  let jobs, people=[];
  try{ jobs=await api('GET','/jobs'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  try{ people=await api('GET','/people'); }catch{}
  const money=canMoney();
  const pa=document.getElementById('pageAction');
  if(pa){ pa.innerHTML= hasCap('manage_jobs')? `<button class="btn pri" id="newJob" style="margin-left:12px">${icon('plus')}New job</button>`:'';
    const nj=document.getElementById('newJob'); if(nj)nj.onclick=()=>jobModal(null); }

  let list=jobs.filter(j=>{
    if(bf.stage&&j.stage!==bf.stage)return false;
    if(bf.q){const s=(j.job_no+' '+j.client+' '+j.brief).toLowerCase(); if(!s.includes(bf.q.toLowerCase()))return false;}
    return true;
  });
  let html='';
  if(PRESENT_MODE && isSuper()) html+=presentBanner();
  html+=`<div class="filters">
    <div class="search">${icon('search')}<input id="bq" placeholder="Search job, client, brief…" value="${esc(bf.q)}"></div>
    <select class="sel" id="bstage"><option value="">All stages</option>${STAGES.map(s=>`<option ${bf.stage===s?'selected':''}>${s}</option>`).join('')}</select>
    ${(bf.q||bf.stage)?'<button class="btn sm" id="bclear">Clear</button>':''}
  </div>`;
  if(!list.length){ html+=`<div class="card empty">${icon('grid')}<b>No jobs match</b></div>`; C.innerHTML=html; wireBoardFilters(); return; }

  STAGES.forEach(stg=>{
    const rows=list.filter(j=>j.stage===stg); if(!rows.length)return;
    html+=`<div class="boardsec"><div class="boardbar bg-${STAGE_CLS[stg]}">${stg}<span class="count">${rows.length}</span></div>
      <table class="jobtable"><thead><tr>
        <th>Job No.</th><th>Client / Brief</th><th>Assigned</th><th>Task</th><th>Due</th>
        ${money?'<th style="text-align:right">Billing</th><th style="text-align:right">Profit</th>':''}<th></th></tr></thead>
      <tbody>${rows.map(j=>boardRow(j,money)).join('')}</tbody></table></div>`;
  });
  C.innerHTML=html;
  wireBoardFilters();
  C.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>jobDetailModal(b.dataset.open));
  C.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>assignModal(jobs.find(j=>j.id==b.dataset.assign),people));
  C.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>jobModal(jobs.find(j=>j.id==b.dataset.edit)));
  C.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(confirm('Delete this job?')){ await api('DELETE','/jobs/'+b.dataset.del); renderView(); }});
  C.querySelectorAll('[data-stage]').forEach(b=>b.onclick=async()=>{
    const [id,stage]=b.dataset.stage.split('|');
    try{ await api('POST',`/jobs/${id}/stage`,{stage}); renderView(); }catch(e){toast(e.message,true);} });
}
function boardRow(j,money){
  const tc=TASK_COLORS[j.task]||['var(--surface2)','var(--ink2)'];
  const tags=j.assignees.map(a=>`<span class="ptag"><b>${esc(a.role_on_job||a.craft||'')}</b>${esc(a.name)}</span>`).join('')||'<span class="ptag">—</span>';
  const i=STAGES.indexOf(j.stage); const nextStage=STAGES[Math.min(i+1,4)];
  return `<tr class="jrow">
    <td><span class="jno linklike" data-open="${j.id}" title="Open details">${esc(j.job_no)}</span>${j.ref_no?`<span class="ref">(${esc(j.ref_no)})</span>`:''}</td>
    <td class="jdesc"><span class="cl">${esc(j.client)}</span>${esc(j.brief)}
      <div class="jindic">
        ${(j.teams&&j.teams.length?j.teams:(j.team?[{name:j.team}]:[])).map(t=>`<span class="teamtag">${esc(t.name)}</span>`).join('')}
        ${j.workflow_stage?`<span class="metachip">${esc(j.workflow_stage)}</span>`:''}
        ${j.subtasks_total?`<span class="metachip">${icon('check')}${j.subtasks_done}/${j.subtasks_total}</span>`:''}
        ${j.attachments?`<span class="metachip">${icon('paperclip')}${j.attachments}</span>`:''}
        ${j.open_issues?`<span class="blockchip" title="${j.open_issues} open issue${j.open_issues>1?'s':''}">${icon('flag')}${j.open_issues}</span>`:''}
        ${j.approval_stage&&j.approval_stage!=='none'?`<span class="appchip app-${j.approval_stage}">${esc(APP_LABEL[j.approval_stage]||j.approval_stage)}</span>`:''}
      </div></td>
    <td><div class="assign">${tags}</div></td>
    <td>${j.task?`<span class="tasktag" style="background:${tc[0]};color:${tc[1]}">${esc(j.task)}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
    <td style="white-space:nowrap;color:var(--ink2)">${fmtDate(j.due_date)}</td>
    ${money?`<td class="money">${INR(j.billing)}</td>
      <td class="profitcell ${j.profit>=0?'pos':'neg'}">${INR(j.profit)}<small>${j.hours?j.hours+'h · '+INRk(j.cost):'no time'}</small></td>`:''}
    <td><div class="rowact">
      <button class="icon-btn" title="Details" data-open="${j.id}">${icon('layers')}</button>
      ${hasCap('manage_jobs')?`<button class="icon-btn" title="Assign" data-assign="${j.id}">${icon('userplus')}</button>`:''}
      ${(isBackend()||ME.role==='team_lead')&&j.stage!=='Done'&&j.stage!=='Approved'?`<button class="icon-btn" title="Advance to ${nextStage}" data-stage="${j.id}|${nextStage}">${icon('arrow')}</button>`:''}
      ${isBackend()?`<button class="icon-btn" title="Edit" data-edit="${j.id}">${icon('edit')}</button>
        <button class="icon-btn" title="Delete" data-del="${j.id}">${icon('trash')}</button>`:''}
    </div></td></tr>`;
}
function wireBoardFilters(){
  const q=document.getElementById('bq');
  if(q)q.oninput=e=>{bf.q=e.target.value; const p=q.selectionStart; renderView(); setTimeout(()=>{const n=document.getElementById('bq'); if(n){n.focus();n.setSelectionRange(p,p);}},0);};
  const s=document.getElementById('bstage'); if(s)s.onchange=e=>{bf.stage=e.target.value;renderView();};
  const c=document.getElementById('bclear'); if(c)c.onclick=()=>{bf={q:'',stage:''};renderView();};
}

async function assignModal(job, people){
  if(!people||!people.length){ try{people=await api('GET','/people');}catch{people=[];} }
  const assignedIds=new Set(job.assignees.map(a=>a.id));
  const avail=people.filter(p=>!assignedIds.has(p.id));
  modal(`Assign — ${esc(job.job_no)}`, `
    <div style="margin-bottom:14px">
      <div class="field" style="margin-bottom:6px"><label>Currently assigned</label></div>
      <div class="assign" id="curAssign">${job.assignees.map(a=>`<span class="ptag"><b>${esc(a.craft||'')}</b>${esc(a.name)}
        <button data-unassign="${a.id}" style="margin-left:5px;color:var(--red);font-weight:700">×</button></span>`).join('')||'<span style="color:var(--muted)">Nobody yet</span>'}</div>
    </div>
    <div class="formgrid">
      <div class="field"><label>Add person</label><select id="a_user">${avail.map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.job_role||p.role)}${p.teams?' · '+esc(p.teams):''}</option>`).join('')||'<option value="">No one available</option>'}</select></div>
      <div class="field"><label>Role on job</label><select id="a_role">${['AM','Copy','Art','Studio','Strategy','Artworking'].map(r=>`<option>${r}</option>`).join('')}</select></div>
    </div>`,
    'Add to job', async()=>{
      const uid=document.getElementById('a_user').value; if(!uid){return true;}
      await api('POST',`/jobs/${job.id}/assign`,{user_id:+uid, role_on_job:document.getElementById('a_role').value});
      toast('Assigned'); renderView(); return true;
    });
  document.querySelectorAll('[data-unassign]').forEach(b=>b.onclick=async()=>{
    await api('POST',`/jobs/${job.id}/unassign`,{user_id:+b.dataset.unassign}); closeModal(); renderView();
  });
}

async function customDefs(entity){ try{ return await api('GET','/custom-fields?entity='+entity); }catch{ return []; } }
function cfInput(f,v){
  v=v==null?'':v;
  if(f.type==='textarea') return `<textarea id="cf_${f.field_key}">${esc(v)}</textarea>`;
  if(f.type==='number') return `<input id="cf_${f.field_key}" type="number" value="${esc(v)}">`;
  if(f.type==='date') return `<input id="cf_${f.field_key}" type="date" value="${esc(v)}">`;
  if(f.type==='select'){ const o=(f.options||'').split(',').map(s=>s.trim()).filter(Boolean); return `<select id="cf_${f.field_key}"><option value="">—</option>${o.map(x=>`<option ${v===x?'selected':''}>${esc(x)}</option>`).join('')}</select>`; }
  return `<input id="cf_${f.field_key}" value="${esc(v)}">`;
}
const customFieldsHtml=(defs,vals)=>defs.map(f=>`<div class="field ${f.type==='textarea'?'full':''}"><label>${esc(f.label)}</label>${cfInput(f,(vals||{})[f.field_key])}</div>`).join('');
function collectCustom(defs){ const c={}; defs.forEach(f=>{ const el=document.getElementById('cf_'+f.field_key); if(el)c[f.field_key]=el.value; }); return c; }

async function jobModal(job){
  const isNew=!job;
  let clients=[], verticals=[], teams=[], stages=[], cfDefs=[];
  try{ [clients,verticals,teams,stages,cfDefs]=await Promise.all([masters('clients'),masters('verticals'),masters('teams'),masters('stages'),customDefs('job')]); }catch{}
  job=job||{job_no:'',ref_no:'',client_id:'',vertical_id:'',team:'',stage:'Pipeline',workflow_stage_id:'',task:'Design',brief:'',billing:0,due_date:'',delivery_date:''};
  const clientOpts=`<option value="">— select client —</option>`+clients.map(c=>`<option value="${c.id}" data-v="${c.vertical_id||''}" ${job.client_id==c.id?'selected':''}>${esc(c.name)} · ${esc(c.type)}${c.status==='prospective'?' (prospective)':''}</option>`).join('');
  const vertOpts=`<option value="">—</option>`+verticals.map(v=>`<option value="${v.id}" ${job.vertical_id==v.id?'selected':''}>${esc(v.name)}</option>`).join('');
  const selTeams=new Set((job.team_ids||[]).map(Number));
  const teamChecks=teams.map(t=>`<label class="chk"><input type="checkbox" class="j_team_ck" value="${t.id}" ${selTeams.has(t.id)?'checked':''}><span>${esc(t.name)}</span></label>`).join('')||'<span class="muted">No teams yet — add them in Masters.</span>';
  const stageOpts=`<option value="">—</option>`+stages.map(s=>`<option value="${s.id}" ${job.workflow_stage_id==s.id?'selected':''}>${esc(s.name)}</option>`).join('')+`<option value="__add">＋ Add new stage…</option>`;
  modal(isNew?'New job':'Edit '+esc(job.job_no), `
    <div class="formgrid">
      ${isNew
        ? `<div class="field full"><label>Job number</label><div class="autonum">${icon('hash')}Auto-generated on save — <b>Year / Client No / Job No / Round</b> (e.g. 2026/0003/07/R1)</div></div>`
        : `<div class="field"><label>Job number</label><input value="${esc(job.job_no)}" disabled></div>
           <div class="field"><label>Round</label><input value="R${job.round||1}" disabled></div>`}
      <div class="field"><label>Client</label><select id="j_client">${clientOpts}</select><div class="help">Add clients in Masters → Clients</div></div>
      <div class="field"><label>Ref No. <span class="help">optional</span></label><input id="j_ref" value="${esc(job.ref_no||'')}"></div>
      <div class="field"><label>Vertical</label><select id="j_vert">${vertOpts}</select></div>
      <div class="field"><label>Task</label><select id="j_task"><option value="">—</option>${Object.keys(TASK_COLORS).map(t=>`<option ${job.task===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field full"><label>Teams <span class="help">pick one or more</span></label><div class="checkrow teamchecks">${teamChecks}</div></div>
      <div class="field"><label>Workflow stage</label><select id="j_wf">${stageOpts}</select></div>
      <div class="field full"><label>Brief</label><input id="j_brief" value="${esc(job.brief)}"></div>
      <div class="field"><label>Board stage</label><select id="j_stage">${STAGES.map(s=>`<option ${job.stage===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Due date</label><input id="j_date" type="date" value="${esc(job.due_date||'')}"></div>
      <div class="field"><label>Delivery date</label><input id="j_deliv" type="date" value="${esc(job.delivery_date||'')}"></div>
      ${isSuper()?`<div class="field"><label>Billing (₹)</label><input id="j_bill" type="number" min="0" step="500" value="${job.billing||0}"></div>`:''}
      ${cfDefs.length?`<div class="field full cfhdr"><span>Custom fields</span></div>${customFieldsHtml(cfDefs, job.custom)}`:''}
    </div>`,
    isNew?'Add job':'Save', async()=>{
      const body={ref_no:val('j_ref'),client_id:value('j_client')?+value('j_client'):null,
        vertical_id:value('j_vert')?+value('j_vert'):null,
        team_ids:Array.from(document.querySelectorAll('.j_team_ck:checked')).map(c=>+c.value),
        brief:val('j_brief'),task:value('j_task'),stage:value('j_stage'),
        workflow_stage_id:value('j_wf')&&value('j_wf')!=='__add'?+value('j_wf'):null,
        due_date:val('j_date'),delivery_date:val('j_deliv'),custom:collectCustom(cfDefs)};
      if(isSuper()) body.billing=+val('j_bill')||0;
      if(isNew) await api('POST','/jobs',body); else await api('PUT','/jobs/'+job.id,body);
      toast(isNew?'Job added':'Job saved'); renderView(); return true;
    }, 'wide');
  // auto-fill vertical from the chosen client
  const cl=document.getElementById('j_client');
  if(cl)cl.onchange=()=>{ const v=cl.options[cl.selectedIndex].dataset.v; if(v) document.getElementById('j_vert').value=v; };
  // extensible workflow-stage: choosing "add new" prompts and creates it
  const wf=document.getElementById('j_wf');
  if(wf)wf.onchange=async()=>{
    if(wf.value!=='__add') return;
    const name=(prompt('New workflow stage name:')||'').trim();
    if(!name){ wf.value=''; return; }
    try{ const r=await api('POST','/masters/stages',{name}); await masters('stages',true);
      const opt=document.createElement('option'); opt.value=r.id; opt.textContent=name;
      wf.insertBefore(opt, wf.querySelector('option[value="__add"]')); wf.value=r.id; toast('Stage added'); }
    catch(e){ toast(e.message,true); wf.value=''; }
  };
}

/* ============================================================
   Job detail — sub-tasks, attachments, brief history, rounds
   ============================================================ */
function fileToB64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]); r.onerror=rej; r.readAsDataURL(file); }); }
function fmtSize(n){ n=+n||0; if(n>=1048576)return (n/1048576).toFixed(1)+' MB'; if(n>=1024)return Math.round(n/1024)+' KB'; return n+' B'; }

async function jobDetailModal(jobOrId){
  const id = (jobOrId && typeof jobOrId==='object') ? jobOrId.id : jobOrId;
  let job, subs=[], atts=[], issues=[];
  try{ [job,subs,atts,issues]=await Promise.all([
    api('GET','/jobs/'+id), api('GET','/jobs/'+id+'/subtasks'), api('GET','/jobs/'+id+'/attachments'),
    api('GET','/issues?job_id='+id).catch(()=>[])]); }
  catch(e){ toast(e.message,true); return; }
  const canManage = isBackend() || ME.role==='team_lead';        // server enforces team ownership
  const assignedToMe = (job.assignees||[]).some(a=>a.id===ME.id);
  const canTouch = canManage || assignedToMe;
  const money=canMoney();
  const doneCount=subs.filter(s=>s.done).length;
  const reopen=()=>jobDetailModal(id);
  const body=`<div class="jd">
    <div class="jdhead">
      <div class="jdtitle"><span class="jno">${esc(job.job_no)}</span>
        <span class="ptag" style="text-transform:uppercase">${esc(job.client)}</span>
        ${job.workflow_stage?`<span class="tasktag" style="background:var(--blue-soft);color:var(--blue)">${esc(job.workflow_stage)}</span>`:''}
        <span class="appchip app-none">${esc(job.stage)}</span></div>
      <div style="font-weight:600;font-size:15px;margin-top:5px">${esc(job.brief||'—')}</div>
      <div class="jdmeta">${(job.teams&&job.teams.length?job.teams.map(t=>t.name).join(' + '):(job.team||'—'))} · Job date ${fmtDate(job.job_date)} · Due ${fmtDate(job.due_date)} · Delivery ${fmtDate(job.delivery_date)}${job.ref_no?` · Ref ${esc(job.ref_no)}`:''}${money&&job.billing!=null?` · Billing ${INR(job.billing)} · <b class="${job.profit>=0?'pos':'neg'}">${INR(job.profit)} profit</b>`:''}</div>
      <div style="margin-top:9px"><div class="assign">${(job.assignees||[]).map(a=>`<span class="ptag"><b>${esc(a.role_on_job||a.craft||'')}</b>${esc(a.name)}</span>`).join('')||'<span class="muted">No one assigned</span>'}</div></div>
    </div>

    <div class="jdsec">
      <div class="jdsectitle">Sub-tasks <span class="muted">${doneCount}/${subs.length}</span>
        ${canManage?`<button class="btn sm" id="addSub" style="margin-left:auto">${icon('plus')}Add</button>`:''}</div>
      <div class="subs">${subs.map(s=>`<div class="checkrow2">
        <input type="checkbox" data-sub="${s.id}" ${s.done?'checked':''} ${canTouch?'':'disabled'}>
        <span class="${s.done?'subdone':''}">${esc(s.title)}</span>
        ${s.assignee?`<span class="ptag" style="margin-left:auto">${esc(s.assignee)}</span>`:'<span style="margin-left:auto"></span>'}
        ${canManage?`<button class="icon-btn" data-subdel="${s.id}" title="Delete sub-task">${icon('trash')}</button>`:''}
      </div>`).join('')||'<div class="muted" style="padding:6px 2px">No sub-tasks yet.</div>'}</div>
    </div>

    <div class="jdsec">
      <div class="jdsectitle">Attachments <span class="muted">${atts.length}</span>
        ${canTouch?`<label class="btn sm" style="margin-left:auto;cursor:pointer">${icon('paperclip')}Upload<input type="file" id="attFile" hidden></label>`:''}</div>
      <div class="atts">${atts.map(a=>`<div class="attrow">${icon('file')}
        <a class="attname" href="/api/jobs/${id}/attachments/${a.id}/download">${esc(a.filename)}</a>
        <span class="muted">${fmtSize(a.size)}</span>
        ${(canManage||a.uploaded_by===ME.name)?`<button class="icon-btn" data-attdel="${a.id}" title="Remove">${icon('trash')}</button>`:''}
      </div>`).join('')||'<div class="muted" style="padding:6px 2px">No files attached.</div>'}</div>
    </div>

    <div class="jdsec">
      <div class="jdsectitle">Issues &amp; blockers <span class="muted">${issues.filter(i=>i.status==='open').length} open</span>
        ${canTouch?`<button class="btn sm" id="addIssue" style="margin-left:auto">${icon('flag')}Raise</button>`:''}</div>
      <div class="issues">${issues.map(i=>`<div class="issuerow sev-${i.severity} ${i.status}">
        <span class="sevdot"></span>
        <div class="issuebody">
          <div class="issuetop"><b>${esc(i.title)}</b>
            <span class="sevtag sev-${i.severity}">${esc(i.severity)}</span>
            ${i.status==='resolved'?'<span class="sevtag resolved">resolved</span>':''}</div>
          ${i.detail?`<div class="issuedetail">${esc(i.detail)}</div>`:''}
          <div class="issuemeta">${esc(i.raised_by_name||'—')}${i.assigned_to_name?` → ${esc(i.assigned_to_name)}`:''} · ${fmtWhen(i.created_at)}${i.status==='resolved'&&i.resolved_by_name?` · resolved by ${esc(i.resolved_by_name)}`:''}</div>
        </div>
        ${i.status==='open'&&canTouch?`<button class="btn sm" data-resolve="${i.id}">${icon('check')}Resolve</button>`:''}
        ${(canManage||i.raised_by===ME.id)?`<button class="icon-btn" data-issuedel="${i.id}" title="Delete">${icon('trash')}</button>`:''}
      </div>`).join('')||'<div class="muted" style="padding:6px 2px">No issues raised.</div>'}</div>
    </div>

    <div class="jdsec jdactions">
      <button class="btn sm" id="briefHist">${icon('history')}Brief history (${job.brief_versions||0})</button>
      ${hasCap('view_activity')?`<button class="btn sm" id="jobActivity">${icon('history')}Activity</button>`:''}
      ${canManage?`<button class="btn sm" id="newRound">${icon('repeat')}New round (R${(job.round||1)+1})</button>`:''}
    </div>
  </div>`;
  modal('Job — '+esc(job.job_no), body, '', null, 'wide');

  const add=document.getElementById('addSub');
  if(add)add.onclick=()=>{
    const people=(job.assignees||[]);
    modal('Add sub-task', `<div class="field full"><label>Title</label><input id="st_title" placeholder="e.g. First-cut layout"></div>
      <div class="field full"><label>Assignee <span class="help">optional</span></label><select id="st_who"><option value="">—</option>${people.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>`,
      'Add', async()=>{ const title=val('st_title'); if(!title)return true;
        await api('POST',`/jobs/${id}/subtasks`,{title,assignee_id:value('st_who')?+value('st_who'):null});
        toast('Sub-task added'); reopen(); return true; });
  };
  document.querySelectorAll('[data-sub]').forEach(cb=>cb.onchange=async()=>{
    try{ await api('PUT',`/jobs/${id}/subtasks/${cb.dataset.sub}`,{done:cb.checked}); }catch(e){ toast(e.message,true); }
    reopen();
  });
  document.querySelectorAll('[data-subdel]').forEach(b=>b.onclick=async()=>{
    try{ await api('DELETE',`/jobs/${id}/subtasks/${b.dataset.subdel}`); reopen(); }catch(e){ toast(e.message,true); }
  });
  const af=document.getElementById('attFile');
  if(af)af.onchange=async()=>{ const f=af.files[0]; if(!f)return;
    if(f.size>12*1024*1024){ toast('File too large (max 12 MB).',true); return; }
    try{ const content_b64=await fileToB64(f);
      await api('POST',`/jobs/${id}/attachments`,{filename:f.name,mime:f.type||'application/octet-stream',content_b64});
      toast('Uploaded'); reopen(); }catch(e){ toast(e.message,true); }
  };
  document.querySelectorAll('[data-attdel]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Remove this file?'))return;
    try{ await api('DELETE',`/jobs/${id}/attachments/${b.dataset.attdel}`); reopen(); }catch(e){ toast(e.message,true); }
  });
  const bh=document.getElementById('briefHist'); if(bh)bh.onclick=()=>briefHistoryModal(id);
  const ja=document.getElementById('jobActivity'); if(ja)ja.onclick=()=>jobActivityModal(id, job.job_no);
  const ai=document.getElementById('addIssue');
  if(ai)ai.onclick=()=>{
    const people=(job.assignees||[]);
    modal('Raise an issue', `
      <div class="field full"><label>Title</label><input id="is_title" placeholder="e.g. Awaiting client logo files"></div>
      <div class="field full"><label>Details <span class="help">optional</span></label><textarea id="is_detail" placeholder="What's blocking, and what's needed to clear it?"></textarea></div>
      <div class="field"><label>Severity</label><select id="is_sev"><option value="blocker">Blocker</option><option value="issue">Issue</option><option value="note">Note</option></select></div>
      <div class="field"><label>Owner <span class="help">optional</span></label><select id="is_who"><option value="">—</option>${people.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>`,
      'Raise', async()=>{ const title=val('is_title'); if(!title)return true;
        await api('POST','/issues',{job_id:id,title,detail:val('is_detail'),severity:value('is_sev'),assigned_to:value('is_who')?+value('is_who'):null});
        toast('Issue raised'); reopen(); return true; });
  };
  document.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{
    try{ await api('POST','/issues/'+b.dataset.resolve+'/resolve'); toast('Resolved'); reopen(); }catch(e){ toast(e.message,true); }
  });
  document.querySelectorAll('[data-issuedel]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Delete this issue?'))return;
    try{ await api('DELETE','/issues/'+b.dataset.issuedel); reopen(); }catch(e){ toast(e.message,true); }
  });
  const nr=document.getElementById('newRound');
  if(nr)nr.onclick=async()=>{
    if(!confirm('Start a new round? This bumps the round number and reopens the job as Pending for rework.'))return;
    try{ await api('POST',`/jobs/${id}/round`); toast('New round started'); renderView(); reopen(); }
    catch(e){ toast(e.message,true); }
  };
}

async function jobActivityModal(id, jobNo){
  let rows=[]; try{ rows=await api('GET','/activity?job_id='+id); }catch(e){ toast(e.message,true); return; }
  const body = rows.length
    ? `<div class="card" style="overflow:hidden"><div class="actlog">${rows.map(r=>actRow(r)).join('')}</div></div>`
    : '<div class="muted" style="padding:8px">No activity recorded for this job yet.</div>';
  modal('Activity — '+esc(jobNo||''), body, '', null, 'wide');
}

async function briefHistoryModal(id){
  let vers=[]; try{ vers=await api('GET','/jobs/'+id+'/brief-versions'); }catch(e){ toast(e.message,true); return; }
  const body = vers.length
    ? `<div class="briefhist">${vers.map((v,i)=>`<div class="bh">
        <div class="bhmeta">${i===0?'<span class="ptag" style="background:var(--green-soft);color:var(--green2)">current</span> ':''}${esc(v.edited_by||'—')} · ${fmtWhen(v.created_at)}</div>
        <div class="bhtext">${esc(v.brief||'(empty)')}</div></div>`).join('')}</div>`
    : '<div class="muted" style="padding:8px">No brief history yet.</div>';
  modal('Brief history', body, '', null, 'wide');
}


async function viewApprovals(C){
  let q;
  try{ q=await api('GET','/approvals/queue'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const money=canMoney();
  const levelLabel={team_lead:'You are the first sign-off for your team.',admin:'You sign off after team leads.',super_admin:'Final sign-off before a job is closed.'}[ME.role];
  if(!q.length){ C.innerHTML=`<div class="note info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>${esc(levelLabel||'')}</div>
    <div class="card empty">${icon('flag')}<b>Queue is clear</b>No jobs waiting on your approval.</div>`; return; }
  C.innerHTML=`<div class="note info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>${esc(levelLabel||'')}</div>`
    + q.map(j=>approvalCard(j,money)).join('');
  C.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>jobDetailModal(b.dataset.open));
  C.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{
    try{ await api('POST',`/approvals/${b.dataset.approve}/approve`); toast('Approved'); renderView(); refreshApprovalBadge(); }catch(e){toast(e.message,true);} });
  C.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.reject;
    modal('Send back for rework',`<div class="field full"><label>Reason</label><textarea id="rj_note" placeholder="What needs fixing?"></textarea></div>`,
      'Reject', async()=>{ await api('POST',`/approvals/${id}/reject`,{note:document.getElementById('rj_note').value||'Sent back for rework.'});
        toast('Sent back'); renderView(); refreshApprovalBadge(); return true; });
  });
}
function approvalCard(j,money){
  const ts=(j.timesheet||[]);
  const totalH=ts.reduce((s,t)=>s+t.hours,0);
  return `<div class="card" style="padding:16px 18px;margin-bottom:12px">
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:240px">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:4px">
          <span class="jno">${esc(j.job_no)}</span><span class="ptag" style="text-transform:uppercase">${esc(j.client)}</span>
          ${j.task?`<span class="tasktag" style="background:var(--blue-soft);color:var(--blue)">${esc(j.task)}</span>`:''}
        </div>
        <div style="font-weight:600;font-size:15px">${esc(j.brief)}</div>
        <div style="margin-top:8px"><div class="assign">${j.assignees.map(a=>`<span class="ptag"><b>${esc(a.craft||'')}</b>${esc(a.name)}</span>`).join('')}</div></div>
        ${ts.length?`<div style="margin-top:12px;border-top:1px dashed var(--line);padding-top:10px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;margin-bottom:6px">Timesheet · ${totalH}h total</div>
          ${ts.map(t=>`<div style="display:flex;gap:10px;font-size:12.5px;padding:2px 0"><span class="mono" style="min-width:40px;font-weight:600">${t.hours}h</span><span>${esc(t.name)}</span><span style="color:var(--muted)">${fmtDate(t.work_date)}</span></div>`).join('')}
        </div>`:`<div style="margin-top:10px;font-size:12px;color:var(--muted)">No timesheet logged.</div>`}
        ${money?`<div style="margin-top:10px;font-family:'JetBrains Mono';font-size:12.5px">Billing ${INR(j.billing)} · Cost ${INR(j.cost)} · <b class="${j.profit>=0?'pos':'neg'}">${INR(j.profit)} profit</b></div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        <span class="appchip app-${j.approval_stage}">${esc(APP_LABEL[j.approval_stage])}</span>
        ${j.attachments?`<span class="metachip">${icon('paperclip')}${j.attachments} file${j.attachments>1?'s':''}</span>`:''}
        <div style="display:flex;gap:7px">
          <button class="btn sm" data-open="${j.id}">${icon('layers')}Files & details</button>
          <button class="btn sm danger" data-reject="${j.id}">${icon('x')}Reject</button>
          <button class="btn sm ok pri" data-approve="${j.id}" style="background:var(--green);color:#fff;border-color:var(--green)">${icon('check')}Approve</button>
        </div>
      </div>
    </div></div>`;
}

/* ============================================================
   View: Dashboard (super admin only)
   ============================================================ */
let finVertical=null, finPeriod={kind:'all',date:null}, finType='all';
function periodQS(){ return `&period=${finPeriod.kind}${finPeriod.date?'&date='+encodeURIComponent(finPeriod.date):''}`; }
const REP_YEARS=(()=>{ const y=new Date().getFullYear(); return [y-2,y-1,y]; })();
function periodControl(){
  return `<div class="periodctl">
    <div class="seg">
      <button data-pk="all" class="${finPeriod.kind==='all'?'on':''}">All time</button>
      <button data-pk="year" class="${finPeriod.kind==='year'?'on':''}">Year</button>
      <button data-pk="month" class="${finPeriod.kind==='month'?'on':''}">Month</button>
    </div>
    ${finPeriod.kind==='year'?`<select class="sel" id="pYear">${REP_YEARS.map(y=>`<option ${String(finPeriod.date)===String(y)?'selected':''}>${y}</option>`).join('')}</select>`:''}
    ${finPeriod.kind==='month'?`<input type="month" class="sel" id="pMonth" value="${esc(finPeriod.date||'')}">`:''}
  </div>`;
}
function wirePeriod(){
  document.querySelectorAll('[data-pk]').forEach(b=>b.onclick=()=>{
    finPeriod.kind=b.dataset.pk;
    finPeriod.date = b.dataset.pk==='year' ? String(new Date().getFullYear())
      : b.dataset.pk==='month' ? '' : null;
    renderView();
  });
  const y=document.getElementById('pYear'); if(y)y.onchange=()=>{finPeriod.date=y.value; renderView();};
  const m=document.getElementById('pMonth'); if(m)m.onchange=()=>{finPeriod.date=m.value; renderView();};
}
async function viewDashboard(C){
  if(!canMoney()){ C.innerHTML=presentBanner()+`<div class="card empty">${icon('eyeoff')}<b>Financials are hidden</b>Turn off presentation mode in the top bar to view the dashboard.</div>`; return; }
  const q=`?period=${finPeriod.kind}${finPeriod.date?'&date='+encodeURIComponent(finPeriod.date):''}${finVertical?'&vertical_id='+finVertical:''}`;
  let d; try{ d=await api('GET','/finance/dashboard'+q); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const maxMv=Math.max(d.billing,d.cost,1);
  const topBill=[...d.clients].sort((a,b)=>b.billing-a.billing).slice(0,6);
  const maxBill=Math.max(...topBill.map(c=>c.billing),1);
  const topProfit=[...d.clients].sort((a,b)=>b.profit-a.profit).slice(0,5);
  const maxP=Math.max(...topProfit.map(c=>Math.max(0,c.profit)),1);
  C.innerHTML=`
  ${PRESENT_MODE&&isSuper()?presentBanner():''}
  <div class="repbar">
    ${periodControl()}
    <div class="sp"></div>
    <span class="periodtag">${esc(d.period_label)}</span>
    <select class="sel" id="finV"><option value="">All verticals</option>${(d.verticals||[]).map(v=>`<option value="${v.id}" ${finVertical==v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select>
  </div>
  <div class="grid kpis">
    ${kpi('Total billing',INRk(d.billing),d.jobs+' jobs','var(--green2)')}
    ${kpi('Manpower cost',INRk(d.cost),d.hours+' hrs logged','var(--amber)')}
    ${kpi('Gross profit',INRk(d.profit),'',d.profit>=0?'var(--green2)':'var(--red)',d.profit>=0?'pos':'neg')}
    ${kpi('Margin',d.margin.toFixed(0)+'<small>%</small>','billing − manpower','var(--violet)')}
    ${kpi('Active jobs',d.active,(d.jobs-d.active)+' closed','var(--blue)')}
    ${kpi('Hours logged',d.hours,'studio-wide','var(--slate)')}
  </div>
  <div class="sechead"><h2>Manpower vs total billing</h2><div class="sp"></div><span class="hint">Cost = logged hours × each rate on the day worked</span></div>
  <div class="card mvb">
    <div class="row"><div class="tag"><span class="dot" style="background:var(--green2)"></span>Total billing</div><div class="amt">${INR(d.billing)}</div></div>
    <div class="track"><div class="fill bill" style="width:${d.billing/maxMv*100}%"></div></div>
    <div class="row"><div class="tag"><span class="dot" style="background:var(--amber)"></span>Manpower cost</div><div class="amt">${INR(d.cost)}</div></div>
    <div class="track"><div class="fill cost" style="width:${d.cost/maxMv*100}%"></div></div>
    <div class="summ">
      <div><span>Gross profit</span><b class="${d.profit>=0?'pos':'neg'}">${INR(d.profit)}</b></div>
      <div><span>Margin</span><b class="${d.profit>=0?'pos':'neg'}">${d.margin.toFixed(1)}%</b></div>
      <div><span>Cost % of billing</span><b>${d.billing?(d.cost/d.billing*100).toFixed(1):0}%</b></div>
      <div><span>Avg cost / hour</span><b>${d.hours?INR(d.cost/d.hours):INR(0)}</b></div>
    </div>
  </div>
  <div class="split" style="margin-top:24px">
    <div class="card"><div class="minihead">Billing by client</div><div class="minisub">Top accounts by booked revenue</div>
      <div class="barlist">${topBill.map(c=>`<div class="barrow"><div class="nm">${esc(c.client)}</div><div class="bar"><i style="width:${c.billing/maxBill*100}%"></i></div><div class="v">${INRk(c.billing)}</div></div>`).join('')||'<div style="color:var(--muted);padding:8px">No data.</div>'}</div></div>
    <div class="card"><div class="minihead">Most profitable clients</div><div class="minisub">Billing minus logged manpower</div>
      <div class="barlist">${topProfit.map(c=>`<div class="barrow"><div class="nm">${esc(c.client)}</div><div class="bar"><i style="width:${Math.max(0,c.profit)/maxP*100}%;background:${c.profit>=0?'var(--green2)':'var(--red)'}"></i></div><div class="v ${c.profit>=0?'pos':'neg'}">${INRk(c.profit)}</div></div>`).join('')||'<div style="color:var(--muted);padding:8px">No data.</div>'}</div></div>
  </div>
  <div class="sechead"><h2>Jobs by stage</h2></div>
  <div class="card"><div class="stagegrid">
    ${STAGES.map(s=>`<div class="stagecell"><div class="n">${d.stageCount[s]||0}</div><div class="l"><span class="dot" style="background:${STAGE_COLOR[s]}"></span>${s}</div></div>`).join('')}
  </div></div>`;
  document.getElementById('finV').onchange=e=>{finVertical=e.target.value||null; renderView();};
  wirePeriod();
  const mi=document.getElementById('pMonth'); if(mi&&!mi.value&&d.period_key)mi.value=d.period_key;
}

/* ============================================================
   View: P&L (super admin only)
   ============================================================ */
let pnlMode='client',pnlSort={key:'profit',dir:-1};
async function viewPnl(C){
  if(!canMoney()){ C.innerHTML=presentBanner()+`<div class="card empty">${icon('eyeoff')}<b>Financials are hidden</b>Turn off presentation mode in the top bar to view P&L.</div>`; return; }
  const vq=(pnlMode!=='vertical'&&finVertical)?`&vertical_id=${finVertical}`:'';
  const tq=(finType!=='all')?`&type=${finType}`:'';
  let res; try{ res=await api('GET','/finance/pnl?mode='+pnlMode+vq+tq+periodQS()); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  let verticals=[]; try{ verticals=await masters('verticals'); }catch{}
  let rows=res.rows;
  const k=pnlSort.key;
  rows.sort((a,b)=>typeof a[k]==='string'?String(a[k]).localeCompare(String(b[k]))*pnlSort.dir:((a[k]||0)-(b[k]||0))*pnlSort.dir);
  const tot=rows.reduce((s,r)=>({billing:s.billing+r.billing,cost:s.cost+r.cost,profit:s.profit+r.profit,hours:s.hours+(r.hours||0)}),{billing:0,cost:0,profit:0,hours:0});
  const maxBill=Math.max(...rows.map(r=>r.billing),1);
  const th=(key,label)=>`<th class="r" data-sort="${key}">${label}</th>`;
  const firstLabel=pnlMode==='client'?'Client':pnlMode==='job'?'Job':'Vertical';
  C.innerHTML=`<div class="repbar">${periodControl()}<div class="sp"></div><span class="periodtag">${esc(res.period_label||'Since inception')}</span></div>
  <div class="filters" style="justify-content:space-between">
    <div class="seg"><button class="${pnlMode==='client'?'on':''}" data-mode="client">By client</button><button class="${pnlMode==='job'?'on':''}" data-mode="job">By job</button><button class="${pnlMode==='vertical'?'on':''}" data-mode="vertical">By vertical</button></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div class="seg"><button class="${finType==='all'?'on':''}" data-type="all">All</button><button class="${finType==='project'?'on':''}" data-type="project">Projects</button><button class="${finType==='retainership'?'on':''}" data-type="retainership">Retainerships</button></div>
      ${pnlMode!=='vertical'?`<select class="sel" id="pnlV"><option value="">All verticals</option>${verticals.map(v=>`<option value="${v.id}" ${finVertical==v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select>`:''}
    </div></div>
  <div class="hint" style="color:var(--muted);margin:-4px 2px 10px">Profit = billing − (hours × the cost rate in effect on each day worked)</div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th data-sort="name">${firstLabel}</th>
      ${pnlMode==='job'?'<th>Client</th>':th('jobs','Jobs')}
      ${th('billing','Billing')}${th('hours','Hours')}${th('cost','Manpower')}${th('profit','Profit')}${th('margin','Margin')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td><div style="font-weight:600">${esc(r.name)}</div>${pnlMode==='job'&&r.sub?`<div style="color:var(--muted);font-size:12px">${esc(truncate(r.sub,46))}</div>`:''}
        <div class="bar-inline"><i style="width:${r.billing/maxBill*100}%;background:var(--green2)"></i></div></td>
      ${pnlMode==='job'?`<td>${esc(r.client)}</td>`:`<td class="r mono">${r.jobs}</td>`}
      <td class="r mono">${INR(r.billing)}</td><td class="r mono">${r.hours||0}</td>
      <td class="r mono" style="color:var(--amber)">${INR(r.cost)}</td>
      <td class="r mono ${r.profit>=0?'pos':'neg'}" style="font-weight:700">${INR(r.profit)}</td>
      <td class="r mono ${r.margin>=0?'pos':'neg'}">${r.margin.toFixed(0)}%</td></tr>`).join('')||`<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No data.</td></tr>`}</tbody>
    <tfoot><tr><td>Total</td>${pnlMode==='job'?'<td></td>':`<td class="r mono">${rows.reduce((s,r)=>s+(r.jobs||0),0)}</td>`}
      <td class="r mono">${INR(tot.billing)}</td><td class="r mono">${tot.hours}</td>
      <td class="r mono" style="color:var(--amber)">${INR(tot.cost)}</td>
      <td class="r mono ${tot.profit>=0?'pos':'neg'}">${INR(tot.profit)}</td>
      <td class="r mono">${tot.billing?(tot.profit/tot.billing*100).toFixed(0):0}%</td></tr></tfoot>
  </table></div>`;
  C.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{pnlMode=b.dataset.mode;renderView();});
  C.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{finType=b.dataset.type;renderView();});
  C.querySelectorAll('[data-sort]').forEach(h=>h.onclick=()=>{const key=h.dataset.sort; if(pnlSort.key===key)pnlSort.dir*=-1; else{pnlSort.key=key;pnlSort.dir=-1;} renderView();});
  const pv=document.getElementById('pnlV'); if(pv)pv.onchange=e=>{finVertical=e.target.value||null; renderView();};
  wirePeriod();
  const mi=document.getElementById('pMonth'); if(mi&&!mi.value&&res.period_key)mi.value=res.period_key;
}

/* ============================================================
   View: Reports — team bandwidth & year-on-year (super only)
   ============================================================ */
let rTab='bandwidth';
function reReports(){ viewReports(document.getElementById('content')); }
function utilColor(u){ return u>100?'var(--red)':u>=70?'var(--green2)':u>=40?'var(--blue)':u>=15?'var(--amber)':'var(--slate)'; }
async function viewReports(C){
  if(!canMoney()){ C.innerHTML=presentBanner()+`<div class="card empty">${icon('eyeoff')}<b>Financials are hidden</b>Turn off presentation mode in the top bar to view reports.</div>`; return; }
  C.innerHTML=`<div class="mtabs"><button class="${rTab==='bandwidth'?'on':''}" data-rt="bandwidth">Team bandwidth</button><button class="${rTab==='yoy'?'on':''}" data-rt="yoy">Year-on-year</button></div>
    <div id="rhost"><div style="padding:40px;text-align:center"><span class="spin"></span></div></div>`;
  C.querySelectorAll('[data-rt]').forEach(b=>b.onclick=()=>{rTab=b.dataset.rt; viewReports(C);});
  const host=document.getElementById('rhost');
  if(rTab==='bandwidth') await reportsBandwidth(host); else await reportsYoY(host);
}
async function reportsBandwidth(host){
  const q=`?period=${finPeriod.kind}${finPeriod.date?'&date='+encodeURIComponent(finPeriod.date):''}${finVertical?'&vertical_id='+finVertical:''}`;
  let d; try{ d=await api('GET','/finance/bandwidth'+q); }catch(e){ host.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  host.innerHTML=`<div class="repbar">${periodControl()}<div class="sp"></div><span class="periodtag">${esc(d.label)}</span>
    <select class="sel" id="bV"><option value="">All verticals</option>${(d.verticals||[]).map(v=>`<option value="${v.id}" ${finVertical==v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
   <div class="grid kpis" style="margin-bottom:18px">
    ${kpi('Available hours',d.totals.available,d.working_days+' working days × '+d.hours_per_day+'h','var(--blue)')}
    ${kpi('Logged hours',d.totals.logged.toFixed(0),'across '+d.rows.length+' people','var(--green2)')}
    ${kpi('Utilisation',d.totals.utilisation.toFixed(1)+'<small>%</small>','logged ÷ available','var(--violet)')}
   </div>
   <div class="card" style="overflow:hidden"><table class="dtable">
     <thead><tr><th>Person</th><th>Team</th><th class="r">Available</th><th class="r">Logged</th><th style="width:38%">Utilisation</th></tr></thead>
     <tbody>${d.rows.map(r=>`<tr>
       <td style="font-weight:600">${esc(r.name)}<div style="color:var(--muted);font-size:11.5px">${esc(r.craft||'')}</div></td>
       <td>${esc(r.team)}</td>
       <td class="r mono">${r.available}</td>
       <td class="r mono">${r.logged.toFixed(1)}</td>
       <td><div class="utilbar"><i style="width:${Math.min(100,r.utilisation)}%;background:${utilColor(r.utilisation)}"></i><span>${r.utilisation.toFixed(1)}%</span></div></td></tr>`).join('')||`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No one logged time in this period.</td></tr>`}</tbody>
   </table></div>
   <div class="hint" style="color:var(--muted);margin-top:8px">Available = working days in the period × ${d.hours_per_day}h per person. Utilisation = logged ÷ available. Leave and holidays aren't subtracted yet.</div>`;
  const bv=document.getElementById('bV'); if(bv)bv.onchange=e=>{finVertical=e.target.value||null; reReports();};
  wirePeriod();
  const mi=document.getElementById('pMonth'); if(mi&&!mi.value&&d.period_key)mi.value=d.period_key;
}
async function reportsYoY(host){
  const q=`${finVertical?'?vertical_id='+finVertical:''}${finType!=='all'?(finVertical?'&':'?')+'type='+finType:''}`;
  let d; try{ d=await api('GET','/finance/yoy'+q); }catch(e){ host.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const rows=d.rows;
  host.innerHTML=`<div class="repbar">
    <div class="seg"><button class="${finType==='all'?'on':''}" data-type="all">All</button><button class="${finType==='project'?'on':''}" data-type="project">Projects</button><button class="${finType==='retainership'?'on':''}" data-type="retainership">Retainerships</button></div>
    <div class="sp"></div><select class="sel" id="yV"><option value="">All verticals</option>${(d.verticals||[]).map(v=>`<option value="${v.id}" ${finVertical==v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
   ${!rows.length?`<div class="card empty">${icon('trend')}<b>No data for this filter</b></div>`:`
   <div class="yoygrid">${rows.map((r,i)=>{ const prev=rows[i-1]; const dB=prev?((r.billing-prev.billing)/(prev.billing||1)*100):null;
     return `<div class="card yoycard">
       <div class="yoyyear">${r.year}</div>
       <div class="yoybill">${INRk(r.billing)}</div>
       <div class="yoysub">${r.jobs} jobs · ${r.margin.toFixed(0)}% margin</div>
       ${dB!=null?`<div class="yoydelta ${dB>=0?'pos':'neg'}">${dB>=0?'▲':'▼'} ${Math.abs(dB).toFixed(0)}% billing vs ${prev.year}</div>`:`<div class="yoydelta muted">baseline year</div>`}
       <div class="yoybars">
         <div class="yb"><span>Projects</span><div class="bar"><i style="width:${r.billing?r.project/r.billing*100:0}%;background:var(--blue)"></i></div><b>${INRk(r.project)}</b></div>
         <div class="yb"><span>Retainers</span><div class="bar"><i style="width:${r.billing?r.retainership/r.billing*100:0}%;background:var(--violet)"></i></div><b>${INRk(r.retainership)}</b></div>
       </div>
       <div class="yoyfoot"><span>Cost ${INRk(r.cost)}</span><b class="${r.profit>=0?'pos':'neg'}">${INRk(r.profit)} profit</b></div>
     </div>`; }).join('')}</div>
   <div class="card" style="margin-top:18px;overflow:hidden"><table class="dtable">
     <thead><tr><th>Year</th><th class="r">Jobs</th><th class="r">Billing</th><th class="r">Manpower</th><th class="r">Profit</th><th class="r">Margin</th><th class="r">Hours</th></tr></thead>
     <tbody>${rows.map(r=>`<tr><td style="font-weight:600">${r.year}</td><td class="r mono">${r.jobs}</td><td class="r mono">${INR(r.billing)}</td><td class="r mono" style="color:var(--amber)">${INR(r.cost)}</td><td class="r mono ${r.profit>=0?'pos':'neg'}" style="font-weight:700">${INR(r.profit)}</td><td class="r mono">${r.margin.toFixed(0)}%</td><td class="r mono">${r.hours}</td></tr>`).join('')}</tbody>
   </table></div>`}`;
  host.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{finType=b.dataset.type; reReports();});
  const yv=document.getElementById('yV'); if(yv)yv.onchange=e=>{finVertical=e.target.value||null; reReports();};
}

/* ============================================================
   View: Activity — the audit trail (view_activity capability)
   ============================================================ */
let actFilter={job_id:'',user_id:'',action:'',from:'',to:''};
const ACT_BADGE={created:'var(--green2)',updated:'var(--blue)',deleted:'var(--red)',assigned:'var(--blue)',
  unassigned:'var(--slate)',stage:'var(--amber)',submitted:'var(--violet)',approved:'var(--green2)',
  rejected:'var(--red)',round:'var(--violet)',raised:'var(--red)',resolved:'var(--green2)'};
async function viewActivity(C){
  let filters={users:[],actions:[]}; try{ filters=await api('GET','/activity/filters'); }catch{}
  const qs=Object.entries(actFilter).filter(([,v])=>v).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
  let rows; try{ rows=await api('GET','/activity'+(qs?'?'+qs:'')); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  C.innerHTML=`<div class="filters" style="flex-wrap:wrap;gap:10px">
    <select class="sel" id="afU"><option value="">Everyone</option>${filters.users.map(u=>`<option value="${u.id}" ${actFilter.user_id==u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select>
    <select class="sel" id="afA"><option value="">All actions</option>${filters.actions.map(a=>`<option value="${a}" ${actFilter.action===a?'selected':''}>${esc(a)}</option>`).join('')}</select>
    <label class="afdate">From <input type="date" id="afF" value="${actFilter.from}"></label>
    <label class="afdate">To <input type="date" id="afT" value="${actFilter.to}"></label>
    ${Object.values(actFilter).some(v=>v)?'<button class="btn sm" id="afClear">Clear</button>':''}
    <div class="sp"></div><span class="hint" style="color:var(--muted)">${rows.length} event${rows.length===1?'':'s'}</span>
  </div>
  ${!rows.length?`<div class="card empty">${icon('history')}<b>No activity for this filter</b></div>`:
   `<div class="card" style="overflow:hidden"><div class="actlog">${rows.map(r=>actRow(r)).join('')}</div></div>`}`;
  const u=document.getElementById('afU'); if(u)u.onchange=()=>{actFilter.user_id=u.value;renderView();};
  const a=document.getElementById('afA'); if(a)a.onchange=()=>{actFilter.action=a.value;renderView();};
  const f=document.getElementById('afF'); if(f)f.onchange=()=>{actFilter.from=f.value;renderView();};
  const t=document.getElementById('afT'); if(t)t.onchange=()=>{actFilter.to=t.value;renderView();};
  const cl=document.getElementById('afClear'); if(cl)cl.onclick=()=>{actFilter={job_id:'',user_id:'',action:'',from:'',to:''};renderView();};
  C.querySelectorAll('[data-openjob]').forEach(b=>b.onclick=()=>jobDetailModal(b.dataset.openjob));
}
function actRow(r){
  const col=ACT_BADGE[r.action]||'var(--slate)';
  const change=r.field?`<span class="actfield">${esc(r.field)}</span>${r.old_value?`<span class="acto">${esc(r.old_value)}</span>→`:''}${r.new_value?`<span class="actn">${esc(r.new_value)}</span>`:''}`:
    (r.new_value?`<span class="actn">${esc(r.new_value)}</span>`:'');
  return `<div class="actrow">
    <div class="actdot" style="background:${col}"></div>
    <div class="actbody">
      <div class="actline"><b>${esc(r.actor_name||'—')}</b> <span class="actbadge" style="background:${col}1f;color:${col}">${esc(r.action)}</span>
        <span class="actent">${esc(r.entity_type)}</span> ${change}
        ${r.job_no?`<span class="linklike" data-openjob="${r.job_id}">${esc(r.job_no)}</span>`:''}</div>
      ${r.note&&r.note!==r.job_no?`<div class="actnote">${esc(r.note)}</div>`:''}
      <div class="acttime">${fmtWhen(r.created_at)}</div>
    </div></div>`;
}

/* ============================================================
   View: Permissions — per-user capability grants (super only)
   ============================================================ */
async function viewPermissions(C){
  if(!isSuper()){ C.innerHTML=`<div class="card empty">${icon('lock')}<b>Super Admins only</b></div>`; return; }
  let d; try{ d=await api('GET','/permissions'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const caps=d.capabilities;
  C.innerHTML=`<div class="note info" style="margin-bottom:14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
    Each person starts with their role's defaults. Click a cell to <b>grant</b> or <b>revoke</b> a capability for them; click again to reset to the role default.</div>
  <div class="card" style="overflow:auto"><table class="dtable permtable">
    <thead><tr><th>Person</th>${caps.map(c=>`<th class="r">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${d.users.map(u=>`<tr>
      <td><div style="font-weight:600">${esc(u.name)}</div><div style="color:var(--muted);font-size:11.5px">${esc(u.role.replace('_',' '))}</div></td>
      ${u.caps.map(c=>`<td class="r"><button class="permcell ${c.effective?'on':'off'} ${c.override===null?'isdef':(c.override?'isgrant':'isrevoke')}"
        data-u="${u.id}" data-c="${c.cap}" data-def="${c.default?1:0}" data-ov="${c.override===null?'':(c.override?'1':'0')}"
        title="${c.override===null?'Role default':(c.override?'Granted':'Revoked')}">
        ${c.effective?icon('check'):'<span class="permx">—</span>'}
        <span class="permsrc">${c.override===null?'role':(c.override?'granted':'revoked')}</span></button></td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
  C.querySelectorAll('.permcell').forEach(b=>b.onclick=async()=>{
    const def=b.dataset.def==='1'; const ov=b.dataset.ov===''?null:(b.dataset.ov==='1');
    let next; if(ov===null) next=!def; else next=null;          // default → flip → clear
    try{ await api('PUT','/permissions/'+b.dataset.u,{capability:b.dataset.c,value:next});
      toast('Updated');
      if(b.dataset.u==ME.id){ await refreshMe(); mountApp(); }   // own caps changed → rebuild nav
      else renderView(); }
    catch(e){ toast(e.message,true); }
  });
}

/* ============================================================
   View: Data management (super only)
   ============================================================ */
async function downloadData(url, fallbackName){
  try{
    const res=await fetch('/api'+url,{credentials:'include'});
    if(!res.ok){ toast('Export failed ('+res.status+')',true); return; }
    const cd=res.headers.get('Content-Disposition')||'';
    const m=cd.match(/filename="([^"]+)"/); const name=m?m[1]:fallbackName;
    const blob=await res.blob(); const href=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=href; a.download=name; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(href);
  }catch(e){ toast(e.message,true); }
}
let dataScope='jobs', dataFmt='csv', dataPeriodKind='all', dataPeriodVal='';
async function viewData(C){
  if(!isSuper()){ C.innerHTML=`<div class="card empty">${icon('lock')}<b>Super Admins only</b></div>`; return; }
  let d; try{ d=await api('GET','/data/summary'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const order=['jobs','clients','users','timesheet_entries','activity_log','issues','attachments','custom_fields','verticals','teams','departments'];
  const counts=order.filter(k=>k in d.counts).map(k=>[k,d.counts[k]]);
  const periodExtra = dataPeriodKind==='year'
    ? `<select class="sel" id="dpVal">${d.years.map(y=>`<option ${dataPeriodVal===y?'selected':''}>${y}</option>`).join('')||'<option>—</option>'}</select>`
    : dataPeriodKind==='month'
    ? `<select class="sel" id="dpVal">${d.months.map(m=>`<option ${dataPeriodVal===m?'selected':''}>${m}</option>`).join('')||'<option>—</option>'}</select>` : '';
  C.innerHTML=`
  <div class="note ${d.encrypted?'info':''}" style="margin-bottom:16px">
    ${icon(d.encrypted?'lock':'eyeoff')} Database encryption at rest is <b>${d.encrypted?'ON (SQLCipher)':'OFF'}</b>.
    ${d.encrypted?'':'Set <code>DB_ENCRYPTION_KEY</code> and install the cipher module to enable it — see DEPLOY.md.'}
  </div>

  <div class="datagrid">
    <div class="card datacard">
      <div class="dctitle">${icon('database')} What's in the database</div>
      <div class="counts">${counts.map(([k,v])=>`<div class="countrow"><span>${esc(k.replace(/_/g,' '))}</span><b>${v}</b></div>`).join('')}</div>
    </div>

    <div class="card datacard">
      <div class="dctitle">${icon('download')} Export</div>
      <div class="drow"><span class="dlabel">What</span>
        <div class="seg"><button class="${dataScope==='jobs'?'on':''}" data-scope="jobs">Jobs dataset</button><button class="${dataScope==='backup'?'on':''}" data-scope="backup">Full backup</button></div></div>
      ${dataScope==='jobs'?`
      <div class="drow"><span class="dlabel">Format</span>
        <div class="seg"><button class="${dataFmt==='csv'?'on':''}" data-fmt="csv">CSV</button><button class="${dataFmt==='json'?'on':''}" data-fmt="json">JSON</button></div></div>
      <div class="drow"><span class="dlabel">Period</span>
        <div class="seg"><button class="${dataPeriodKind==='all'?'on':''}" data-dp="all">All</button><button class="${dataPeriodKind==='year'?'on':''}" data-dp="year">Year</button><button class="${dataPeriodKind==='month'?'on':''}" data-dp="month">Month</button></div>
        ${periodExtra}</div>
      <div class="hint" style="color:var(--muted);margin:2px 0 10px">Jobs dataset is denormalised (client, teams, billing, cost, profit, hours, custom fields) — opens straight in Excel.</div>`
      :`<div class="hint" style="color:var(--muted);margin:8px 0 10px">Full backup is a complete JSON snapshot of every table, used for restore. It includes attachments, so it can be large.</div>`}
      <button class="btn pri" id="dExport">${icon('download')}Download</button>
    </div>

    <div class="card datacard">
      <div class="dctitle">${icon('upload')} Restore</div>
      <div class="hint" style="color:var(--muted);margin-bottom:10px">Upload a <b>full backup</b> JSON to replace the current database. This overwrites everything — export first if unsure.</div>
      <label class="btn" style="cursor:pointer">${icon('upload')}Choose backup file…<input type="file" id="dRestore" accept="application/json,.json" hidden></label>
      <div id="dRestoreName" class="hint" style="color:var(--muted);margin-top:8px"></div>
    </div>

    <div class="card datacard danger-card">
      <div class="dctitle">${icon('trash')} Reset</div>
      <div class="hint" style="color:var(--muted);margin-bottom:12px">Both actions are permanent — take a backup first.</div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <button class="btn" id="dZero">Reset to zero</button>
          <div class="hint" style="color:var(--muted);margin-top:6px">Clears all jobs, timesheets, approvals, issues, activity and notifications. Your people, clients, teams and settings stay — every count and financial returns to zero. No sample data.</div>
        </div>
        <div>
          <button class="btn danger" id="dWipe">${icon('trash')}Wipe everything</button>
          <div class="hint" style="color:var(--muted);margin-top:6px">Removes all data including people, clients and settings. Only the Super Admin logins remain, so you can sign back in and start fresh.</div>
        </div>
      </div>
    </div>
  </div>`;

  C.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{dataScope=b.dataset.scope;renderView();});
  C.querySelectorAll('[data-fmt]').forEach(b=>b.onclick=()=>{dataFmt=b.dataset.fmt;renderView();});
  C.querySelectorAll('[data-dp]').forEach(b=>b.onclick=()=>{dataPeriodKind=b.dataset.dp; dataPeriodVal = b.dataset.dp==='year'?(d.years.slice(-1)[0]||''):b.dataset.dp==='month'?(d.months[0]||''):''; renderView();});
  const dv=document.getElementById('dpVal'); if(dv)dv.onchange=()=>{dataPeriodVal=dv.value;};
  document.getElementById('dExport').onclick=()=>{
    if(dataScope==='backup') return downloadData('/data/export?scope=backup&format=json','mw-ops-backup.json');
    const p=dataPeriodKind!=='all'?`&period=${dataPeriodKind}&date=${encodeURIComponent(dataPeriodVal)}`:'';
    downloadData(`/data/export?scope=jobs&format=${dataFmt}${p}`,'mw-ops-jobs.'+dataFmt);
  };
  const rf=document.getElementById('dRestore');
  if(rf)rf.onchange=async()=>{
    const f=rf.files[0]; if(!f)return;
    document.getElementById('dRestoreName').textContent=f.name+' ('+fmtSize(f.size)+')';
    if(!confirm(`Restore from "${f.name}"?\n\nThis REPLACES the entire current database. Everyone (including you) may be signed out. Continue?`)){ rf.value=''; return; }
    try{
      const text=await f.text(); const json=JSON.parse(text);
      const r=await api('POST','/data/restore',json);
      toast('Restored — '+r.users+' users. Reloading…'); setTimeout(()=>location.reload(),900);
    }catch(e){ toast('Restore failed: '+e.message,true); }
  };
  document.getElementById('dZero').onclick=async()=>{
    if(!confirm('Reset all operational data to zero?\n\nJobs, timesheets, approvals, issues, activity and notifications will be permanently deleted. Your people, clients, teams and settings stay. This cannot be undone — take a backup first.'))return;
    try{ await api('POST','/data/reset',{mode:'zero'}); toast('Reset to zero. Reloading…'); setTimeout(()=>location.reload(),800);}catch(e){toast(e.message,true);}
  };
  document.getElementById('dWipe').onclick=async()=>{
    if(!confirm('WIPE EVERYTHING except Super Admin logins?\n\nAll jobs, clients, users, timesheets, masters and history will be permanently deleted. Only Super Admin accounts and their passwords remain. This cannot be undone.'))return;
    if(!confirm('Are you absolutely sure? Everything except the Super Admin logins will be erased.'))return;
    try{ await api('POST','/data/reset',{mode:'wipe'}); toast('Everything wiped except Super Admin. Reloading…'); setTimeout(()=>location.reload(),1000);}catch(e){toast(e.message,true);}
  };
}

/* ============================================================
   View: Masters (backend) — tabbed
   ============================================================ */
let mTab='verticals';
const MTABS=[['verticals','Verticals'],['teams','Teams'],['departments','Departments'],['clients','Clients'],['stages','Workflow stages'],['fields','Custom fields']];
function reMasters(){ viewMasters(document.getElementById('content')); }
async function viewMasters(C){
  const tabs=MTABS.filter(t=>t[0]!=='fields'||isSuper());
  if(mTab==='fields'&&!isSuper())mTab='verticals';
  C.innerHTML=`<div class="mtabs">${tabs.map(t=>`<button class="${mTab===t[0]?'on':''}" data-mt="${t[0]}">${esc(t[1])}</button>`).join('')}</div>
    <div id="mhost"><div style="padding:34px;text-align:center"><span class="spin"></span></div></div>`;
  C.querySelectorAll('[data-mt]').forEach(b=>b.onclick=()=>{mTab=b.dataset.mt; viewMasters(C);});
  const host=document.getElementById('mhost');
  try{
    if(mTab==='verticals') await mastersVerticals(host);
    else if(mTab==='teams') await mastersTeams(host);
    else if(mTab==='departments') await mastersDepartments(host);
    else if(mTab==='stages') await mastersStages(host);
    else if(mTab==='fields') await mastersFields(host);
    else await mastersClients(host);
  }catch(e){ host.innerHTML=`<div class="empty">${esc(e.message)}</div>`; }
}

const CF_ENTITY_LABEL={job:'Jobs',client:'Clients'};
let cfEntity='job';
async function mastersFields(host){
  const fields=await api('GET','/custom-fields?entity='+cfEntity+'&all=1');
  host.innerHTML=`<div class="filters" style="justify-content:space-between">
    <div class="seg">${Object.entries(CF_ENTITY_LABEL).map(([k,v])=>`<button class="${cfEntity===k?'on':''}" data-cfe="${k}">${v}</button>`).join('')}</div>
    <button class="btn pri" id="addCF">${icon('plus')}Add field</button></div>
  <div class="hint" style="color:var(--muted);margin:-4px 2px 12px">Fields you add here appear on the ${cfEntity==='job'?'job':'client'} form. Renaming a field keeps existing data; removing it deletes that field's stored values.</div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Field</th><th>Type</th><th>Options</th><th class="r">Status</th><th></th></tr></thead>
    <tbody>${fields.map(f=>`<tr class="${f.active?'':'inactive-row'}">
      <td style="font-weight:600">${esc(f.label)}<div style="color:var(--muted);font-size:11px;font-family:'JetBrains Mono'">${esc(f.field_key)}</div></td>
      <td>${esc(f.type)}</td><td style="color:var(--ink2)">${esc(f.options||'—')}</td>
      <td class="r">${f.active?'<span class="pill on">active</span>':'<span class="pill">hidden</span>'}</td>
      <td><div class="rowact">
        <button class="icon-btn" data-cftoggle="${f.id}" data-act="${f.active?0:1}" title="${f.active?'Hide':'Show'}">${icon(f.active?'eyeoff':'eye')}</button>
        <button class="icon-btn" data-cfedit="${f.id}" title="Rename / edit">${icon('edit')}</button>
        <button class="icon-btn" data-cfdel="${f.id}" title="Remove">${icon('trash')}</button>
      </div></td></tr>`).join('')||`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No custom fields yet.</td></tr>`}</tbody>
  </table></div>`;
  host.querySelectorAll('[data-cfe]').forEach(b=>b.onclick=()=>{cfEntity=b.dataset.cfe; reMasters();});
  host.querySelectorAll('[data-cftoggle]').forEach(b=>b.onclick=async()=>{try{await api('PUT','/custom-fields/'+b.dataset.cftoggle,{active:b.dataset.act==='1'}); reMasters();}catch(e){toast(e.message,true);}});
  host.querySelectorAll('[data-cfdel]').forEach(b=>b.onclick=async()=>{ if(!confirm('Remove this field and all its stored values? This cannot be undone.'))return; try{await api('DELETE','/custom-fields/'+b.dataset.cfdel); toast('Field removed'); reMasters();}catch(e){toast(e.message,true);}});
  host.querySelectorAll('[data-cfedit]').forEach(b=>b.onclick=()=>{const f=fields.find(x=>x.id==b.dataset.cfedit); cfFormModal(f);});
  document.getElementById('addCF').onclick=()=>cfFormModal(null);
}
function cfFormModal(f){
  const types=['text','textarea','number','date','select'];
  modal(f?'Edit field':'Add field for '+CF_ENTITY_LABEL[cfEntity], `
    <div class="field full"><label>Field name</label><input id="cf_label" value="${f?esc(f.label):''}" placeholder="e.g. PO Number"></div>
    <div class="field"><label>Type</label><select id="cf_type">${types.map(t=>`<option ${f&&f.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="field full"><label>Options <span class="help">for “select”, comma-separated</span></label><input id="cf_opts" value="${f?esc(f.options||''):''}" placeholder="Low, Medium, High"></div>`,
    f?'Save':'Add', async()=>{
      const label=val('cf_label'); if(!label)return true;
      const body={label,type:value('cf_type'),options:val('cf_opts')};
      try{ if(f) await api('PUT','/custom-fields/'+f.id,body); else await api('POST','/custom-fields',{entity:cfEntity,...body});
        toast('Saved'); reMasters(); return true; }catch(e){ toast(e.message,true); return true; }
    });
}

async function mastersVerticals(host){
  const vs=await masters('verticals',true);
  host.innerHTML=`<div class="filters" style="justify-content:flex-end"><button class="btn pri" id="addV">${icon('plus')}Add vertical</button></div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Vertical</th><th class="r">Teams</th><th class="r">Clients</th><th></th></tr></thead>
    <tbody>${vs.map(v=>`<tr><td style="font-weight:600">${esc(v.name)}</td><td class="r mono">${v.teams}</td><td class="r mono">${v.clients}</td>
      <td><div class="rowact"><button class="icon-btn" data-ev="${v.id}" title="Rename">${icon('edit')}</button><button class="icon-btn" data-dv="${v.id}" title="Delete">${icon('trash')}</button></div></td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">No verticals yet.</td></tr>'}</tbody>
  </table></div>`;
  document.getElementById('addV').onclick=()=>modal('Add vertical',`<div class="field full"><label>Name</label><input id="v_name" placeholder="Digital"></div>`,'Add',async()=>{ await api('POST','/masters/verticals',{name:val('v_name')}); toast('Vertical added'); reMasters(); return true;});
  host.querySelectorAll('[data-ev]').forEach(b=>b.onclick=()=>{const v=vs.find(x=>x.id==b.dataset.ev); modal('Rename vertical',`<div class="field full"><label>Name</label><input id="v_name" value="${esc(v.name)}"></div>`,'Save',async()=>{await api('PUT','/masters/verticals/'+v.id,{name:val('v_name')}); toast('Saved'); reMasters(); return true;});});
  host.querySelectorAll('[data-dv]').forEach(b=>b.onclick=async()=>{ if(!confirm('Delete this vertical?'))return; try{await api('DELETE','/masters/verticals/'+b.dataset.dv); toast('Deleted'); reMasters();}catch(e){toast(e.message,true);} });
}

async function mastersStages(host){
  const ss=await masters('stages',true);
  host.innerHTML=`<div class="filters" style="justify-content:space-between">
    <div class="help" style="align-self:center">Production workflow stages used on jobs (Strategy, Copy, Art, Artworking…). Add your own.</div>
    <button class="btn pri" id="addS">${icon('plus')}Add stage</button></div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Stage</th><th class="r">Jobs using it</th><th></th></tr></thead>
    <tbody>${ss.map(s=>`<tr><td style="font-weight:600">${esc(s.name)}</td><td class="r mono">${s.jobs}</td>
      <td><div class="rowact"><button class="icon-btn" data-es="${s.id}" title="Rename">${icon('edit')}</button><button class="icon-btn" data-ds="${s.id}" title="Delete">${icon('trash')}</button></div></td></tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">No stages yet.</td></tr>'}</tbody>
  </table></div>`;
  document.getElementById('addS').onclick=()=>modal('Add workflow stage',`<div class="field full"><label>Name</label><input id="s_name" placeholder="e.g. Pre-press"></div>`,'Add',async()=>{ const name=val('s_name'); if(!name)return true; await api('POST','/masters/stages',{name}); toast('Stage added'); reMasters(); return true;});
  host.querySelectorAll('[data-es]').forEach(b=>b.onclick=()=>{const s=ss.find(x=>x.id==b.dataset.es); modal('Rename stage',`<div class="field full"><label>Name</label><input id="s_name" value="${esc(s.name)}"></div>`,'Save',async()=>{await api('PUT','/masters/stages/'+s.id,{name:val('s_name')}); toast('Saved'); reMasters(); return true;});});
  host.querySelectorAll('[data-ds]').forEach(b=>b.onclick=async()=>{ if(!confirm('Delete this stage?'))return; try{await api('DELETE','/masters/stages/'+b.dataset.ds); toast('Deleted'); reMasters();}catch(e){toast(e.message,true);} });
}

async function mastersTeams(host){
  const [teams,vs,people]=await Promise.all([masters('teams',true),masters('verticals'),api('GET','/people')]);
  const vName=id=>{const v=vs.find(x=>x.id==id);return v?v.name:'—';};
  host.innerHTML=`<div class="filters" style="justify-content:flex-end">
      <button class="btn" id="moveM">${icon('move')}Move member</button>
      <button class="btn pri" id="addT">${icon('plus')}Add team</button></div>
    <div class="card" style="overflow:hidden"><table class="dtable">
      <thead><tr><th>Team</th><th>Vertical</th><th>Sub-vertical</th><th>Lead</th><th class="r">Members</th><th></th></tr></thead>
      <tbody>${teams.map(t=>`<tr><td style="font-weight:600">${esc(t.name)}</td><td>${esc(t.vertical||'—')}</td><td>${esc(t.sub_vertical||'—')}</td><td>${esc(t.lead_name||'—')}</td><td class="r mono">${t.members}</td>
        <td><div class="rowact"><button class="icon-btn" data-mem="${t.id}" title="Members">${icon('userplus')}</button><button class="icon-btn" data-et="${t.id}" title="Edit">${icon('edit')}</button><button class="icon-btn" data-dt="${t.id}" title="Delete">${icon('trash')}</button></div></td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No teams yet.</td></tr>'}</tbody>
    </table></div>`;
  const teamForm=(t)=>{
    const isNew=!t; t=t||{name:'',vertical_id:'',sub_vertical:'',lead_id:''};
    modal(isNew?'Add team':'Edit '+esc(t.name),`
      <div class="formgrid">
        <div class="field"><label>Name</label><input id="t_name" value="${esc(t.name)}" placeholder="Hornet"></div>
        <div class="field"><label>Vertical</label><select id="t_vert"><option value="">—</option>${vs.map(v=>`<option value="${v.id}" ${t.vertical_id==v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Sub-vertical <span class="help">optional</span></label><input id="t_sub" value="${esc(t.sub_vertical||'')}"></div>
        <div class="field"><label>Team lead</label><select id="t_lead"><option value="">—</option>${people.map(p=>`<option value="${p.id}" ${t.lead_id==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
      </div>`,isNew?'Add team':'Save',async()=>{
        const body={name:val('t_name'),vertical_id:value('t_vert')?+value('t_vert'):null,sub_vertical:val('t_sub'),lead_id:value('t_lead')?+value('t_lead'):null};
        if(isNew) await api('POST','/masters/teams',body); else await api('PUT','/masters/teams/'+t.id,body);
        toast('Saved'); reMasters(); return true;
      },'wide');
  };
  document.getElementById('addT').onclick=()=>teamForm(null);
  document.getElementById('moveM').onclick=()=>moveMemberModal(teams,people);
  host.querySelectorAll('[data-et]').forEach(b=>b.onclick=()=>teamForm(teams.find(x=>x.id==b.dataset.et)));
  host.querySelectorAll('[data-dt]').forEach(b=>b.onclick=async()=>{ if(!confirm('Delete this team? Members are unassigned from it.'))return; try{await api('DELETE','/masters/teams/'+b.dataset.dt); toast('Deleted'); reMasters();}catch(e){toast(e.message,true);} });
  host.querySelectorAll('[data-mem]').forEach(b=>b.onclick=()=>teamMembersModal(teams.find(x=>x.id==b.dataset.mem),people));
}

async function teamMembersModal(team, people){
  let members=[]; try{ members=await api('GET','/masters/teams/'+team.id+'/members'); }catch{}
  const memberIds=new Set(members.map(m=>m.id));
  const avail=people.filter(p=>!memberIds.has(p.id));
  modal('Members — '+esc(team.name),`
    <div class="field" style="margin-bottom:6px"><label>Current members</label></div>
    <div class="assign">${members.map(m=>`<span class="memchip">${esc(m.name)}<button data-rm="${m.id}" style="margin-left:6px;color:var(--red);font-weight:700">×</button></span>`).join('')||'<span style="color:var(--muted)">Nobody yet</span>'}</div>
    <div class="formgrid" style="margin-top:14px"><div class="field full"><label>Add member</label><select id="tm_add">${avail.map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.job_role||p.role)}</option>`).join('')||'<option value="">Everyone is already a member</option>'}</select></div></div>`,
    'Add member', async()=>{
      const uid=document.getElementById('tm_add').value; if(!uid) return true;
      await api('POST','/masters/teams/'+team.id+'/members',{user_id:+uid});
      toast('Added'); await masters('teams',true); reMasters(); closeModal(); teamMembersModal(team,people); return false;
    });
  document.querySelectorAll('[data-rm]').forEach(b=>b.onclick=async()=>{
    await api('DELETE','/masters/teams/'+team.id+'/members/'+b.dataset.rm);
    toast('Removed'); await masters('teams',true); reMasters(); closeModal(); teamMembersModal(team,people);
  });
}

function moveMemberModal(teams, people){
  modal('Move member between teams',`
    <div class="formgrid">
      <div class="field full"><label>Person</label><select id="mv_user">${people.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>From team <span class="help">optional</span></label><select id="mv_from"><option value="">(none)</option>${teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label>To team</label><select id="mv_to">${teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
    </div>`,'Move',async()=>{
      await api('POST','/masters/teams/move',{user_id:+value('mv_user'),from_team_id:value('mv_from')?+value('mv_from'):null,to_team_id:+value('mv_to')});
      toast('Moved'); await masters('teams',true); reMasters(); return true;
    },'wide');
}

async function mastersDepartments(host){
  const [deps,vs]=await Promise.all([masters('departments',true),masters('verticals')]);
  host.innerHTML=`<div class="filters" style="justify-content:flex-end"><button class="btn pri" id="addD">${icon('plus')}Add department</button></div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Department</th><th>Vertical</th><th class="r">People</th><th></th></tr></thead>
    <tbody>${deps.map(d=>`<tr><td style="font-weight:600">${esc(d.name)}</td><td>${esc(d.vertical||'—')}</td><td class="r mono">${d.people}</td>
      <td><div class="rowact"><button class="icon-btn" data-ed="${d.id}" title="Edit">${icon('edit')}</button><button class="icon-btn" data-dd="${d.id}" title="Delete">${icon('trash')}</button></div></td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">No departments yet.</td></tr>'}</tbody>
  </table></div>`;
  const depForm=(d)=>{
    const isNew=!d; d=d||{name:'',vertical_id:''};
    modal(isNew?'Add department':'Edit '+esc(d.name),`
      <div class="formgrid">
        <div class="field"><label>Name</label><input id="d_name" value="${esc(d.name)}" placeholder="Art"></div>
        <div class="field"><label>Vertical</label><select id="d_vert"><option value="">—</option>${vs.map(v=>`<option value="${v.id}" ${d.vertical_id==v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
      </div>`,isNew?'Add':'Save',async()=>{
        const body={name:val('d_name'),vertical_id:value('d_vert')?+value('d_vert'):null};
        if(isNew) await api('POST','/masters/departments',body); else await api('PUT','/masters/departments/'+d.id,body);
        toast('Saved'); reMasters(); return true;
      });
  };
  document.getElementById('addD').onclick=()=>depForm(null);
  host.querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>depForm(deps.find(x=>x.id==b.dataset.ed)));
  host.querySelectorAll('[data-dd]').forEach(b=>b.onclick=async()=>{ if(!confirm('Delete this department?'))return; try{await api('DELETE','/masters/departments/'+b.dataset.dd); toast('Deleted'); reMasters();}catch(e){toast(e.message,true);} });
}

async function mastersClients(host){
  const [cls,vs,cfDefs]=await Promise.all([masters('clients',true),masters('verticals'),customDefs('client')]);
  const sup=isSuper(), canSet=isBackend();
  host.innerHTML=`<div class="filters" style="justify-content:flex-end"><button class="btn pri" id="addC">${icon('plus')}Add client</button></div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Client</th><th>Type</th><th>Status</th><th>Vertical</th>${sup?'<th class="r">Value ₹</th>':''}<th class="r">Jobs</th><th></th></tr></thead>
    <tbody>${cls.map(c=>`<tr><td style="font-weight:600">${esc(c.name)}</td>
      <td><span class="ctype ctype-${c.type}">${esc(c.type)}</span></td>
      <td><span class="cstatus cstatus-${c.status}">${esc(c.status)}</span></td>
      <td>${esc(c.vertical||'—')}</td>
      ${sup?`<td class="r mono">${c.retainer_cost?`${INR(c.retainer_cost)}<span style="color:var(--muted);font-weight:400;font-size:11px;margin-left:4px">${c.type==='retainership'?'/mo':'one-time'}</span>`:'—'}</td>`:''}
      <td class="r mono">${c.jobs}</td>
      <td><div class="rowact"><button class="icon-btn" data-ec="${c.id}" title="Edit">${icon('edit')}</button><button class="icon-btn" data-dc="${c.id}" title="Delete">${icon('trash')}</button></div></td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No clients yet.</td></tr>'}</tbody>
  </table></div>`;
  const clientForm=(c)=>{
    const isNew=!c; c=c||{name:'',type:'project',status:'converted',vertical_id:'',retainer_cost:''};
    modal(isNew?'Add client':'Edit '+esc(c.name),`
      <div class="formgrid">
        <div class="field"><label>Name</label><input id="c_name" value="${esc(c.name)}"></div>
        <div class="field"><label>Type</label><select id="c_type"><option value="project" ${c.type==='project'?'selected':''}>Project</option><option value="retainership" ${c.type==='retainership'?'selected':''}>Retainership</option></select></div>
        <div class="field"><label>Status</label><select id="c_status"><option value="converted" ${c.status==='converted'?'selected':''}>Converted</option><option value="prospective" ${c.status==='prospective'?'selected':''}>Prospective</option></select></div>
        <div class="field"><label>Vertical</label><select id="c_vert"><option value="">—</option>${vs.map(v=>`<option value="${v.id}" ${c.vertical_id==v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></div>
        ${canSet?`<div class="field full"><label><span id="c_ret_lbl">${c.type==='retainership'?'Monthly retainer (₹/mo)':'Project value — one-time (₹)'}</span> ${sup?'':'<span class="help">write-only — only super admins can view it back</span>'}</label><input id="c_ret" type="number" min="0" step="1000" value="${sup?(c.retainer_cost||0):''}" placeholder="amount in ₹"></div>`:''}
        ${cfDefs.length?`<div class="field full cfhdr"><span>Custom fields</span></div>${customFieldsHtml(cfDefs, c.custom)}`:''}
      </div>`,isNew?'Add':'Save',async()=>{
        const body={name:val('c_name'),type:value('c_type'),status:value('c_status'),vertical_id:value('c_vert')?+value('c_vert'):null,custom:collectCustom(cfDefs)};
        if(canSet){ const r=document.getElementById('c_ret'); if(r && r.value!=='') body.retainer_cost=+r.value; }
        if(isNew) await api('POST','/masters/clients',body); else await api('PUT','/masters/clients/'+c.id,body);
        toast('Saved'); reMasters(); return true;
      },'wide');
    const _ct=document.getElementById('c_type'), _rl=document.getElementById('c_ret_lbl');
    if(_ct&&_rl) _ct.onchange=()=>{ _rl.textContent = _ct.value==='retainership'?'Monthly retainer (₹/mo)':'Project value — one-time (₹)'; };
  };
  document.getElementById('addC').onclick=()=>clientForm(null);
  host.querySelectorAll('[data-ec]').forEach(b=>b.onclick=()=>clientForm(cls.find(x=>x.id==b.dataset.ec)));
  host.querySelectorAll('[data-dc]').forEach(b=>b.onclick=async()=>{ if(!confirm('Delete this client?'))return; try{await api('DELETE','/masters/clients/'+b.dataset.dc); toast('Deleted'); reMasters();}catch(e){toast(e.message,true);} });
}

/* ============================================================
   View: Users (backend)
   ============================================================ */
const CRAFTS=['AM','Copy','Art','Studio','Strategy','Artworking'];
async function viewUsers(C){
  let users; try{ users=await api('GET','/users'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const sup=isSuper();
  const pa=document.getElementById('pageAction');
  if(pa){ pa.innerHTML=`<button class="btn pri" id="newUser" style="margin-left:12px">${icon('plus')}Add person</button>`;
    document.getElementById('newUser').onclick=()=>userModal(); }
  C.innerHTML=`<div class="note info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg>
    Admins and super admins manage people here. ${sup?'Cost rates are visible to super admins only and are kept as dated history, so past jobs always use the rate that applied on the day worked.':'Cost rates are hidden — only super admins can view or set them.'}</div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Teams</th><th>Reports to</th><th class="r">Hours</th>${sup?'<th class="r">Rate</th>':''}<th></th></tr></thead>
    <tbody>${users.map(u=>`<tr>
      <td style="font-weight:600">${esc(u.name)}${u.active?'':' <span class="ptag">inactive</span>'}</td>
      <td class="mono" style="font-size:12px">${esc(u.email)}</td>
      <td><span class="rolebadge rb-${u.role}">${esc(u.role.replace('_',' '))}</span></td>
      <td>${esc(u.department||'—')}</td>
      <td>${esc(u.teams||'—')}</td>
      <td style="color:var(--muted)">${esc(u.manager_name||'—')}</td>
      <td class="r mono">${u.hours}</td>
      ${sup?`<td class="r mono" style="white-space:nowrap">${u.rate?INR(u.rate):'—'} <button class="icon-btn" data-rh="${u.id}" title="Rate history">${icon('clock')}</button></td>`:''}
      <td><div class="rowact">
        <button class="icon-btn" title="Edit" data-eu="${u.id}">${icon('edit')}</button>
        <button class="icon-btn" title="Reset password" data-rp="${u.id}">${icon('key')}</button>
      </div></td></tr>`).join('')}</tbody>
  </table></div>`;
  C.querySelectorAll('[data-eu]').forEach(b=>b.onclick=()=>editUserModal(users.find(x=>x.id==b.dataset.eu)));
  C.querySelectorAll('[data-rp]').forEach(b=>b.onclick=async()=>{
    if(!confirm("Reset this user's password? They'll get a temporary one and must change it at next sign-in."))return;
    try{ const r=await api('POST','/users/'+b.dataset.rp+'/reset-password'); alert('Temporary password: '+r.temp_password+'\nShare it securely.'); }catch(e){toast(e.message,true);} });
  C.querySelectorAll('[data-rh]').forEach(b=>b.onclick=()=>rateHistoryModal(users.find(x=>x.id==b.dataset.rh)));
}

function teamCheckboxes(teams, checkedIds){
  const set=new Set((checkedIds||[]).map(String));
  return `<div class="field full"><label>Teams</label><div class="checkrow">${teams.map(t=>`<label><input type="checkbox" name="u_team" value="${t.id}" ${set.has(String(t.id))?'checked':''}>${esc(t.name)}${t.vertical?` <span style="color:var(--muted)">${esc(t.vertical)}</span>`:''}</label>`).join('')||'<span style="color:var(--muted)">No teams yet — create them in Masters.</span>'}</div></div>`;
}

async function userModal(){
  const [deps,teams,users]=await Promise.all([masters('departments'),masters('teams'),api('GET','/users')]);
  const leads=users.filter(u=>['team_lead','admin','super_admin'].includes(u.role));
  const roleOpts = isSuper()?['super_admin','admin','team_lead','member']:['team_lead','member'];
  modal('Add person',`
    <div class="formgrid">
      <div class="field"><label>Name</label><input id="u_name" placeholder="Aritra Sen"></div>
      <div class="field"><label>Office email</label><input id="u_email" placeholder="aritra"><div class="help">@${esc(CFG.office_domain)} added if omitted</div></div>
      <div class="field"><label>Role</label><select id="u_role">${roleOpts.map(r=>`<option value="${r}">${r.replace('_',' ')}</option>`).join('')}</select></div>
      <div class="field"><label>Department</label><select id="u_dept"><option value="">—</option>${deps.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Craft / job role</label><select id="u_craft"><option value="">—</option>${CRAFTS.map(t=>`<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Reports to</label><select id="u_mgr"><option value="">—</option>${leads.map(l=>`<option value="${l.id}">${esc(l.name)} (${l.role.replace('_',' ')})</option>`).join('')}</select></div>
      ${teamCheckboxes(teams,[])}
      ${isSuper()?`<div class="field"><label>Cost rate (₹/hr)</label><input id="u_rate" type="number" min="0" step="50" value="0"></div>
      <div class="field"><label>Rate effective from</label><input id="u_from" type="date" value="${new Date().toISOString().slice(0,10)}"></div>`:''}
    </div>`,
    'Create', async()=>{
      const team_ids=[...document.querySelectorAll('input[name="u_team"]:checked')].map(c=>+c.value);
      const body={name:val('u_name'),email:val('u_email'),role:value('u_role'),
        department_id:value('u_dept')?+value('u_dept'):null,job_role:value('u_craft')||null,
        reports_to:value('u_mgr')?+value('u_mgr'):null,team_ids};
      if(isSuper()){ const rt=+val('u_rate')||0; if(rt>0){ body.rate=rt; body.rate_from=val('u_from')||undefined; } }
      const r=await api('POST','/users',body);
      alert('User created.\nEmail: '+r.email+'\nTemporary password: '+r.temp_password+'\nThey must change it on first sign-in.');
      renderView(); return true;
    },'wide');
}

async function editUserModal(u){
  const [deps,teams,users]=await Promise.all([masters('departments'),masters('teams'),api('GET','/users')]);
  const leads=users.filter(x=>['team_lead','admin','super_admin'].includes(x.role)&&x.id!==u.id);
  const roleOpts = isSuper()?['super_admin','admin','team_lead','member']:['team_lead','member'];
  // preselect current teams by matching names (team names are unique)
  const curNames=new Set(String(u.teams||'').split(',').map(s=>s.trim()).filter(Boolean));
  const curTeamIds=teams.filter(t=>curNames.has(t.name)).map(t=>t.id);
  modal('Edit — '+esc(u.name),`
    <div class="formgrid">
      <div class="field"><label>Name</label><input id="eu_name" value="${esc(u.name)}"></div>
      <div class="field"><label>Role</label><select id="eu_role">${roleOpts.map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r.replace('_',' ')}</option>`).join('')}</select></div>
      <div class="field"><label>Department</label><select id="eu_dept"><option value="">—</option>${deps.map(d=>`<option value="${d.id}" ${u.department_id==d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Craft / job role</label><select id="eu_craft"><option value="">—</option>${CRAFTS.map(t=>`<option ${u.job_role===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Reports to</label><select id="eu_mgr"><option value="">—</option>${leads.map(l=>`<option value="${l.id}" ${u.reports_to==l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Status</label><select id="eu_active"><option value="1" ${u.active?'selected':''}>Active</option><option value="0" ${u.active?'':'selected'}>Inactive</option></select></div>
      ${teamCheckboxes(teams,curTeamIds)}
    </div>`,
    'Save', async()=>{
      const team_ids=[...document.querySelectorAll('input[name="u_team"]:checked')].map(c=>+c.value);
      await api('PUT','/users/'+u.id,{name:val('eu_name'),role:value('eu_role'),
        department_id:value('eu_dept')?+value('eu_dept'):null,job_role:value('eu_craft')||null,
        reports_to:value('eu_mgr')?+value('eu_mgr'):null,active:+value('eu_active'),team_ids});
      toast('User updated'); renderView(); return true;
    },'wide');
}

async function rateHistoryModal(u){
  let hist=[]; try{ hist=await api('GET','/users/'+u.id+'/rates'); }catch(e){ toast(e.message,true); return; }
  modal('Cost rate history — '+esc(u.name),`
    <div class="ratehist">${hist.length?hist.map(h=>`<div class="rr"><span class="mono" style="font-weight:600">${INR(h.cost_per_hour)}/hr</span><span style="color:var(--muted)">from ${fmtDateY(h.effective_from)}</span>${h.by_name?`<span style="color:var(--muted);font-size:11px">set by ${esc(h.by_name)}</span>`:''}</div>`).join(''):'<div style="color:var(--muted)">No rates set yet.</div>'}</div>
    <div class="formgrid" style="margin-top:14px">
      <div class="field"><label>New rate (₹/hr)</label><input id="rh_rate" type="number" min="0" step="50"></div>
      <div class="field"><label>Effective from</label><input id="rh_from" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
    </div>
    <div class="help">Adding a rate never changes past jobs — they keep the rate that applied on the day each hour was logged.</div>`,
    'Add rate', async()=>{
      const rate=+val('rh_rate'); if(!(rate>0)){ toast('Enter a rate > 0',true); return false; }
      await api('POST','/users/'+u.id+'/rates',{cost_per_hour:rate,effective_from:val('rh_from')});
      toast('Rate added'); renderView(); return true;
    },'wide');
}

/* ============================================================
   Shared: kpi, modal, icons
   ============================================================ */
function kpi(lbl,v,foot,color,vcls=''){ return `<div class="card kpi"><div class="spine" style="background:${color}"></div><div class="lbl">${lbl}</div><div class="val ${vcls}">${v}</div>${foot?`<div class="foot">${foot}</div>`:''}</div>`; }

let _modalEl=null;
function modal(title, bodyHTML, okLabel, onOk, cls=''){
  closeModal();
  _modalEl=document.createElement('div'); _modalEl.className='scrim';
  _modalEl.innerHTML=`<div class="modal ${cls}">
    <div class="mhead"><h3>${title}</h3><div class="sp"></div><button class="icon-btn" id="mx">${icon('x')}</button></div>
    <div class="mbody">${bodyHTML}</div>
    <div class="mfoot"><button class="btn" id="mcancel">Cancel</button>${okLabel?`<button class="btn pri" id="mok">${okLabel}</button>`:''}</div>
  </div>`;
  _modalEl.onclick=e=>{if(e.target===_modalEl)closeModal();};
  document.body.appendChild(_modalEl);
  document.getElementById('mx').onclick=closeModal;
  document.getElementById('mcancel').onclick=closeModal;
  const ok=document.getElementById('mok');
  if(ok)ok.onclick=async()=>{ ok.disabled=true; try{ const close=await onOk(); if(close!==false)closeModal(); }catch(e){toast(e.message,true);} if(document.getElementById('mok'))ok.disabled=false; };
  const f=_modalEl.querySelector('input,select,textarea'); if(f)setTimeout(()=>f.focus(),40);
  document.addEventListener('keydown',escClose);
}
function closeModal(){ if(_modalEl){_modalEl.remove();_modalEl=null;} document.removeEventListener('keydown',escClose); }
function escClose(e){ if(e.key==='Escape')closeModal(); }

function icon(n){
  const I={
    check:'<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag:'<path d="M4 21V4h13l-2 4 2 4H4"/>',
    grid:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    chart:'<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
    trend:'<path d="M3 3v18h18"/><path d="M7 14l3-4 4 3 5-7"/>',
    users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16 14.5a5 5 0 0 1 5 5.5"/>',
    layers:'<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    x:'<path d="M18 6L6 18M6 6l12 12"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
    lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    userplus:'<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 11 0"/><path d="M18 8v6M15 11h6"/>',
    key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M17 4l3 3M14 7l3 3"/>',
    move:'<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    eye:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:'<path d="M9.9 4.2A11 11 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-3.2 4.2M6.7 6.7A18 18 0 0 0 1 12s4 8 11 8a11 11 0 0 0 4.3-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M1 1l22 22"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    paperclip:'<path d="M21 9l-9.5 9.5a4 4 0 0 1-6-6L14 4a2.5 2.5 0 0 1 4 4l-8.5 8.5a1 1 0 0 1-1.5-1.5L15 8"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>',
    repeat:'<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    hash:'<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
    download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    gauge:'<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/><circle cx="12" cy="14" r="1.5"/>',
    database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  }[n]||'';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I}</svg>`;
}
