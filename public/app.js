/* ============================================================
   Monkey Wrench Ops — frontend SPA
   ============================================================ */
const root = document.getElementById('root');
let ME = null, CFG = { office_domain: 'monkeywrench.in' }, VIEW = null, APPROVAL_COUNT = 0;

/* ---------- tiny utils ---------- */
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const INR = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const INRk = n => { n = +n||0; const a=Math.abs(n); if(a>=1e7)return '₹'+(n/1e7).toFixed(2)+'Cr'; if(a>=1e5)return '₹'+(n/1e5).toFixed(2)+'L'; if(a>=1e3)return '₹'+(n/1e3).toFixed(1)+'k'; return '₹'+Math.round(n); };
const fmtDate = iso => { if(!iso) return '—'; const d=new Date(iso+'T00:00:00'); return isNaN(d)?iso:d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); };
const truncate = (s,n) => { s=s||''; return s.length>n? s.slice(0,n-1)+'…' : s; };
const isAdmin = () => ME && (ME.role==='admin' || ME.role==='super_admin');
const initials = n => (n||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();

function toast(msg, bad){
  const t=document.getElementById('toast');
  t.className='toast show'+(bad?' bad':'');
  t.innerHTML=(bad?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg>'
    :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 13l4 4L19 7"/></svg>')+esc(msg);
  clearTimeout(t._t); t._t=setTimeout(()=>t.className='toast',2400);
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

/* ============================================================
   Boot
   ============================================================ */
(async function boot(){
  try{ CFG = await api('GET','/config'); }catch{}
  try{ const r=await api('GET','/me'); ME=r.user; mountApp(); }
  catch{ mountLogin(); }
})();

/* ============================================================
   Login + password change
   ============================================================ */
function mountLogin(err){
  root.innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <div class="brand"><div class="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-.6-.6-2.1z"/></svg></div>
      <div><h1>Monkey Wrench</h1><span class="sub">Ops Console</span></div></div>
    <label>Office email</label>
    <input id="email" type="email" placeholder="you@${esc(CFG.office_domain)}" autocomplete="username">
    <div class="domain-hint">Sign in with your @${esc(CFG.office_domain)} address.</div>
    <label>Password</label>
    <input id="pw" type="password" placeholder="••••••••" autocomplete="current-password">
    ${err?`<div class="err">${esc(err)}</div>`:''}
    <button class="btn pri" id="go" style="width:100%;justify-content:center;margin-top:18px;padding:11px">Sign in</button>
  </div></div>`;
  const submit=async()=>{
    const email=document.getElementById('email').value, pw=document.getElementById('pw').value;
    try{ const r=await api('POST','/login',{email,password:pw}); ME=r.user; mountApp(); }
    catch(e){ mountLogin(e.message); }
  };
  document.getElementById('go').onclick=submit;
  document.getElementById('pw').onkeydown=e=>{if(e.key==='Enter')submit();};
  document.getElementById('email').focus();
}

function changePwScreen(){
  root.innerHTML=`
  <div class="login-wrap"><div class="login-card">
    <div class="brand"><div class="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-.6-.6-2.1z"/></svg></div>
      <div><h1>Set a new password</h1><span class="sub">First sign-in</span></div></div>
    <p style="color:var(--ink2);font-size:13px;margin-top:6px">Welcome ${esc(ME.name)}. Choose a password you'll use from now on.</p>
    <label>Current (temporary) password</label><input id="old" type="password" autocomplete="current-password">
    <label>New password</label><input id="new" type="password" autocomplete="new-password" placeholder="at least 8 characters">
    <div id="cperr"></div>
    <button class="btn pri" id="cpgo" style="width:100%;justify-content:center;margin-top:18px;padding:11px">Save password</button>
  </div></div>`;
  document.getElementById('cpgo').onclick=async()=>{
    try{ await api('POST','/change-password',{old_password:document.getElementById('old').value,new_password:document.getElementById('new').value});
      ME.must_change_pw=false; toast('Password updated'); mountApp(); }
    catch(e){ document.getElementById('cperr').innerHTML=`<div class="err">${esc(e.message)}</div>`; }
  };
}

async function logout(){ try{await api('POST','/logout');}catch{} ME=null; mountLogin(); }

/* ============================================================
   App shell + nav (role-aware)
   ============================================================ */
function navFor(role){
  const my=[
    ['my_jobs','My jobs', icon('check')],
    ['timesheet','Timesheet', icon('clock')],
  ];
  if(role==='member') return [...my, ['my_status','My approvals', icon('flag')]];
  if(role==='team_lead') return [...my,
    ['board','Team board', icon('grid')],
    ['approvals','Approvals', icon('flag')]];
  // admin / super
  return [
    ['dashboard','Dashboard', icon('chart')],
    ['board','Jobs', icon('grid')],
    ['timesheet','Timesheet', icon('clock')],
    ['approvals','Approvals', icon('flag')],
    ['pnl','Profit & Loss', icon('trend')],
    ['users','Backend · Users', icon('users')],
  ];
}
const VIEW_TITLES={
  my_jobs:["My jobs","What's on your plate today"],
  timesheet:['Timesheet','Log hours and submit your day'],
  my_status:['My approvals','Where your finished jobs stand'],
  board:[isAdminTitle,'Jobs across the studio'],
  approvals:['Approvals','Sign-off queue waiting on you'],
  dashboard:['Dashboard','Studio health at a glance'],
  pnl:['Profit & Loss','What each client and job earns'],
  users:['Backend · Users','People, roles, and rates'],
};
function isAdminTitle(){ return ME.role==='team_lead'?'Team board':'Jobs'; }

function mountApp(){
  if(ME.must_change_pw){ changePwScreen(); return; }
  const nav=navFor(ME.role);
  if(!VIEW || !nav.find(n=>n[0]===VIEW)) VIEW=nav[0][0];
  root.innerHTML=`
  <div class="app">
    <aside class="side" id="side">
      <div class="brand"><div class="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-.6-.6-2.1z"/></svg></div>
        <div><b>Monkey Wrench</b><span>Ops Console</span></div></div>
      ${nav.map(n=>`<button class="navlink ${n[0]===VIEW?'on':''}" data-v="${n[0]}">${n[2]}${n[1]}${n[0]==='approvals'?`<span class="badge ${APPROVAL_COUNT?'':'hide'}" id="appBadge">${APPROVAL_COUNT}</span>`:''}</button>`).join('')}
      <div class="sp"></div>
      <div class="me"><div class="av">${initials(ME.name)}</div>
        <div><div class="nm">${esc(ME.name)}</div><div class="rl">${esc(ME.role.replace('_',' '))}${ME.team?' · '+esc(ME.team):''}</div></div>
        <button id="logout" title="Sign out">${icon('logout')}</button></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="menu-btn" id="menuBtn">${icon('menu')}</button>
        <div><h1 id="pgT"></h1><div class="sub" id="pgS"></div></div>
        <div class="sp"></div>
        <div class="datestamp">${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</div>
        <span id="pageAction"></span>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`;
  root.querySelectorAll('.navlink').forEach(b=>b.onclick=()=>{VIEW=b.dataset.v; mountApp();});
  document.getElementById('logout').onclick=logout;
  document.getElementById('menuBtn').onclick=()=>document.getElementById('side').classList.toggle('open');
  const t=VIEW_TITLES[VIEW]; document.getElementById('pgT').textContent= typeof t[0]==='function'?t[0]():t[0];
  document.getElementById('pgS').textContent=t[1];
  refreshApprovalBadge();
  renderView();
}

async function refreshApprovalBadge(){
  if(ME.role==='member') return;
  try{ const r=await api('GET','/approvals/count'); APPROVAL_COUNT=r.count;
    const b=document.getElementById('appBadge'); if(b){ b.textContent=r.count; b.classList.toggle('hide',!r.count);} }catch{}
}

function renderView(){
  const C=document.getElementById('content'); C.innerHTML=`<div style="padding:40px;text-align:center"><span class="spin"></span></div>`;
  ({my_jobs:viewMyJobs,timesheet:viewTimesheet,my_status:viewMyStatus,board:viewBoard,
    approvals:viewApprovals,dashboard:viewDashboard,pnl:viewPnl,users:viewUsers}[VIEW])(C);
}

/* ============================================================
   View: My jobs (gated)
   ============================================================ */
async function viewMyJobs(C){
  let jobs;
  try{ jobs=await api('GET','/jobs/mine'); }
  catch(e){
    if(e.status===423){ // timesheet gate
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
}
function myJobCard(j){
  const tc=TASK_COLORS[j.task]||['var(--surface2)','var(--ink2)'];
  const rejected=j.approval_stage==='rejected';
  const inApproval=['submitted','lead_approved','admin_approved','approved'].includes(j.approval_stage);
  return `<div class="card" style="padding:16px 18px;margin-bottom:12px">
    <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:3px">
          <span class="jno">${esc(j.job_no)}</span>
          <span class="ptag" style="text-transform:uppercase">${esc(j.client)}</span>
          ${j.task?`<span class="tasktag" style="background:${tc[0]};color:${tc[1]}">${esc(j.task)}</span>`:''}
        </div>
        <div style="font-weight:600;font-size:15px">${esc(j.brief)}</div>
        <div style="margin-top:6px;font-size:12px;color:var(--muted)">Due ${fmtDate(j.due_date)} · ${esc(j.team)} team</div>
        ${rejected?`<div class="note" style="margin-top:10px;margin-bottom:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg>Sent back: ${esc(j.reject_note||'rework needed')}</div>`:''}
      </div>
      <div style="text-align:right;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        ${inApproval?`<span class="appchip app-${j.approval_stage}">${esc(APP_LABEL[j.approval_stage])}</span>`
          :`<span class="appchip app-none">${esc(j.stage)}</span>`}
        <div style="display:flex;gap:6px">
          <button class="btn sm" data-log="${j.id}">${icon('clock')}Log time</button>
          ${(!inApproval)?`<button class="btn sm pri" data-submit="${j.id}">${icon('flag')}Submit for approval</button>`:''}
        </div>
      </div>
    </div></div>`;
}

/* ============================================================
   View: Timesheet
   ============================================================ */
let TS_DATE=null;
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
      <div style="font-family:'JetBrains Mono';font-weight:600">${total} h${isAdmin()&&entries.length?'':''}</div>
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
  if(!inflight.length){ C.innerHTML=`<div class="card empty">${icon('flag')}<b>Nothing in approval</b>Finish a job and hit “Submit for approval”.</div>`; return; }
  C.innerHTML=`<div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Job</th><th>Brief</th><th>Stage</th><th>Status</th></tr></thead><tbody>
    ${inflight.map(j=>`<tr><td><span class="jno">${esc(j.job_no)}</span></td>
      <td>${esc(truncate(j.brief,42))}</td><td>${esc(j.stage)}</td>
      <td><span class="appchip app-${j.approval_stage}">${esc(APP_LABEL[j.approval_stage]||j.approval_stage)}</span>
        ${j.approval_stage==='rejected'&&j.reject_note?`<div style="font-size:11px;color:var(--muted);margin-top:3px">${esc(j.reject_note)}</div>`:''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

/* ============================================================
   View: Board (team lead = team, admin = all)
   ============================================================ */
let bf={q:'',stage:''};
async function viewBoard(C){
  let jobs, people=[];
  try{ jobs=await api('GET','/jobs'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  try{ people=await api('GET','/people'); }catch{}
  // page action: admin can add jobs
  const pa=document.getElementById('pageAction');
  if(pa){ pa.innerHTML= isAdmin()? `<button class="btn pri" id="newJob" style="margin-left:12px">${icon('plus')}New job</button>`:'';
    const nj=document.getElementById('newJob'); if(nj)nj.onclick=()=>jobModal(null); }

  let list=jobs.filter(j=>{
    if(bf.stage&&j.stage!==bf.stage)return false;
    if(bf.q){const s=(j.job_no+' '+j.client+' '+j.brief).toLowerCase(); if(!s.includes(bf.q.toLowerCase()))return false;}
    return true;
  });
  let html=`<div class="filters">
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
        ${isAdmin()?'<th style="text-align:right">Billing</th><th style="text-align:right">Profit</th>':''}<th></th></tr></thead>
      <tbody>${rows.map(j=>boardRow(j)).join('')}</tbody></table></div>`;
  });
  C.innerHTML=html;
  wireBoardFilters();
  C.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>assignModal(jobs.find(j=>j.id==b.dataset.assign),people));
  C.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>jobModal(jobs.find(j=>j.id==b.dataset.edit)));
  C.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(confirm('Delete this job?')){ await api('DELETE','/jobs/'+b.dataset.del); renderView(); }});
  C.querySelectorAll('[data-stage]').forEach(b=>b.onclick=async()=>{
    const [id,stage]=b.dataset.stage.split('|');
    try{ await api('POST',`/jobs/${id}/stage`,{stage}); renderView(); }catch(e){toast(e.message,true);} });
}
function boardRow(j){
  const tc=TASK_COLORS[j.task]||['var(--surface2)','var(--ink2)'];
  const tags=j.assignees.map(a=>`<span class="ptag"><b>${esc(a.role_on_job||a.craft||'')}</b>${esc(a.name)}</span>`).join('')||'<span class="ptag">—</span>';
  const i=STAGES.indexOf(j.stage); const nextStage=STAGES[Math.min(i+1,4)];
  return `<tr class="jrow">
    <td><span class="jno">${esc(j.job_no)}${j.ref_no?`<span class="ref">(${esc(j.ref_no)})</span>`:''}</span></td>
    <td class="jdesc"><span class="cl">${esc(j.client)}</span>${esc(j.brief)}
      ${j.approval_stage&&j.approval_stage!=='none'?`<span class="appchip app-${j.approval_stage}" style="margin-top:5px">${esc(APP_LABEL[j.approval_stage]||j.approval_stage)}</span>`:''}</td>
    <td><div class="assign">${tags}</div></td>
    <td>${j.task?`<span class="tasktag" style="background:${tc[0]};color:${tc[1]}">${esc(j.task)}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
    <td style="white-space:nowrap;color:var(--ink2)">${fmtDate(j.due_date)}</td>
    ${isAdmin()?`<td class="money">${INR(j.billing)}</td>
      <td class="profitcell ${j.profit>=0?'pos':'neg'}">${INR(j.profit)}<small>${j.hours?j.hours+'h · '+INRk(j.cost):'no time'}</small></td>`:''}
    <td><div class="rowact">
      <button class="icon-btn" title="Assign" data-assign="${j.id}">${icon('userplus')}</button>
      ${j.stage!=='Done'&&j.stage!=='Approved'?`<button class="icon-btn" title="Advance to ${nextStage}" data-stage="${j.id}|${nextStage}">${icon('arrow')}</button>`:''}
      ${isAdmin()?`<button class="icon-btn" title="Edit" data-edit="${j.id}">${icon('edit')}</button>
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
      <div class="field"><label>Add person</label><select id="a_user">${avail.map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.job_role||p.role)}${isAdmin()&&p.team?' · '+esc(p.team):''}</option>`).join('')||'<option value="">No one available</option>'}</select></div>
      <div class="field"><label>Role on job</label><select id="a_role"><option>AM</option><option>Copy</option><option>Art</option><option>Studio</option></select></div>
    </div>`,
    'Add to job', async()=>{
      const uid=document.getElementById('a_user').value; if(!uid){return true;}
      await api('POST',`/jobs/${job.id}/assign`,{user_id:+uid, role_on_job:document.getElementById('a_role').value});
      toast('Assigned'); renderView(); return true;
    });
  // wire unassign inside modal
  document.querySelectorAll('[data-unassign]').forEach(b=>b.onclick=async()=>{
    await api('POST',`/jobs/${job.id}/unassign`,{user_id:+b.dataset.unassign}); closeModal(); renderView();
  });
}

function jobModal(job){
  const isNew=!job;
  job=job||{job_no:'',ref_no:'',client:'',team:'Hornet',stage:'Pipeline',task:'Design',brief:'',billing:0,due_date:''};
  modal(isNew?'New job':'Edit '+esc(job.job_no), `
    <div class="formgrid">
      <div class="field"><label>Job No.</label><input id="j_no" value="${esc(job.job_no)}" placeholder="4301_22"></div>
      <div class="field"><label>Ref No.</label><input id="j_ref" value="${esc(job.ref_no||'')}"></div>
      <div class="field"><label>Client</label><input id="j_client" value="${esc(job.client)}"></div>
      <div class="field"><label>Team</label><select id="j_team">${['Hornet','Raptor','Studio'].map(t=>`<option ${job.team===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field full"><label>Brief</label><input id="j_brief" value="${esc(job.brief)}"></div>
      <div class="field"><label>Task</label><select id="j_task"><option value="">—</option>${Object.keys(TASK_COLORS).map(t=>`<option ${job.task===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Stage</label><select id="j_stage">${STAGES.map(s=>`<option ${job.stage===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Due date</label><input id="j_date" type="date" value="${esc(job.due_date||'')}"></div>
      <div class="field"><label>Billing (₹)</label><input id="j_bill" type="number" min="0" step="500" value="${job.billing||0}"></div>
    </div>`,
    isNew?'Add job':'Save', async()=>{
      const body={job_no:val('j_no'),ref_no:val('j_ref'),client:val('j_client'),team:value('j_team'),
        brief:val('j_brief'),task:value('j_task'),stage:value('j_stage'),due_date:val('j_date'),billing:+val('j_bill')};
      if(isNew) await api('POST','/jobs',body); else await api('PUT','/jobs/'+job.id,body);
      toast(isNew?'Job added':'Job saved'); renderView(); return true;
    }, 'wide');
}
const val=id=>document.getElementById(id).value.trim();
const value=id=>document.getElementById(id).value;

/* ============================================================
   View: Approvals queue
   ============================================================ */
async function viewApprovals(C){
  let q;
  try{ q=await api('GET','/approvals/queue'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const levelLabel={team_lead:'You are the first sign-off for your team.',admin:'You sign off after team leads.',super_admin:'Final sign-off before a job is closed.'}[ME.role];
  if(!q.length){ C.innerHTML=`<div class="note info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>${esc(levelLabel||'')}</div>
    <div class="card empty">${icon('flag')}<b>Queue is clear</b>No jobs waiting on your approval.</div>`; return; }
  C.innerHTML=`<div class="note info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>${esc(levelLabel||'')}</div>`
    + q.map(j=>approvalCard(j)).join('');
  C.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{
    try{ await api('POST',`/approvals/${b.dataset.approve}/approve`); toast('Approved'); renderView(); refreshApprovalBadge(); }catch(e){toast(e.message,true);} });
  C.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.reject;
    modal('Send back for rework',`<div class="field full"><label>Reason</label><textarea id="rj_note" placeholder="What needs fixing?"></textarea></div>`,
      'Reject', async()=>{ await api('POST',`/approvals/${id}/reject`,{note:document.getElementById('rj_note').value||'Sent back for rework.'});
        toast('Sent back'); renderView(); refreshApprovalBadge(); return true; });
  });
}
function approvalCard(j){
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
        ${isAdmin()?`<div style="margin-top:10px;font-family:'JetBrains Mono';font-size:12.5px">Billing ${INR(j.billing)} · Cost ${INR(j.cost)} · <b class="${j.profit>=0?'pos':'neg'}">${INR(j.profit)} profit</b></div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        <span class="appchip app-${j.approval_stage}">${esc(APP_LABEL[j.approval_stage])}</span>
        <div style="display:flex;gap:7px">
          <button class="btn sm danger" data-reject="${j.id}">${icon('x')}Reject</button>
          <button class="btn sm ok pri" data-approve="${j.id}" style="background:var(--green);color:#fff;border-color:var(--green)">${icon('check')}Approve</button>
        </div>
      </div>
    </div></div>`;
}

/* ============================================================
   View: Dashboard (admin)
   ============================================================ */
async function viewDashboard(C){
  let d; try{ d=await api('GET','/admin/dashboard'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const maxMv=Math.max(d.billing,d.cost,1);
  const topBill=[...d.clients].sort((a,b)=>b.billing-a.billing).slice(0,6);
  const maxBill=Math.max(...topBill.map(c=>c.billing),1);
  const topProfit=[...d.clients].sort((a,b)=>b.profit-a.profit).slice(0,5);
  const maxP=Math.max(...topProfit.map(c=>Math.max(0,c.profit)),1);
  C.innerHTML=`
  <div class="grid kpis">
    ${kpi('Total billing',INRk(d.billing),d.jobs+' jobs','var(--green2)')}
    ${kpi('Manpower cost',INRk(d.cost),d.hours+' hrs logged','var(--amber)')}
    ${kpi('Gross profit',INRk(d.profit),'',d.profit>=0?'var(--green2)':'var(--red)',d.profit>=0?'pos':'neg')}
    ${kpi('Margin',d.margin.toFixed(0)+'<small>%</small>','billing − manpower','var(--violet)')}
    ${kpi('Active jobs',d.active,(d.jobs-d.active)+' closed','var(--blue)')}
    ${kpi('Hours logged',d.hours,'studio-wide','var(--slate)')}
  </div>
  <div class="sechead"><h2>Manpower vs total billing</h2><div class="sp"></div><span class="hint">Cost = logged hours × each rate</span></div>
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
      <div class="barlist">${topBill.map(c=>`<div class="barrow"><div class="nm">${esc(c.client)}</div><div class="bar"><i style="width:${c.billing/maxBill*100}%"></i></div><div class="v">${INRk(c.billing)}</div></div>`).join('')}</div></div>
    <div class="card"><div class="minihead">Most profitable clients</div><div class="minisub">Billing minus logged manpower</div>
      <div class="barlist">${topProfit.map(c=>`<div class="barrow"><div class="nm">${esc(c.client)}</div><div class="bar"><i style="width:${Math.max(0,c.profit)/maxP*100}%;background:${c.profit>=0?'var(--green2)':'var(--red)'}"></i></div><div class="v ${c.profit>=0?'pos':'neg'}">${INRk(c.profit)}</div></div>`).join('')}</div></div>
  </div>
  <div class="sechead"><h2>Jobs by stage</h2></div>
  <div class="card"><div class="stagegrid">
    ${STAGES.map(s=>`<div class="stagecell"><div class="n">${d.stageCount[s]||0}</div><div class="l"><span class="dot" style="background:${STAGE_COLOR[s]}"></span>${s}</div></div>`).join('')}
  </div></div>`;
}

/* ============================================================
   View: P&L (admin)
   ============================================================ */
let pnlMode='client',pnlSort={key:'profit',dir:-1};
async function viewPnl(C){
  let res; try{ res=await api('GET','/admin/pnl?mode='+pnlMode); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  let rows=res.rows;
  const k=pnlSort.key;
  rows.sort((a,b)=>typeof a[k]==='string'?a[k].localeCompare(b[k])*pnlSort.dir:(a[k]-b[k])*pnlSort.dir);
  const tot=rows.reduce((s,r)=>({billing:s.billing+r.billing,cost:s.cost+r.cost,profit:s.profit+r.profit,hours:s.hours+r.hours}),{billing:0,cost:0,profit:0,hours:0});
  const maxBill=Math.max(...rows.map(r=>r.billing),1);
  const th=(key,label)=>`<th class="r" data-sort="${key}">${label}</th>`;
  C.innerHTML=`<div class="filters" style="justify-content:space-between">
    <div class="seg"><button class="${pnlMode==='client'?'on':''}" data-mode="client">By client</button><button class="${pnlMode==='job'?'on':''}" data-mode="job">By job</button></div>
    <div class="hint" style="align-self:center;color:var(--muted)">Profit = billing − (logged hours × rate)</div></div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th data-sort="name">${pnlMode==='client'?'Client':'Job'}</th>
      ${pnlMode==='job'?'<th>Client</th>':th('jobs','Jobs')}
      ${th('billing','Billing')}${th('hours','Hours')}${th('cost','Manpower')}${th('profit','Profit')}${th('margin','Margin')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td><div style="font-weight:600">${esc(r.name)}</div>${pnlMode==='job'?`<div style="color:var(--muted);font-size:12px">${esc(truncate(r.sub,46))}</div>`:''}
        <div class="bar-inline"><i style="width:${r.billing/maxBill*100}%;background:var(--green2)"></i></div></td>
      ${pnlMode==='job'?`<td>${esc(r.client)}</td>`:`<td class="r mono">${r.jobs}</td>`}
      <td class="r mono">${INR(r.billing)}</td><td class="r mono">${r.hours||0}</td>
      <td class="r mono" style="color:var(--amber)">${INR(r.cost)}</td>
      <td class="r mono ${r.profit>=0?'pos':'neg'}" style="font-weight:700">${INR(r.profit)}</td>
      <td class="r mono ${r.margin>=0?'pos':'neg'}">${r.margin.toFixed(0)}%</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td>${pnlMode==='job'?'<td></td>':`<td class="r mono">${rows.reduce((s,r)=>s+(r.jobs||0),0)}</td>`}
      <td class="r mono">${INR(tot.billing)}</td><td class="r mono">${tot.hours}</td>
      <td class="r mono" style="color:var(--amber)">${INR(tot.cost)}</td>
      <td class="r mono ${tot.profit>=0?'pos':'neg'}">${INR(tot.profit)}</td>
      <td class="r mono">${tot.billing?(tot.profit/tot.billing*100).toFixed(0):0}%</td></tr></tfoot>
  </table></div>`;
  C.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{pnlMode=b.dataset.mode;renderView();});
  C.querySelectorAll('[data-sort]').forEach(h=>h.onclick=()=>{const key=h.dataset.sort; if(pnlSort.key===key)pnlSort.dir*=-1; else{pnlSort.key=key;pnlSort.dir=-1;} renderView();});
}

/* ============================================================
   View: Users (backend, admin)
   ============================================================ */
async function viewUsers(C){
  let users; try{ users=await api('GET','/admin/users'); }catch(e){ C.innerHTML=`<div class="empty">${esc(e.message)}</div>`; return; }
  const pa=document.getElementById('pageAction');
  if(pa){ pa.innerHTML=`<button class="btn pri" id="newUser" style="margin-left:12px">${icon('plus')}Add person</button>`;
    document.getElementById('newUser').onclick=()=>userModal(users); }
  C.innerHTML=`<div class="note info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4M12 16h.01"/><circle cx="12" cy="12" r="10"/></svg>
    This is the backend — only admins and super admins reach it. Rates here drive every cost and profit number. Editing a rate recalculates the dashboard and P&L.</div>
  <div class="card" style="overflow:hidden"><table class="dtable">
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Craft</th><th class="r">Rate ₹/hr</th><th class="r">Hours</th><th>Reports to</th><th></th></tr></thead>
    <tbody>${users.map(u=>`<tr>
      <td style="font-weight:600">${esc(u.name)}${u.active?'':' <span class="ptag">inactive</span>'}</td>
      <td class="mono" style="font-size:12px">${esc(u.email)}</td>
      <td><span class="rolebadge rb-${u.role}">${esc(u.role.replace('_',' '))}</span></td>
      <td>${esc(u.team||'—')}</td><td>${esc(u.job_role||'—')}</td>
      <td class="r"><input type="number" min="0" step="50" value="${u.rate}" data-rate="${u.id}" style="width:84px;text-align:right;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-family:'JetBrains Mono';font-weight:600"></td>
      <td class="r mono">${u.hours}</td>
      <td style="color:var(--muted)">${esc(u.manager_name||'—')}</td>
      <td><div class="rowact">
        <button class="icon-btn" title="Edit" data-eu="${u.id}">${icon('edit')}</button>
        <button class="icon-btn" title="Reset password" data-rp="${u.id}">${icon('key')}</button>
      </div></td></tr>`).join('')}</tbody>
  </table></div>`;
  C.querySelectorAll('[data-rate]').forEach(inp=>inp.onchange=async()=>{
    try{ await api('PUT','/admin/users/'+inp.dataset.rate,{rate:+inp.value}); toast('Rate updated'); }catch(e){toast(e.message,true);} });
  C.querySelectorAll('[data-rp]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Reset this user\'s password? They\'ll get a temporary one.'))return;
    try{ const r=await api('POST','/admin/users/'+b.dataset.rp+'/reset-password'); alert('Temporary password: '+r.temp_password+'\nShare it securely; they must change it on next sign-in.'); }catch(e){toast(e.message,true);} });
  C.querySelectorAll('[data-eu]').forEach(b=>b.onclick=()=>{const u=users.find(x=>x.id==b.dataset.eu); editUserModal(u,users);});
}
function userModal(users){
  const leads=users.filter(u=>['team_lead','admin','super_admin'].includes(u.role));
  const roleOpts = ME.role==='super_admin'?['super_admin','admin','team_lead','member']:['team_lead','member'];
  modal('Add person',`
    <div class="formgrid">
      <div class="field"><label>Name</label><input id="u_name" placeholder="Aritra"></div>
      <div class="field"><label>Office email</label><input id="u_email" placeholder="aritra"><div class="help">@${esc(CFG.office_domain)} added if omitted</div></div>
      <div class="field"><label>Role</label><select id="u_role">${roleOpts.map(r=>`<option value="${r}">${r.replace('_',' ')}</option>`).join('')}</select></div>
      <div class="field"><label>Team</label><select id="u_team"><option value="">—</option>${['Hornet','Raptor','Studio'].map(t=>`<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Craft</label><select id="u_craft"><option value="">—</option>${['AM','Copy','Art','Studio'].map(t=>`<option>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Rate (₹/hr)</label><input id="u_rate" type="number" min="0" step="50" value="700"></div>
      <div class="field full"><label>Reports to</label><select id="u_mgr"><option value="">—</option>${leads.map(l=>`<option value="${l.id}">${esc(l.name)} (${l.role.replace('_',' ')})</option>`).join('')}</select></div>
    </div>`,
    'Create', async()=>{
      const r=await api('POST','/admin/users',{name:val('u_name'),email:val('u_email'),role:value('u_role'),
        team:value('u_team')||null,job_role:value('u_craft')||null,rate:+val('u_rate'),manager_id:value('u_mgr')||null});
      alert('User created.\nEmail: '+r.email+'\nTemporary password: '+r.temp_password+'\nThey must change it on first sign-in.');
      renderView(); return true;
    },'wide');
}
function editUserModal(u,users){
  const leads=users.filter(x=>['team_lead','admin','super_admin'].includes(x.role)&&x.id!==u.id);
  modal('Edit — '+esc(u.name),`
    <div class="formgrid">
      <div class="field"><label>Name</label><input id="eu_name" value="${esc(u.name)}"></div>
      <div class="field"><label>Role</label><select id="eu_role">${['super_admin','admin','team_lead','member'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r.replace('_',' ')}</option>`).join('')}</select></div>
      <div class="field"><label>Team</label><select id="eu_team"><option value="">—</option>${['Hornet','Raptor','Studio'].map(t=>`<option ${u.team===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Craft</label><select id="eu_craft"><option value="">—</option>${['AM','Copy','Art','Studio'].map(t=>`<option ${u.job_role===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field full"><label>Reports to</label><select id="eu_mgr"><option value="">—</option>${leads.map(l=>`<option value="${l.id}" ${u.manager_id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></div>
    </div>`,
    'Save', async()=>{
      await api('PUT','/admin/users/'+u.id,{name:val('eu_name'),role:value('eu_role'),team:value('eu_team')||null,job_role:value('eu_craft')||null,manager_id:value('eu_mgr')||null});
      toast('User updated'); renderView(); return true;
    });
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
  if(ok)ok.onclick=async()=>{ ok.disabled=true; try{ const close=await onOk(); if(close!==false)closeModal(); }catch(e){toast(e.message,true);} ok.disabled=false; };
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
    chart:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    trend:'<path d="M3 3v18h18"/><path d="M7 14l3-4 4 3 5-7"/>',
    users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16 14.5a5 5 0 0 1 5 5.5"/>',
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
  }[n]||'';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I}</svg>`;
}
