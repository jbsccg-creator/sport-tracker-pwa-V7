'use strict';

const LS_KEY = 'sportTrackerAB.v13';
const OLD_LS_KEYS = ['sportTrackerAB.v12','sportTrackerAB.v11','sportTrackerAB.v10','sportTrackerAB.v9','sportTrackerAB.v8','sportTrackerAB.v7','sportTrackerAB.v6','sportTrackerAB.v5','sportTrackerAB.v4','sportTrackerAB.v3','sportTrackerAB.v2'];
const DAY_MS = 86400000;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

let state = loadState();
let selectedDate = isoToday();
let selectedFreeId = null;
let currentView = 'today';
let timer = { remaining: 0, interval: null, paused: false, label: 'Repos' };
let emom = { active: false, interval: null, totalRounds: 0, currentRound: 0, remaining: 0, label: 'EMOM' };
let workoutTicker = null;
let deferredInstallPrompt = null;
let syncTimer = null;
let authUser = null;
let cloudBusy = false;

function defaultState() {
  return {
    startDate: localISO(mondayOf(new Date())),
    sessions: {},
    freeSessions: {},
    tests: [],
    routine: {},
    bodyWeights: [{ date: isoToday(), kg: 78 }],
    settings: { vibration: true, sound: true, bodyWeightKg: 78, cloudAutoSync: true },
    cloud: { lastSync: null, lastRestore: null, status: 'Non connecté' }
  };
}
function loadState() {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(LS_KEY) || OLD_LS_KEYS.map(k => localStorage.getItem(k)).find(Boolean);
    const loaded = raw ? JSON.parse(raw) : {};
    const merged = { ...base, ...loaded };
    merged.settings = { ...base.settings, ...(loaded.settings || {}) };
    merged.freeSessions = loaded.freeSessions || {};
    merged.cloud = { ...base.cloud, ...(loaded.cloud || {}) };
    merged.bodyWeights = Array.isArray(loaded.bodyWeights) && loaded.bodyWeights.length ? loaded.bodyWeights : [{ date: isoToday(), kg: Number(loaded.settings?.bodyWeightKg || 78) }];
    return merged;
  } catch (e) { return base; }
}
function saveState(options = {}) { localStorage.setItem(LS_KEY, JSON.stringify(state)); if (options.sync !== false) scheduleAutoSync(); }
function localISO(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function parseISO(iso) { const [y,m,d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); }
function isoToday() { return localISO(new Date()); }
function mondayOf(date) { const d = new Date(date); const off = (d.getDay()+6)%7; d.setDate(d.getDate()-off); d.setHours(0,0,0,0); return d; }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function fmtDate(iso) { return parseISO(iso).toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short'}); }
function fmtLongDate(iso) { return parseISO(iso).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function weekIndexFor(iso) { return Math.max(1, Math.floor((mondayOf(parseISO(iso))-parseISO(state.startDate))/(7*DAY_MS))+1); }
function typeForWeek(w) { return w % 2 ? 'A' : 'B'; }
function dayKeyFor(iso) { return parseISO(iso).getDay(); }
function planForDate(iso) { const week = weekIndexFor(iso); const type = typeForWeek(week); return { week, type, deload: week % 4 === 0, plan: PROGRAMME[type].days[dayKeyFor(iso)] }; }
function esc(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function toNum(v) { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; }
function mmss(sec) { sec = Math.max(0, Math.round(sec)); return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }
function hms(sec) { sec = Math.max(0, Math.round(sec)); const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function formatDecimal(n, d=2) { return toNum(n) ? toNum(n).toFixed(d).replace('.', ',') : '-'; }
function durationInputs(prefix) { return toNum($(`#${prefix}H`)?.value)*3600 + toNum($(`#${prefix}M`)?.value)*60 + toNum($(`#${prefix}S`)?.value); }
function setDurationInputs(prefix, sec) { const h=$(`#${prefix}H`), m=$(`#${prefix}M`), s=$(`#${prefix}S`); if(!h||!m||!s) return; h.value = Math.floor(sec/3600) || ''; m.value = Math.floor((sec%3600)/60) || ''; s.value = Math.floor(sec%60) || ''; }
function avgSpeed(km, sec) { km=toNum(km); sec=toNum(sec); return km>0 && sec>0 ? km/(sec/3600) : 0; }
function pace(km, sec) { km=toNum(km); sec=toNum(sec); return km>0 && sec>0 ? `${mmss(sec/km)}/km` : '-'; }
function makeId(name) { return String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function currentBodyWeight(iso=selectedDate) {
  const rows = [...(state.bodyWeights||[])].filter(r => r.date && toNum(r.kg)).sort((a,b)=>a.date.localeCompare(b.date));
  let chosen = rows[0] || { kg: 78 };
  rows.forEach(r => { if (r.date <= iso) chosen = r; });
  return toNum(chosen.kg) || 78;
}
function getSession(iso) {
  if (isFreeSessionActive() && iso === selectedDate) return getFreeSession(selectedFreeId);
  if (!state.sessions[iso]) state.sessions[iso] = newSession();
  const s = state.sessions[iso];
  s.metrics = s.metrics || {};
  s.exercises = s.exercises || {};
  s.extraExercises = s.extraExercises || [];
  s.hiddenExercises = s.hiddenExercises || [];
  s.stopwatch = s.stopwatch || { elapsedSec: 0, running: false, startedAt: null };
  return s;
}
function newSession() { return { completed:false, freeMode:false, rpe:'', backPain:'', notes:'', metrics:{}, exercises:{}, extraExercises:[], hiddenExercises:[], stopwatch:{elapsedSec:0,running:false,startedAt:null} }; }
function newFreeSession(title='Séance libre') { return { ...newSession(), freeMode:true, title, date:isoToday(), createdAt:new Date().toISOString() }; }
function isFreeSessionActive(){ return Boolean(selectedFreeId && state.freeSessions && state.freeSessions[selectedFreeId] && currentView==='session'); }
function activeSessionId(){ return isFreeSessionActive() ? selectedFreeId : selectedDate; }
function getFreeSession(id){ state.freeSessions = state.freeSessions || {}; if(!state.freeSessions[id]) state.freeSessions[id]=newFreeSession(); return state.freeSessions[id]; }
function elapsedWorkout(sess) { const sw=sess.stopwatch||{}; return Math.round((sw.elapsedSec||0) + (sw.running && sw.startedAt ? (Date.now()-sw.startedAt)/1000 : 0)); }
function allExercisesForSession(iso) { const { plan } = planForDate(iso); const sess = getSession(iso); const hidden = new Set(sess.hiddenExercises || []); const planned = plan.exercises.filter(e => !hidden.has(e.id || makeId(e.name + '-' + (e.kind || '')))); return [...planned, ...(sess.extraExercises||[])]; }
function activeExercisesForSession(iso){ return isFreeSessionActive() && iso === selectedDate ? (getFreeSession(selectedFreeId).extraExercises || []) : allExercisesForSession(iso); }
function hasKind(exercises, kind) { return exercises.some(e => e.kind === kind); }
function getExerciseLog(iso, exercise) {
  const s = getSession(iso); const id = exercise.id || makeId(exercise.name + '-' + (exercise.kind || ''));
  if (!s.exercises[id]) s.exercises[id] = { collapsed:false, sets:[] };
  const log = s.exercises[id];
  const wanted = Math.max(1, Number(exercise.sets || 1));
  while (log.sets.length < wanted) log.sets.push({ done:false, actual:'', load: exercise.defaultLoad || '', note:'' });
  return log;
}
function plannedSets(exs) { return exs.reduce((n,e)=> n + Math.max(1, Number(e.sets||1)),0); }
function doneSets(iso, exs) { return exs.reduce((n,e)=> n + getExerciseLog(iso,e).sets.filter(s=>s.done).length,0); }
function pct(iso, exs) { const total=plannedSets(exs); return total ? Math.round(doneSets(iso, exs)/total*100) : 0; }
function setView(view) { if(view !== 'session') selectedFreeId = null; currentView = view; $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view)); $$('.view').forEach(v => v.classList.toggle('active', v.id === view)); render(); }
function render() { renderToday(); renderPlanning(); renderSession(); renderCharts(); renderRoutine(); renderHistory(); renderSettings(); }

function renderToday() {
  const root = $('#today'); const iso=isoToday(); const {week,type,deload,plan}=planForDate(iso); const exs=allExercisesForSession(iso); const stats=weeklyStats(mondayOf(parseISO(iso))); const todaySession=state.sessions?.[iso]; const isDone=Boolean(todaySession?.completed);
  root.innerHTML = `<section class="card ${isDone?'done-card':''}"><div class="between"><div><p class="eyebrow">Aujourd'hui</p><h2>${esc(fmtLongDate(iso))}</h2></div><span class="badge ${isDone?'done':(deload?'warn':'')}">${isDone?'Terminée':`Semaine ${week} · ${type}${deload?' · allégée':''}`}</span></div><h3>${esc(plan.title)}</h3><p class="muted">${esc(plan.objective)}</p><div class="progressbar"><span style="width:${pct(iso,exs)}%"></span></div><p class="muted">${doneSets(iso,exs)}/${plannedSets(exs)} séries cochées${isDone?' · séance terminée':''}</p><div class="row"><button class="primary" id="goSessionToday">${isDone?'Voir séance terminée':'Démarrer / continuer'}</button><button class="ghost" id="goPlanningToday">Planning</button><button class="ghost" id="goRoutineToday">Routine</button><button class="ghost" id="newFreeToday">+ Séance libre</button></div></section><section class="grid grid-3"><div class="stat"><small>Séances faites cette semaine</small><strong>${stats.doneSessions}</strong></div><div class="stat"><small>Volume total semaine</small><strong>${formatDecimal(stats.volumeKg,0)}</strong><span class="muted"> kg</span></div><div class="stat"><small>Douleur moyenne</small><strong>${stats.avgPain || '-'}</strong><span class="muted"> /10</span></div></section>`;
  $('#goSessionToday').onclick = () => { selectedFreeId=null; selectedDate=isoToday(); setView('session'); };
  $('#goPlanningToday').onclick = () => setView('planning');
  $('#goRoutineToday').onclick = () => setView('routine');
  $('#newFreeToday').onclick = createFreeSession;
}
function createFreeSession(){
  const title = prompt('Nom de la séance libre ?', 'Séance libre') || 'Séance libre';
  const id = `free-${Date.now()}`;
  state.freeSessions = state.freeSessions || {};
  state.freeSessions[id] = newFreeSession(title);
  selectedFreeId = id;
  selectedDate = state.freeSessions[id].date;
  saveState();
  setView('session');
}

function renderPlanning() {
  const root=$('#planning'); const base=mondayOf(parseISO(selectedDate)); const week=weekIndexFor(localISO(base)); const type=typeForWeek(week); const days=Array.from({length:7},(_,i)=>localISO(addDays(base,i)));
  root.innerHTML = `<section class="card"><div class="week-nav"><button class="ghost" id="prevWeek">← Semaine</button><div><p class="eyebrow">Planning</p><h2>Semaine ${week} · ${esc(PROGRAMME[type].label)}</h2><p class="muted">${fmtDate(days[0])} au ${fmtDate(days[6])}</p></div><button class="ghost" id="nextWeek">Semaine →</button></div><div class="row"><button class="ghost" id="todayWeek">Aujourd'hui</button><button class="ghost" id="jumpA">Semaine A suivante</button><button class="ghost" id="jumpB">Semaine B suivante</button></div></section><section class="day-grid">${days.map(dayCard).join('')}</section>`;
  $('#prevWeek').onclick = () => { selectedDate=localISO(addDays(base,-7)); renderPlanning(); };
  $('#nextWeek').onclick = () => { selectedDate=localISO(addDays(base,7)); renderPlanning(); };
  $('#todayWeek').onclick = () => { selectedDate=isoToday(); renderPlanning(); };
  $('#jumpA').onclick = () => jumpWeek('A'); $('#jumpB').onclick = () => jumpWeek('B');
  $$('.day-card').forEach(btn => btn.onclick = () => { selectedDate=btn.dataset.iso; setView('session'); });
}
function jumpWeek(t) { let d=mondayOf(parseISO(selectedDate)); for(let i=0;i<12;i++){ d=addDays(d,7); if(typeForWeek(weekIndexFor(localISO(d)))===t) break; } selectedDate=localISO(d); renderPlanning(); }
function dayCard(iso) { const {week,type,deload,plan}=planForDate(iso); const exs=allExercisesForSession(iso); const s=getSession(iso); return `<button class="day-card ${iso===selectedDate?'active':''} ${s.completed?'done':''}" data-iso="${iso}"><strong>${fmtDate(iso)}</strong><small>${type} · S${week}${deload?' · allégée':''}</small><span class="badge ${s.completed?'done':''}">${pct(iso,exs)}%</span><small>${esc(plan.title)}</small></button>`; }

function renderSession() {
  const root=$('#session'); const freeActive=isFreeSessionActive(); const sess=getSession(selectedDate);
  const basePlan=planForDate(selectedDate); const week=basePlan.week, type=basePlan.type, deload=freeActive ? false : basePlan.deload;
  const plan=freeActive ? { name:'Libre', title:sess.title || 'Séance libre', objective:'Séance libre indépendante des activités planifiées. Ajoute tes exercices puis lance le chrono hors cardio si besoin.', exercises:[] } : basePlan.plan;
  const exs=activeExercisesForSession(selectedDate); const runPlanned=!freeActive && hasKind(exs,'run'); const bikePlanned=!freeActive && hasKind(exs,'bike'); const strengthSec=elapsedWorkout(sess); const runSec=toNum(sess.metrics.runDurationSec); const bikeSec=toNum(sess.metrics.bikeDurationSec);
  const stickyHtml = !sess.completed ? `<section class="sticky-workout-bar" aria-live="polite"><div><span class="eyebrow">Temps séance hors cardio</span><strong id="workoutElapsedSticky">${hms(strengthSec)}</strong></div><div class="sticky-actions"><button class="primary" id="startWorkoutSticky">${sess.stopwatch.running?'En cours': strengthSec ? 'Reprendre' : 'Lancer'}</button><button class="ghost" id="pauseWorkoutSticky">Pause</button><button class="ghost" id="stopWorkoutSticky">Stop</button></div></section>` : '';
  root.innerHTML = `<section class="card ${sess.completed?'done-card':''}"><div class="between"><div><p class="eyebrow">Séance</p><h2>${freeActive?'Séance libre':esc(plan.name)} · ${esc(fmtLongDate(selectedDate))}</h2></div><span class="badge ${sess.completed?'done':(deload?'warn':'')}">${sess.completed?'Terminée':(freeActive?'Libre':`Semaine ${week} · ${type}${deload?' · allégée':''}`)}</span></div><h3>${esc(plan.title)}</h3><p class="muted">${esc(plan.objective)}</p>${freeActive?`<label><span>Nom de la séance libre</span><input id="freeSessionTitle" type="text" value="${esc(sess.title||'Séance libre')}"></label>`:''}<div class="progressbar"><span style="width:${pct(selectedDate,exs)}%"></span></div><p class="muted">${doneSets(selectedDate,exs)}/${plannedSets(exs)} séries cochées · volume estimé : ${formatDecimal(sessionVolumeKg(selectedDate),0)} kg${sess.completed?' · séance terminée':''}</p><div class="row"><button class="ghost" id="prevDay">← Jour</button><button class="ghost" id="nextDay">Jour →</button><button class="ghost" id="backPlanning">Voir planning</button><button class="ghost" id="newFreeFromSession">+ Séance libre</button><button class="danger" id="resetSession">Réinitialiser séance</button></div></section>
  ${!sess.completed ? `<section class="card"><div class="between"><div><p class="eyebrow">Chronomètre hors cardio</p><h3>Muscu, kettlebell, mobilité, poids du corps</h3></div><strong class="big-time" id="workoutElapsed">${hms(strengthSec)}</strong></div><p class="muted">Le vélo et la course se renseignent manuellement après la sortie. Ce chrono sert au reste de la séance.</p><div class="row"><button class="primary" id="startWorkout">${sess.stopwatch.running?'En cours': strengthSec ? 'Reprendre' : 'Lancer séance'}</button><button class="ghost" id="pauseWorkout">Pause</button><button class="ghost" id="stopWorkout">Arrêter</button><button class="danger" id="resetWorkout">Reset chrono</button></div></section>`:''}
  ${!freeActive ? `<section class="card instruction-card"><p class="eyebrow">Consignes avant de partir</p><h3>Ce qui est prévu aujourd'hui</h3><ul class="instruction-list">${plan.exercises.map(e=>`<li><strong>${esc(e.name)}</strong> <span class="muted">${esc(e.target)} · ${esc(e.sets)} x ${esc(e.reps)} · repos ${esc(e.restSec||0)}s</span></li>`).join('')}</ul></section>` : ''}
  ${runPlanned ? cardioBlock('run', sess) : ''}${bikePlanned ? cardioBlock('bike', sess) : ''}
  <section class="card"><div class="between"><div><p class="eyebrow">Exercices</p><h3>Séries, reps, charge et repos</h3></div><span class="badge">Poids actuel : ${formatDecimal(currentBodyWeight(selectedDate),1)} kg</span></div><div id="exerciseList">${exs.filter(e=>e.kind!=='run' && e.kind!=='bike').map(e=>exerciseCard(e)).join('') || '<p class="muted">Aucun exercice pour le moment. Ajoute un exercice ci-dessous.</p>'}</div>${freeBuilder()}</section>
  <section class="card"><h3>Bilan global</h3><div class="grid grid-3"><label><span>Durée hors cardio</span><input id="strengthDurationDisplay" type="text" readonly value="${hms(strengthSec)}"></label><label><span>RPE</span><input id="rpe" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" min="1" max="10" value="${esc(sess.rpe)}" placeholder="/10"></label><label><span>Douleur dos/omoplates</span><input id="backPain" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" min="0" max="10" value="${esc(sess.backPain)}" placeholder="/10"></label></div><label><span>Notes</span><textarea id="notes" placeholder="Sensations, douleur, modifications...">${esc(sess.notes)}</textarea></label><div class="footer-actions"><button class="primary" id="saveSession">${sess.completed?'Mettre à jour':'Enregistrer'}</button><button class="ghost" id="toggleComplete">${sess.completed?'Marquer non terminée':'Marquer terminée'}</button></div></section>
  ${stickyHtml}`;
  setDurationInputs('run', runSec); setDurationInputs('bike', bikeSec); bindSessionEvents(); bindWorkoutTimer(sess); updateCardioComputed();
}

function isEmomExercise(e){ return /emom/i.test(String(e.target||'')) || /emom/i.test(String(e.name||'')); }
function cardioBlock(kind, sess) { const isRun=kind==='run'; const title=isRun?'Course à pied':'Vélo'; const dist=sess.metrics[`${kind}DistanceKm`]||''; const sec=toNum(sess.metrics[`${kind}DurationSec`]); const speed=avgSpeed(dist,sec); return `<section class="card"><h3>Bilan ${title} à renseigner après séance</h3><div class="metric-block"><div class="between"><div><strong>${title}</strong><p class="muted">Distance + temps = vitesse moyenne${isRun?' et allure':''} calculée automatiquement.</p></div><span class="badge" id="${kind}Badge">${formatDecimal(speed,2)} km/h${isRun?' · '+pace(dist,sec):''}</span></div><div class="grid grid-4"><label><span>Distance ${title.toLowerCase()}, km</span><input id="${kind}DistanceKm" type="number" inputmode="decimal" step="0.01" value="${esc(dist)}" placeholder="ex : ${isRun?'7.01':'50.36'}"></label><label><span>Heures</span><input id="${kind}H" type="number" inputmode="numeric" min="0"></label><label><span>Minutes</span><input id="${kind}M" type="number" inputmode="numeric" min="0" max="59"></label><label><span>Secondes</span><input id="${kind}S" type="number" inputmode="numeric" min="0" max="59"></label></div><div class="computed"><span>Vitesse : <strong id="${kind}SpeedOut">${formatDecimal(speed,2)} km/h</strong></span>${isRun?`<span>Allure : <strong id="${kind}PaceOut">${pace(dist,sec)}</strong></span>`:''}</div></div></section>`; }
function exerciseCard(e) { const log=getExerciseLog(selectedDate,e); const id=e.id || makeId(e.name + '-' + e.kind); const bw=e.bodyweight; const tags=(e.muscles||[]).map(m=>`<span>${esc(m)}</span>`).join(''); const emomBtn=isEmomExercise(e)?`<button class="small primary" type="button" data-action="emom" data-rounds="${esc(e.sets||10)}" data-rest="${esc(e.restSec||60)}">Lancer EMOM ${esc(e.sets||10)} min</button>`:''; return `<article class="exercise-card" data-exid="${esc(id)}"><div class="exercise-head-row"><button type="button" class="exercise-head" data-action="toggleExercise"><div><strong>${esc(e.name)}</strong><small class="muted">${esc(e.target)} · prévu ${esc(e.sets)} x ${esc(e.reps)} · repos ${esc(e.restSec||0)}s</small><div class="muscle-tags">${tags}</div></div><span class="badge">${log.sets.filter(s=>s.done).length}/${log.sets.length}</span></button><div class="exercise-actions">${emomBtn}<button class="small danger" type="button" data-action="deleteExercise" title="Supprimer cet exercice">Supprimer</button></div></div><div class="exercise-body ${log.collapsed?'hidden':''}">${log.sets.map((s,i)=>setRow(e,id,s,i,bw)).join('')}</div></article>`; }
function setRow(e,id,s,i,bw) {
  const noLoad = noLoadExercise(e);
  const loadBlock = noLoad
    ? `<label class="no-volume-field"><span>Charge</span><input readonly value="Non comptabilisée"></label><label class="no-volume-field"><span>Volume</span><input data-volume="true" readonly value="-"></label>`
    : `<label><span>${bw?'Lest ajouté kg':'Charge kg'}</span><input data-field="load" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" step="0.5" value="${esc(s.load || e.defaultLoad || '')}" placeholder="${bw?'0':e.defaultLoad||0}"></label><label><span>Volume estimé</span><input data-volume="true" readonly value="${formatDecimal(setVolume(e,s),0)} kg"></label>`;
  return `<div class="set-row ${s.done?'done':''}" data-exid="${esc(id)}" data-set="${i}"><label><span>Série ${i+1}</span><input type="checkbox" data-field="done" ${s.done?'checked':''}></label><label><span>Réel reps/temps</span><input data-field="actual" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" pattern="[0-9.,:/ -]*" value="${esc(s.actual)}" placeholder="${esc(e.reps)}"></label>${loadBlock}<button class="small ghost" type="button" data-action="rest" data-rest="${e.restSec||0}">Repos</button></div>`;
}
function freeBuilder() { return `<div class="free-builder"><div class="between"><div><h3>Séance libre / exercice ajouté</h3><p class="muted">Ajoute un exercice si tu n'as pas pu respecter l'ordre ou si tu fais autre chose.</p></div><label style="max-width:210px"><span>Mode séance libre</span><select id="freeMode"><option value="false">Non</option><option value="true" ${getSession(selectedDate).freeMode?'selected':''}>Oui</option></select></label></div><div class="grid grid-4"><label><span>Exercice</span><select id="addExerciseName">${EXERCISE_LIBRARY.map(e=>`<option value="${esc(e.name)}">${esc(e.name)} · ${esc(e.muscles.join('/'))}</option>`).join('')}</select></label><label><span>Séries</span><input id="addExerciseSets" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="3" min="1"></label><label><span>Répétitions prévues</span><input id="addExerciseReps" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" pattern="[0-9.,:/ -]*" value="10"></label><label><span>Repos s</span><input id="addExerciseRest" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" value="90"></label></div><div class="footer-actions"><button class="primary" id="addExerciseBtn" type="button">Ajouter exercice</button></div></div>`; }
function bindSessionEvents() {
  $('#prevDay').onclick=()=>{ selectedFreeId=null; selectedDate=localISO(addDays(parseISO(selectedDate),-1)); renderSession(); };
  $('#nextDay').onclick=()=>{ selectedFreeId=null; selectedDate=localISO(addDays(parseISO(selectedDate),1)); renderSession(); };
  $('#backPlanning').onclick=()=>setView('planning'); $('#newFreeFromSession').onclick=createFreeSession; $('#resetSession').onclick=resetCurrentSession; $('#saveSession').onclick=completeCurrentSession;
  const titleInput=$('#freeSessionTitle'); if(titleInput) titleInput.oninput=e=>{ getSession(selectedDate).title=e.target.value; saveState(); };
  $('#toggleComplete').onclick=()=>{ const s=getSession(selectedDate); if(s.completed){ saveSessionForm(false); s.completed=false; saveState(); render(); } else { completeCurrentSession(); } };
  $('#freeMode').onchange=e=>{ getSession(selectedDate).freeMode=e.target.value==='true'; saveState(); renderSession(); };
  $('#addExerciseBtn').onclick=addFreeExercise;
  ['run','bike'].forEach(kind=>['DistanceKm','H','M','S'].forEach(part=>{ const el=$(`#${kind}${part}`); if(el) el.oninput=()=>{ updateCardioComputed(); saveSessionForm(false); }; }));
  ['rpe','backPain','notes'].forEach(id=>{ const el=$(`#${id}`); if(el) el.oninput=()=>saveSessionForm(false); });
  $('#session').onclick = e => { const action=e.target.dataset.action; if(action==='toggleExercise'){ const card=e.target.closest('.exercise-card'); const body=card.querySelector('.exercise-body'); body.classList.toggle('hidden'); const log=findExerciseLogById(card.dataset.exid); if(log){ log.collapsed=body.classList.contains('hidden'); saveState(); } } if(action==='rest'){ const sec=Number(e.target.dataset.rest||0); if(sec) startTimer(sec,'Repos série'); } if(action==='emom'){ const card=e.target.closest('.exercise-card'); const rounds=Number(e.target.dataset.rounds||10); const rest=Number(e.target.dataset.rest||60); const title=card?.querySelector('strong')?.textContent || 'EMOM'; startEmom(rounds, rest, title); } if(action==='deleteExercise'){ deleteExerciseFromSession(e.target.closest('.exercise-card')?.dataset.exid); } };
  $$('#session .set-row input[type="checkbox"]').forEach(input => input.onchange = e => { updateSetFromRow(e.target.closest('.set-row'), true); });
  $$('#session .set-row input:not([type="checkbox"])').forEach(input => { input.oninput = e => updateSetFromRow(e.target.closest('.set-row'), false); input.onchange = e => updateSetFromRow(e.target.closest('.set-row'), false); });
}
function findExerciseLogById(id){ return getSession(selectedDate).exercises[id]; }
function exerciseById(id){ return allExercisesForSession(selectedDate).find(e => (e.id || makeId(e.name + '-' + (e.kind || ''))) === id); }
function updateSetFromRow(row, maybeRest=true){
  if(!row) return;
  const log=findExerciseLogById(row.dataset.exid); if(!log) return;
  const set=log.sets[Number(row.dataset.set)]; if(!set) return;
  const wasDone=!!set.done;
  row.querySelectorAll('input').forEach(inp=>{ const f=inp.dataset.field; if(!f) return; set[f] = f==='done' ? inp.checked : inp.value; });
  saveSessionForm(false);
  const card=row.closest('.exercise-card');
  const ex=exerciseById(row.dataset.exid);
  const vol=row.querySelector('input[data-volume="true"]'); if(vol && ex && !noLoadExercise(ex)) vol.value=`${formatDecimal(setVolume(ex,set),0)} kg`; else if(vol && ex && noLoadExercise(ex)) vol.value='-';
  if(set.done && !wasDone && maybeRest){
    if(ex && isEmomExercise(ex)){ if(!emom.active) startEmom(Number(ex.sets||10), Number(ex.restSec||60), ex.name); }
    else { const restBtn=row.querySelector('[data-action="rest"]'); const sec=Number(restBtn?.dataset.rest||0); if(sec) startTimer(sec,'Repos série'); }
  }
  if(maybeRest){
    if(card){ const badge=card.querySelector('.badge'); if(badge) badge.textContent=`${log.sets.filter(s=>s.done).length}/${log.sets.length}`; row.classList.toggle('done', !!set.done); }
    const exs=activeExercisesForSession(selectedDate); const progress=$('#session .progressbar span'); if(progress) progress.style.width=`${pct(selectedDate,exs)}%`;
  }
}
function addFreeExercise(){ const name=$('#addExerciseName').value; const base=EXERCISE_LIBRARY.find(e=>e.name===name) || {}; const custom={...base, id:'free-'+Date.now(), name, sets:Number($('#addExerciseSets').value||1), reps:$('#addExerciseReps').value||base.defaultReps||'', target:'Ajout libre', restSec:Number($('#addExerciseRest').value||base.restSec||0), kind:base.kind||'strength', muscles:base.muscles||[], bodyweight:!!base.bodyweight, defaultLoad:base.defaultLoad||0}; getSession(selectedDate).extraExercises.push(custom); saveState(); renderSession(); }
function resetCurrentSession(){ if(!confirm('Réinitialiser toute la séance ? Les séries, notes, cardio et chrono seront supprimés.')) return; if(isFreeSessionActive()){ const id=selectedFreeId; delete state.freeSessions[id]; selectedFreeId=null; saveState(); setView('today'); return; } delete state.sessions[selectedDate]; saveState(); renderSession(); }
function completeCurrentSession(){
  const s=getSession(selectedDate);
  saveSessionForm(false);
  if(s.stopwatch?.running){
    s.stopwatch.elapsedSec=elapsedWorkout(s);
    s.stopwatch.running=false;
    s.stopwatch.startedAt=null;
  }
  s.metrics=s.metrics||{};
  s.metrics.strengthDurationSec=elapsedWorkout(s);
  s.metrics.volumeKg=sessionVolumeKg(selectedDate);
  s.completed=true;
  s.completedAt=new Date().toISOString();
  saveState();
  render();
  const msg=document.createElement('div');
  msg.className='toast';
  msg.textContent='Séance enregistrée et terminée.';
  document.body.appendChild(msg);
  setTimeout(()=>msg.remove(),2200);
}
function deleteExerciseFromSession(id){ if(!id) return; if(!confirm('Supprimer cet exercice de la séance du jour ?')) return; const s=getSession(selectedDate); s.extraExercises=(s.extraExercises||[]).filter(e => (e.id || makeId(e.name + '-' + (e.kind || ''))) !== id); s.hiddenExercises=s.hiddenExercises||[]; if(!s.hiddenExercises.includes(id)) s.hiddenExercises.push(id); delete s.exercises[id]; saveState(); renderSession(); }
function bindWorkoutTimer(sess){
  clearInterval(workoutTicker);
  const update=()=>{
    const sec=elapsedWorkout(sess);
    ['#workoutElapsed','#workoutElapsedSticky'].forEach(sel=>{ const out=$(sel); if(out) out.textContent=hms(sec); });
    const disp=$('#strengthDurationDisplay'); if(disp) disp.value=hms(sec);
    ['#startWorkout','#startWorkoutSticky'].forEach(sel=>{ const btn=$(sel); if(btn) btn.textContent=sess.stopwatch.running?'En cours': sec?(sel.includes('Sticky')?'Reprendre':'Reprendre'):(sel.includes('Sticky')?'Lancer':'Lancer séance'); });
  };
  const start=()=>{ if(!sess.stopwatch.running){ sess.stopwatch.running=true; sess.stopwatch.startedAt=Date.now(); saveState(); update(); } };
  const pause=()=>{ if(sess.stopwatch.running){ sess.stopwatch.elapsedSec=elapsedWorkout(sess); sess.stopwatch.running=false; sess.stopwatch.startedAt=null; saveSessionForm(false); saveState(); update(); } };
  const stop=()=>{ sess.stopwatch.elapsedSec=elapsedWorkout(sess); sess.stopwatch.running=false; sess.stopwatch.startedAt=null; saveSessionForm(false); saveState(); update(); };
  const reset=()=>{ if(confirm('Remettre le chrono hors cardio à zéro ?')){ sess.stopwatch={elapsedSec:0,running:false,startedAt:null}; saveSessionForm(false); saveState(); update(); } };
  update(); workoutTicker=setInterval(update,1000);
  const bStart=$('#startWorkout'); if(bStart) bStart.onclick=start;
  const bPause=$('#pauseWorkout'); if(bPause) bPause.onclick=pause;
  const bStop=$('#stopWorkout'); if(bStop) bStop.onclick=stop;
  const bReset=$('#resetWorkout'); if(bReset) bReset.onclick=reset;
  const bs=$('#startWorkoutSticky'); if(bs) bs.onclick=start;
  const bp=$('#pauseWorkoutSticky'); if(bp) bp.onclick=pause;
  const bst=$('#stopWorkoutSticky'); if(bst) bst.onclick=stop;
}
function updateCardioComputed(){ ['run','bike'].forEach(kind=>{ const km=$(`#${kind}DistanceKm`)?.value||''; const sec=durationInputs(kind); const sp=avgSpeed(km,sec); const speedOut=$(`#${kind}SpeedOut`); if(speedOut) speedOut.textContent=`${formatDecimal(sp,2)} km/h`; const paceOut=$(`#${kind}PaceOut`); if(paceOut) paceOut.textContent=pace(km,sec); const badge=$(`#${kind}Badge`); if(badge) badge.textContent=`${formatDecimal(sp,2)} km/h${kind==='run'?' · '+pace(km,sec):''}`; }); }
function saveSessionForm(repaint=true){ const s=getSession(selectedDate); ['run','bike'].forEach(kind=>{ const dist=$(`#${kind}DistanceKm`)?.value; if(dist!==undefined){ const sec=durationInputs(kind); s.metrics[`${kind}DistanceKm`]=dist; s.metrics[`${kind}DurationSec`]=sec; s.metrics[`${kind}AvgSpeed`]=avgSpeed(dist,sec).toFixed(2); if(kind==='run') s.metrics.runPace=pace(dist,sec); } }); s.metrics.strengthDurationSec=elapsedWorkout(s); s.rpe=$('#rpe')?.value||s.rpe||''; s.backPain=$('#backPain')?.value||s.backPain||''; s.notes=$('#notes')?.value||s.notes||''; s.metrics.volumeKg=sessionVolumeKg(selectedDate); saveState(); if(repaint) renderSession(); }

function parseReps(v){ const m=String(v||'').replace(',', '.').match(/[0-9]+(\.[0-9]+)?/); return m ? Number(m[0]) : 0; }
function noLoadExercise(ex){
  const txt=[ex.name, ex.target, ...(ex.muscles||[])].join(' ').toLowerCase();
  return /gainage|abdos|tronc|planche|plank|dead bug|relev[ée] de jambes|rotation russe|crunch|hollow/.test(txt);
}
function setDurationLikeValue(v){
  const str=String(v||'').toLowerCase();
  const n=parseReps(str);
  if(!n) return 0;
  if(/min/.test(str)) return n * 60;
  if(/s|sec/.test(str)) return n;
  return n;
}
function setVolume(ex,set,iso=selectedDate){
  if(!set.done || noLoadExercise(ex)) return 0;
  const reps=parseReps(set.actual) || parseReps(ex.reps);
  if(!reps) return 0;
  const load=toNum(set.load || ex.defaultLoad);
  const effective = ex.bodyweight ? currentBodyWeight(iso) + load : load;
  return Math.max(0,effective) * reps;
}
function setStimulus(ex,set,iso=selectedDate){
  if(!set.done) return 0;
  const reps=parseReps(set.actual) || parseReps(ex.reps);
  const seconds=setDurationLikeValue(set.actual) || setDurationLikeValue(ex.reps);
  const volume=setVolume(ex,set,iso);
  if(noLoadExercise(ex)) return Math.max(1, seconds ? seconds/10 : reps || 1);
  if(volume>0) return Math.max(1, volume/100);
  return Math.max(1, reps || seconds/10 || 1);
}
function sessionVolumeKg(iso){ return activeExercisesForSession(iso).filter(e=>e.kind!=='run'&&e.kind!=='bike'&&e.kind!=='mobility'&&!noLoadExercise(e)).reduce((sum,e)=>{ const log=getExerciseLog(iso,e); return sum + log.sets.reduce((n,s)=>n+setVolume(e,s,iso),0); },0); }
function weeklyStats(baseMonday){ const days=Array.from({length:7},(_,i)=>localISO(addDays(baseMonday,i))); let done=0,totalSets=0,doneSet=0,pains=[],vol=0; days.forEach(iso=>{ const s=getSession(iso); const exs=allExercisesForSession(iso); if(s.completed) done++; totalSets+=plannedSets(exs); doneSet+=doneSets(iso,exs); if(toNum(s.backPain)) pains.push(toNum(s.backPain)); vol+=sessionVolumeKg(iso); }); return {doneSessions:done,totalSets,doneSets:doneSet,avgPain:pains.length?formatDecimal(pains.reduce((a,b)=>a+b,0)/pains.length,1):'', volumeKg:vol}; }

function renderRoutine(){ const root=$('#routine'); const iso=isoToday(); state.routine[iso]=state.routine[iso]||{}; const done=DAILY_ROUTINE.filter((_,i)=>state.routine[iso][i]).length; root.innerHTML=`<section class="card"><div class="between"><div><p class="eyebrow">Routine quotidienne</p><h2>Haut du dos / omoplates</h2></div><span class="badge">${done}/${DAILY_ROUTINE.length}</span></div><p class="muted">Routine courte pour renforcer la zone douloureuse à vélo.</p><div class="progressbar"><span style="width:${Math.round(done/DAILY_ROUTINE.length*100)}%"></span></div></section><section class="card">${DAILY_ROUTINE.map((it,i)=>`<div class="routine-item" data-i="${i}"><input type="checkbox" ${state.routine[iso][i]?'checked':''}><div><strong>${esc(it.name)}</strong><div class="muted">${esc(it.target)} · ${esc(it.sets)} x ${esc(it.reps)}</div></div><span class="badge">${it.restSec||0}s</span></div>`).join('')}<div class="footer-actions"><button class="ghost" id="resetRoutine">Réinitialiser aujourd'hui</button></div></section>`; $$('.routine-item input').forEach(inp=>inp.onchange=e=>{ const i=Number(e.target.closest('.routine-item').dataset.i); state.routine[iso][i]=e.target.checked; saveState(); if(e.target.checked && DAILY_ROUTINE[i].restSec) startTimer(DAILY_ROUTINE[i].restSec,`Routine · ${DAILY_ROUTINE[i].name}`); renderRoutine(); }); $('#resetRoutine').onclick=()=>{ state.routine[iso]={}; saveState(); renderRoutine(); }; }
function renderCharts(){ const root=$('#charts'); const range=state.settings.chartRangeDays || 30; root.innerHTML=`<section class="card"><div class="between"><div><p class="eyebrow">Graphiques</p><h2>Progression visuelle</h2></div><label style="max-width:220px"><span>Plage de temps</span><select id="chartRange"><option value="7" ${range==7?'selected':''}>7 jours</option><option value="30" ${range==30?'selected':''}>30 jours</option><option value="90" ${range==90?'selected':''}>90 jours</option><option value="365" ${range==365?'selected':''}>1 an</option><option value="9999" ${range==9999?'selected':''}>Tout</option></select></label></div><p class="muted">Volume, cardio, douleur, poids et répartition par zones du corps.</p></section><section class="grid grid-2"><div class="card"><h3>Zones du corps travaillées</h3><canvas class="chart polar" id="chartMuscles"></canvas><p class="muted">Répartition pondérée par muscle principal/secondaire. Le gainage et les abdos comptent en stimulus, pas en kilos soulevés.</p></div>${chartCard('chartVolume','Volume muscu hebdomadaire')}${chartCard('chartCardio','Distance course/vélo')}${chartCard('chartPain','Douleur haut du dos')}${chartCard('chartWeight','Évolution du poids')}</section><section class="card"><h3>Ajouter un test</h3><div class="grid grid-3"><label><span>Type</span><select id="testType">${TESTS.map(t=>`<option value="${t.key}">${t.label}</option>`).join('')}</select></label><label><span>Valeur</span><input id="testValue" type="text" inputmode="decimal" placeholder="ex : 42:30 ou 35.2"></label><label><span>Date</span><input id="testDate" type="date" value="${isoToday()}"></label></div><div class="footer-actions"><button class="primary" id="addTest">Ajouter le test</button></div></section>`; setTimeout(drawCharts,0); $('#chartRange').onchange=e=>{ state.settings.chartRangeDays=Number(e.target.value); saveState({sync:false}); drawCharts(); }; $('#addTest').onclick=()=>{ state.tests.push({date:$('#testDate').value,type:$('#testType').value,value:$('#testValue').value}); saveState(); renderCharts(); }; }
function chartCard(id,title){ return `<div class="card"><h3>${esc(title)}</h3><canvas class="chart" id="${id}"></canvas></div>`; }
function lastWeeks(n=8){ const cur=mondayOf(parseISO(selectedDate)); return Array.from({length:n},(_,i)=>mondayOf(addDays(cur,-7*(n-1-i)))); }
function chartRangeStart(){ const days=Number(state.settings.chartRangeDays||30); if(days>=9999) return '0000-01-01'; return localISO(addDays(parseISO(isoToday()), -days + 1)); }
function inChartRange(iso){ return iso >= chartRangeStart() && iso <= isoToday(); }
function drawCharts(){ const rangeDays=Number(state.settings.chartRangeDays||30); const weekCount=rangeDays>=365?52:rangeDays>=90?13:rangeDays>=30?8:4; const weeks=lastWeeks(weekCount); const labels=weeks.map(w=>`S${weekIndexFor(localISO(w))}`); const volumes=weeks.map(w=>Math.round(weeklyStats(w).volumeKg)); const run=weeks.map(w=>sumWeekMetric(w,'runDistanceKm')); const bike=weeks.map(w=>sumWeekMetric(w,'bikeDistanceKm')); const pain=weeks.map(w=>toNum(weeklyStats(w).avgPain)); drawPolar('chartMuscles', muscleZoneTotals()); drawBar('chartVolume',labels,volumes,'kg'); drawGrouped('chartCardio',labels,run,bike,'course km','vélo km'); drawLine('chartPain',labels,pain,'/10'); const weights=(state.bodyWeights||[]).filter(r=>inChartRange(r.date)).slice(-12); drawLine('chartWeight',weights.map(r=>r.date.slice(5)),weights.map(r=>toNum(r.kg)),'kg'); }
function sumWeekMetric(w,key){ return Array.from({length:7},(_,i)=>localISO(addDays(w,i))).reduce((n,iso)=>n+toNum(getSession(iso).metrics?.[key]),0); }
function muscleZone(m){ m=String(m||'').toLowerCase(); if(['dos','haut du dos'].includes(m)) return 'Dos'; if(['jambes','fessiers','ischios','mollets'].includes(m)) return 'Jambes'; if(['pectoraux'].includes(m)) return 'Torse'; if(['epaules','épaules'].includes(m)) return 'Épaules'; if(['biceps','triceps'].includes(m)) return 'Bras'; if(['gainage','abdos','tronc'].includes(m)) return 'Tronc'; return null; }
function exerciseZoneWeights(ex){
  const n=String(ex.name||'').toLowerCase();
  const t=String(ex.target||'').toLowerCase();
  const has=(word)=>n.includes(word)||t.includes(word);
  let w={};
  if(has('traction')) w={Dos:1, Bras:0.45, 'Épaules':0.15, Tronc:0.10};
  else if(has('rowing')) w={Dos:1, Bras:0.35, 'Épaules':0.25, Tronc:0.10};
  else if(has('dips')) w={Torse:1, Bras:0.75, 'Épaules':0.35, Tronc:0.10};
  else if(has('pompes')) w={Torse:1, Bras:0.65, 'Épaules':0.30, Tronc:0.25};
  else if(has('goblet') || has('squat')) w={Jambes:1, Tronc:0.35, Dos:0.15};
  else if(has('swing')) w={Jambes:1, Dos:0.45, Tronc:0.35, 'Épaules':0.10};
  else if(has('rdl') || has('soulevé')) w={Jambes:1, Dos:0.35, Tronc:0.30};
  else if(has('fentes') || has('step-up') || has('mollets')) w={Jambes:1, Tronc:0.20};
  else if(has('presse épaules') || has('pike')) w={'Épaules':1, Bras:0.55, Tronc:0.20};
  else if(has('halo')) w={'Épaules':1, Dos:0.45, Tronc:0.25};
  else if(has('y-t-w') || has('snow angels') || has('scapular')) w={Dos:1, 'Épaules':0.55, Tronc:0.15};
  else if(has('dead hang')) w={Dos:0.65, 'Épaules':0.65, Bras:0.25};
  else if(noLoadExercise(ex)) w={Tronc:1};
  else {
    (ex.muscles||[]).forEach((m,i)=>{ const z=muscleZone(m); if(z) w[z]=Math.max(w[z]||0, i===0?1:0.45); });
  }
  return w;
}
function muscleZoneTotals(){
  const totals={Dos:0,Jambes:0,Torse:0,'Épaules':0,Bras:0,Tronc:0};
  Object.keys(state.sessions||{}).filter(inChartRange).forEach(iso=>{
    activeExercisesForSession(iso).filter(e=>e.kind!=='run'&&e.kind!=='bike').forEach(e=>{
      const log=getExerciseLog(iso,e); const weights=exerciseZoneWeights(e); const weightSum=Object.values(weights).reduce((a,b)=>a+b,0) || 1;
      (log.sets||[]).forEach(set=>{ const stimulus=setStimulus(e,set,iso); Object.entries(weights).forEach(([z,w])=>{ totals[z]+=stimulus*(w/weightSum); }); });
    });
  });
  return totals;
}
function setupCanvas(id){ const c=document.getElementById(id); if(!c) return null; const r=c.getBoundingClientRect(); c.width=Math.max(320,r.width*devicePixelRatio); c.height=Math.max(220,r.height*devicePixelRatio); const ctx=c.getContext('2d'); ctx.scale(devicePixelRatio,devicePixelRatio); return {c,ctx,w:r.width||360,h:r.height||220}; }
function axes(ctx,w,h){ ctx.strokeStyle='rgba(148,163,184,.25)'; ctx.beginPath(); ctx.moveTo(35,15); ctx.lineTo(35,h-30); ctx.lineTo(w-10,h-30); ctx.stroke(); }
function drawBar(id,labels,vals,suf){ const s=setupCanvas(id); if(!s) return; const {ctx,w,h}=s; ctx.clearRect(0,0,w,h); axes(ctx,w,h); const max=Math.max(...vals,1); const gap=8,bw=(w-55)/vals.length-gap; vals.forEach((v,i)=>{ const bh=(h-55)*v/max, x=42+i*(bw+gap), y=h-30-bh; ctx.fillStyle='#38bdf8'; round(ctx,x,y,bw,bh,7); ctx.fill(); ctx.fillStyle='#9fb7d8'; ctx.fillText(labels[i],x,h-10); if(v){ ctx.fillStyle='#f8fafc'; ctx.fillText(String(v),x,y-5); } }); ctx.fillStyle='#9fb7d8'; ctx.fillText(suf,38,12); }
function drawGrouped(id,labels,a,b,al,bl){ const s=setupCanvas(id); if(!s) return; const {ctx,w,h}=s; ctx.clearRect(0,0,w,h); axes(ctx,w,h); const max=Math.max(...a,...b,1); const gap=8,gw=(w-55)/labels.length-gap,bw=gw/2.4; labels.forEach((lab,i)=>{ [a[i],b[i]].forEach((v,j)=>{ const bh=(h-55)*v/max,x=42+i*(gw+gap)+j*(bw+3); ctx.fillStyle=j?'#22c55e':'#38bdf8'; round(ctx,x,h-30-bh,bw,bh,6); ctx.fill(); }); ctx.fillStyle='#9fb7d8'; ctx.fillText(lab,42+i*(gw+gap),h-10); }); ctx.fillStyle='#38bdf8'; ctx.fillText(al,38,12); ctx.fillStyle='#22c55e'; ctx.fillText(bl,120,12); }
function drawLine(id,labels,vals,suf){ const s=setupCanvas(id); if(!s) return; const {ctx,w,h}=s; ctx.clearRect(0,0,w,h); axes(ctx,w,h); if(vals.length<1) return; const max=Math.max(...vals,1), min=Math.min(...vals.filter(v=>v>0),0); const span=Math.max(1,max-min); const pts=vals.map((v,i)=>[40+(i*((w-55)/Math.max(1,vals.length-1))), h-30-(h-55)*((v-min)/span)]); ctx.strokeStyle='#38bdf8'; ctx.lineWidth=3; ctx.beginPath(); pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.stroke(); pts.forEach(([x,y],i)=>{ ctx.fillStyle='#22c55e'; ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#9fb7d8'; ctx.fillText(labels[i]||'',x-8,h-10); }); ctx.fillStyle='#9fb7d8'; ctx.fillText(suf,38,12); }
function drawPolar(id, data){ const s=setupCanvas(id); if(!s) return; const {ctx,w,h}=s; ctx.clearRect(0,0,w,h); const labels=Object.keys(data); const vals=Object.values(data); const max=Math.max(...vals,1); const cx=w/2, cy=h/2+8, r=Math.min(w,h)*0.30; ctx.strokeStyle='rgba(148,163,184,.18)'; ctx.fillStyle='#9fb7d8'; ctx.font='12px system-ui'; for(let ring=1;ring<=4;ring++){ ctx.beginPath(); ctx.arc(cx,cy,r*ring/4,0,Math.PI*2); ctx.stroke(); } labels.forEach((lab,i)=>{ const a=-Math.PI/2 + i*2*Math.PI/labels.length; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r); ctx.stroke(); ctx.fillText(lab,cx+Math.cos(a)*(r+22)-18,cy+Math.sin(a)*(r+22)); }); ctx.beginPath(); labels.forEach((lab,i)=>{ const a=-Math.PI/2+i*2*Math.PI/labels.length; const rr=r*(data[lab]/max); const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr; i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); ctx.fillStyle='rgba(56,189,248,.28)'; ctx.strokeStyle='#38bdf8'; ctx.lineWidth=3; ctx.fill(); ctx.stroke(); labels.forEach((lab,i)=>{ const a=-Math.PI/2+i*2*Math.PI/labels.length; const rr=r*(data[lab]/max); ctx.fillStyle='#38bdf8'; ctx.beginPath(); ctx.arc(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,3,0,Math.PI*2); ctx.fill(); }); }
function round(ctx,x,y,w,h,r){ const rr=Math.min(r,w/2,Math.abs(h)/2); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath(); }

function historyRows(){
  const today=isoToday();
  const planned=Object.entries(state.sessions||{}).filter(([iso,s])=>iso<=today && s && s.completed).map(([iso,s])=>({kind:'planned', id:iso, iso, s, title:planForDate(iso).plan.title, prefix:planForDate(iso).type}));
  const free=Object.entries(state.freeSessions||{}).filter(([,s])=>s && s.completed && (s.date||today)<=today).map(([id,s])=>({kind:'free', id, iso:s.date||today, s, title:s.title||'Séance libre', prefix:'Libre'}));
  return [...planned, ...free].sort((a,b)=>(b.s.completedAt||b.iso).localeCompare(a.s.completedAt||a.iso)).slice(0,160);
}
function renderHistory(){ const root=$('#history'); const rows=historyRows(); root.innerHTML=`<section class="card"><div class="between"><div><p class="eyebrow">Historique</p><h2>Séances réalisées</h2><p class="muted">Seulement les séances terminées, de aujourd'hui vers le passé. Les séances libres sont incluses.</p></div><span class="badge done">${rows.length} terminées</span></div><div class="footer-actions"><button class="primary" id="exportJson">Exporter JSON</button><button class="ghost" id="exportCsv">Exporter CSV</button><label class="ghost">Importer JSON<input id="importJson" type="file" accept="application/json" class="hidden"></label></div></section><section class="card"><div style="overflow:auto"><table class="table"><thead><tr><th>Date</th><th>Séance</th><th>Statut</th><th>Course</th><th>Vélo</th><th>Hors cardio</th><th>Volume</th><th>RPE</th><th>Douleur</th><th>Notes</th></tr></thead><tbody>${rows.length?rows.map(({iso,s,title,prefix})=>`<tr><td>${fmtDate(iso)}</td><td>${esc(prefix)} · ${esc(title)}</td><td>Terminée</td><td>${esc(s.metrics?.runDistanceKm||'')} ${s.metrics?.runDistanceKm?'km':''} ${s.metrics?.runAvgSpeed?'· '+esc(s.metrics.runAvgSpeed)+' km/h':''}</td><td>${esc(s.metrics?.bikeDistanceKm||'')} ${s.metrics?.bikeDistanceKm?'km':''} ${s.metrics?.bikeAvgSpeed?'· '+esc(s.metrics.bikeAvgSpeed)+' km/h':''}</td><td>${hms(s.metrics?.strengthDurationSec||s.stopwatch?.elapsedSec||0)}</td><td>${formatDecimal(s.metrics?.volumeKg||0,0)} kg</td><td>${esc(s.rpe||'')}</td><td>${esc(s.backPain||'')}</td><td>${esc((s.notes||'').slice(0,80))}</td></tr>`).join(''):`<tr><td colspan="10" class="muted">Aucune séance terminée pour le moment. Dans l'onglet Séance, utilise le bouton Enregistrer ou Marquer terminée.</td></tr>`}</tbody></table></div></section>`; $('#exportJson').onclick=exportJSON; $('#exportCsv').onclick=exportCSV; $('#importJson').onchange=importJSON; }

function renderSettings(){
  const root=$('#settings');
  root.innerHTML=`${authCardHtml()}<section class="card"><p class="eyebrow">Réglages</p><h2>Programme, poids et alertes</h2><div class="grid grid-3"><label><span>Date de début du programme</span><input id="startDate" type="date" value="${state.startDate}"></label><label><span>Son fin de repos</span><select id="sound"><option value="true" ${state.settings.sound!==false?'selected':''}>Oui</option><option value="false" ${state.settings.sound===false?'selected':''}>Non</option></select></label><label><span>Vibration fin de repos</span><select id="vibration"><option value="true" ${state.settings.vibration?'selected':''}>Oui</option><option value="false" ${!state.settings.vibration?'selected':''}>Non</option></select></label></div></section><section class="card"><h3>Suivi du poids corporel</h3><p class="muted">Le dernier poids connu à la date de la séance est utilisé pour calculer le volume des exercices au poids du corps : tractions, dips, pompes et exercices lestés au poids du corps. Le gainage/abdos n'est pas compté comme charge soulevée.</p><div class="grid grid-3"><label><span>Date</span><input id="weightDate" type="date" value="${isoToday()}"></label><label><span>Poids, kg</span><input id="weightKg" type="number" inputmode="decimal" step="0.1" value="${formatDecimal(currentBodyWeight(),1).replace(',','.')}"></label><div style="align-self:end"><button class="primary" id="addWeight">Ajouter poids</button></div></div><div style="overflow:auto;margin-top:14px"><table class="table"><thead><tr><th>Date</th><th>Poids</th></tr></thead><tbody>${[...(state.bodyWeights||[])].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr><td>${esc(r.date)}</td><td>${formatDecimal(r.kg,1)} kg</td></tr>`).join('')}</tbody></table></div><div class="footer-actions"><button class="danger" id="resetAll">Réinitialiser toutes les données locales</button></div></section>`;
  bindAuthControls();
  $('#startDate').onchange=e=>{ state.startDate=e.target.value; saveState(); render(); };
  $('#sound').onchange=e=>{ state.settings.sound=e.target.value==='true'; saveState(); };
  $('#vibration').onchange=e=>{ state.settings.vibration=e.target.value==='true'; saveState(); };
  $('#addWeight').onclick=()=>{ const date=$('#weightDate').value, kg=toNum($('#weightKg').value); if(date&&kg){ state.bodyWeights.push({date,kg}); state.settings.bodyWeightKg=kg; saveState(); render(); } };
  $('#resetAll').onclick=()=>{ if(confirm('Supprimer toutes les données locales ?')){ localStorage.removeItem(LS_KEY); location.reload(); } };
}

function supabaseReady(){ return Boolean(window.supabaseClient && window.supabaseClient.auth); }
function cloudStatusText(){
  if(!supabaseReady()) return 'Supabase non configuré';
  if(authUser) return `Connecté : ${authUser.email || authUser.id}`;
  return state.cloud?.status || 'Non connecté';
}
function authCardHtml(){
  const connected = Boolean(authUser);
  const lastSync = state.cloud?.lastSync ? new Date(state.cloud.lastSync).toLocaleString('fr-FR') : '-';
  const lastRestore = state.cloud?.lastRestore ? new Date(state.cloud.lastRestore).toLocaleString('fr-FR') : '-';
  return `<section class="card"><div class="between"><div><p class="eyebrow">Compte & Sync</p><h2>Supabase</h2><p class="muted">Sauvegarde cloud de tes séances, séries, poids et routines. Tes données restent aussi disponibles en local.</p></div><span class="badge ${connected?'done':'warn'}" id="cloudBadge">${esc(cloudStatusText())}</span></div><div class="grid grid-3"><label><span>Email</span><input id="authEmail" type="email" autocomplete="email" placeholder="ton@email.com"></label><label><span>Mot de passe</span><input id="authPassword" type="password" autocomplete="current-password" placeholder="••••••••"></label><label><span>Synchronisation auto</span><select id="cloudAutoSync"><option value="true" ${state.settings.cloudAutoSync!==false?'selected':''}>Oui</option><option value="false" ${state.settings.cloudAutoSync===false?'selected':''}>Non</option></select></label></div><p class="muted" id="authStatus">${esc(cloudStatusText())}</p><div class="footer-actions"><button class="primary" id="signInBtn">Se connecter</button><button class="ghost" id="signUpBtn">Créer un compte</button><button class="ghost" id="signOutBtn">Se déconnecter</button><button class="primary" id="syncCloudBtn">Synchroniser vers Supabase</button><button class="ghost" id="restoreCloudBtn">Restaurer depuis Supabase</button></div><div class="grid grid-3"><div class="stat"><small>Séances locales</small><strong>${Object.keys(state.sessions||{}).length}</strong></div><div class="stat"><small>Dernière sync</small><strong style="font-size:1rem">${esc(lastSync)}</strong></div><div class="stat"><small>Dernière restauration</small><strong style="font-size:1rem">${esc(lastRestore)}</strong></div></div></section>`;
}
function bindAuthControls(){
  const email=$('#authEmail'), pass=$('#authPassword');
  const setStatus=t=>{ const el=$('#authStatus'); if(el) el.textContent=t; const badge=$('#cloudBadge'); if(badge) badge.textContent=t; };
  const auto=$('#cloudAutoSync'); if(auto) auto.onchange=e=>{ state.settings.cloudAutoSync=e.target.value==='true'; saveState({sync:false}); };
  const signIn=$('#signInBtn'); if(signIn) signIn.onclick=async()=>{ await signInCloud(email?.value||'', pass?.value||'', setStatus); };
  const signUp=$('#signUpBtn'); if(signUp) signUp.onclick=async()=>{ await signUpCloud(email?.value||'', pass?.value||'', setStatus); };
  const signOut=$('#signOutBtn'); if(signOut) signOut.onclick=async()=>{ await signOutCloud(setStatus); };
  const sync=$('#syncCloudBtn'); if(sync) sync.onclick=async()=>{ await syncLocalToCloud(setStatus); };
  const restore=$('#restoreCloudBtn'); if(restore) restore.onclick=async()=>{ if(confirm('Restaurer les données cloud sur ce téléphone ? Tes données locales actuelles seront remplacées par la dernière sauvegarde cloud.')) await restoreFromCloud(setStatus); };
}
async function getCloudUser(){
  if(!supabaseReady()) return null;
  const { data, error } = await window.supabaseClient.auth.getUser();
  authUser = error ? null : data.user;
  return authUser;
}
async function initCloud(){
  if(!supabaseReady()) { state.cloud.status='Supabase non configuré'; saveState({sync:false}); return; }
  const { data } = await window.supabaseClient.auth.getSession();
  authUser = data?.session?.user || null;
  window.supabaseClient.auth.onAuthStateChange((_event, session)=>{ authUser=session?.user || null; state.cloud.status=authUser?`Connecté : ${authUser.email||authUser.id}`:'Non connecté'; saveState({sync:false}); if(currentView==='settings') renderSettings(); });
  state.cloud.status=authUser?`Connecté : ${authUser.email||authUser.id}`:'Non connecté'; saveState({sync:false});
  if(currentView==='settings') renderSettings();
}
async function signUpCloud(email,password,setStatus=()=>{}){
  if(!supabaseReady()) return setStatus('Supabase non configuré. Vérifie supabase-config.js.');
  if(!email || !password) return setStatus('Email et mot de passe requis.');
  setStatus('Création du compte...');
  const { data, error } = await window.supabaseClient.auth.signUp({ email, password });
  if(error) return setStatus(error.message);
  authUser = data?.user || authUser;
  setStatus('Compte créé. Vérifie tes emails si la confirmation est activée.');
}
async function signInCloud(email,password,setStatus=()=>{}){
  if(!supabaseReady()) return setStatus('Supabase non configuré. Vérifie supabase-config.js.');
  if(!email || !password) return setStatus('Email et mot de passe requis.');
  setStatus('Connexion...');
  const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
  if(error) return setStatus(error.message);
  authUser = data.user;
  state.cloud.status=`Connecté : ${authUser.email||authUser.id}`;
  saveState({sync:false});
  setStatus('Connecté. Tu peux synchroniser ou restaurer.');
  renderSettings();
}
async function signOutCloud(setStatus=()=>{}){
  if(!supabaseReady()) return setStatus('Supabase non configuré.');
  await window.supabaseClient.auth.signOut();
  authUser=null; state.cloud.status='Non connecté'; saveState({sync:false}); setStatus('Déconnecté.'); renderSettings();
}
function scheduleAutoSync(){
  if(!state?.settings?.cloudAutoSync || cloudBusy || !supabaseReady()) return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>syncLocalToCloud(()=>{}, true), 2500);
}
function meaningfulSession(s){
  if(!s) return false;
  if(s.completed || s.rpe || s.backPain || s.notes) return true;
  const m=s.metrics||{};
  if(Object.values(m).some(v=>v!=='' && v!==null && v!==undefined && Number(v)!==0)) return true;
  if((s.extraExercises||[]).length) return true;
  if(toNum(s.stopwatch?.elapsedSec)) return true;
  return Object.values(s.exercises||{}).some(log=>(log.sets||[]).some(set=>set.done || set.actual || set.load || set.note));
}
function cloudSessionPayload(iso,s,user){
  const p=planForDate(iso), m=s.metrics||{};
  return {
    user_id:user.id, local_id:iso, session_date:iso, week_number:p.week, week_type:p.type,
    day_label:p.plan.name, title:s.freeMode?'Séance libre':p.plan.title, session_type:p.plan.title,
    completed:Boolean(s.completed), non_cardio_duration_seconds:toNum(m.strengthDurationSec || s.stopwatch?.elapsedSec),
    rpe:s.rpe?Number(s.rpe):null, back_pain:s.backPain?Number(s.backPain):null, notes:s.notes||null,
    run_distance_km:m.runDistanceKm?toNum(m.runDistanceKm):null, run_duration_seconds:m.runDurationSec?toNum(m.runDurationSec):null,
    run_avg_speed_kmh:m.runAvgSpeed?toNum(m.runAvgSpeed):null, run_pace_seconds_per_km:m.runDurationSec&&m.runDistanceKm?Math.round(toNum(m.runDurationSec)/toNum(m.runDistanceKm)):null,
    bike_distance_km:m.bikeDistanceKm?toNum(m.bikeDistanceKm):null, bike_duration_seconds:m.bikeDurationSec?toNum(m.bikeDurationSec):null,
    bike_avg_speed_kmh:m.bikeAvgSpeed?toNum(m.bikeAvgSpeed):null,
    total_volume_kg:toNum(m.volumeKg || sessionVolumeKg(iso)), raw_data:s, updated_at:new Date().toISOString()
  };
}
function parseActualReps(actual){
  const m=String(actual||'').match(/\d+/);
  return m ? Number(m[0]) : null;
}
function exerciseRowsForCloud(iso,sessionId,user){
  const rows=[];
  activeExercisesForSession(iso).filter(e=>e.kind!=='run'&&e.kind!=='bike').forEach(e=>{
    const id=e.id || makeId(e.name + '-' + e.kind); const log=getSession(iso).exercises[id]; if(!log) return;
    (log.sets||[]).forEach((set,i)=>{
      const reps=parseActualReps(set.actual || e.reps);
      const bodyweight=e.bodyweight?currentBodyWeight(iso):null;
      const load=toNum(set.load || e.defaultLoad);
      const noLoad = noLoadExercise(e);
      const volume=setVolume(e,set,iso);
      rows.push({ user_id:user.id, session_id:sessionId, exercise_name:e.name, muscle_group:Object.entries(exerciseZoneWeights(e)).map(([z,w])=>`${z}:${w}`).join(', '), set_index:i+1, planned:`${e.sets} x ${e.reps}`, completed:Boolean(set.done), reps, duration_seconds:null, distance_km:null, load_kg:noLoad?null:(load||null), bodyweight_kg:noLoad?null:(bodyweight||null), volume_kg:volume||null });
    });
  });
  return rows;
}
async function saveOneSessionToCloud(iso,user){
  const s=getSession(iso); if(!s.completed) return;
  const { data, error } = await window.supabaseClient.from('sessions').upsert(cloudSessionPayload(iso,s,user), { onConflict:'user_id,local_id' }).select('id').single();
  if(error) throw error;
  await window.supabaseClient.from('exercise_sets').delete().eq('user_id',user.id).eq('session_id',data.id);
  const rows=exerciseRowsForCloud(iso,data.id,user);
  if(rows.length){ const { error:setError } = await window.supabaseClient.from('exercise_sets').insert(rows); if(setError) throw setError; }
}
async function saveOneFreeSessionToCloud(id,user){
  const prevFree=selectedFreeId, prevDate=selectedDate, prevView=currentView;
  const s=state.freeSessions?.[id]; if(!s || !s.completed) return;
  selectedFreeId=id; selectedDate=s.date || isoToday(); currentView='session';
  const payload={...cloudSessionPayload(s.date||isoToday(),s,user), local_id:id, week_number:null, week_type:'Libre', day_label:'Libre', title:s.title||'Séance libre', session_type:'Séance libre', raw_data:s};
  const { data, error } = await window.supabaseClient.from('sessions').upsert(payload, { onConflict:'user_id,local_id' }).select('id').single();
  if(error) throw error;
  await window.supabaseClient.from('exercise_sets').delete().eq('user_id',user.id).eq('session_id',data.id);
  const rows=exerciseRowsForCloud(s.date||isoToday(),data.id,user);
  if(rows.length){ const { error:setError } = await window.supabaseClient.from('exercise_sets').insert(rows); if(setError) throw setError; }
  selectedFreeId=prevFree; selectedDate=prevDate; currentView=prevView;
}
async function syncLocalToCloud(setStatus=()=>{}, silent=false){
  if(!supabaseReady()) { if(!silent) setStatus('Supabase non configuré.'); return; }
  const user = authUser || await getCloudUser();
  if(!user) { if(!silent) setStatus('Connecte-toi avant de synchroniser.'); return; }
  cloudBusy=true; if(!silent) setStatus('Synchronisation en cours...');
  try{
    for(const iso of Object.keys(state.sessions||{})) await saveOneSessionToCloud(iso,user);
    for(const id of Object.keys(state.freeSessions||{})) await saveOneFreeSessionToCloud(id,user);
    await syncWeightsToCloud(user);
    await syncRoutinesToCloud(user);
    state.cloud.lastSync=new Date().toISOString(); state.cloud.status='Synchronisé'; saveState({sync:false});
    if(!silent) setStatus('Synchronisation terminée.');
    if(currentView==='settings') renderSettings();
  }catch(e){ console.error(e); state.cloud.status='Erreur sync'; saveState({sync:false}); if(!silent) setStatus(`Erreur sync : ${e.message||e}`); }
  finally{ cloudBusy=false; }
}
async function syncWeightsToCloud(user){
  const rows=(state.bodyWeights||[]).filter(r=>r.date&&toNum(r.kg)).map(r=>({user_id:user.id, measured_at:r.date, weight_kg:toNum(r.kg)}));
  if(rows.length){ const {error}=await window.supabaseClient.from('body_weights').upsert(rows,{onConflict:'user_id,measured_at'}); if(error) throw error; }
}
async function syncRoutinesToCloud(user){
  const entries=Object.entries(state.routine||{}).filter(([,v])=>Object.values(v||{}).some(Boolean));
  await window.supabaseClient.from('daily_routines').delete().eq('user_id',user.id);
  if(!entries.length) return;
  const rows=entries.map(([date,raw])=>({user_id:user.id,routine_date:date,completed:true,raw_data:raw}));
  const {error}=await window.supabaseClient.from('daily_routines').insert(rows); if(error) throw error;
}
async function restoreFromCloud(setStatus=()=>{}){
  if(!supabaseReady()) return setStatus('Supabase non configuré.');
  const user = authUser || await getCloudUser();
  if(!user) return setStatus('Connecte-toi avant de restaurer.');
  cloudBusy=true; setStatus('Restauration en cours...');
  try{
    const { data:sessions, error:sErr } = await window.supabaseClient.from('sessions').select('*').eq('user_id',user.id).order('session_date',{ascending:true});
    if(sErr) throw sErr;
    const { data:weights, error:wErr } = await window.supabaseClient.from('body_weights').select('*').eq('user_id',user.id).order('measured_at',{ascending:true});
    if(wErr) throw wErr;
    const { data:routines, error:rErr } = await window.supabaseClient.from('daily_routines').select('*').eq('user_id',user.id).order('routine_date',{ascending:true});
    if(rErr) throw rErr;
    const next={...defaultState(),...state,sessions:{},freeSessions:{},routine:{}};
    (sessions||[]).forEach(row=>{ if(String(row.local_id||'').startsWith('free-')) next.freeSessions[row.local_id]=row.raw_data || {}; else next.sessions[row.session_date]=row.raw_data || {}; });
    next.bodyWeights=(weights||[]).map(r=>({date:r.measured_at,kg:Number(r.weight_kg)}));
    if(!next.bodyWeights.length) next.bodyWeights=[{date:isoToday(),kg:78}];
    (routines||[]).forEach(r=>{ next.routine[r.routine_date]=r.raw_data || {}; });
    next.cloud={...(state.cloud||{}), lastRestore:new Date().toISOString(), status:'Restauré depuis Supabase'};
    state=next; saveState({sync:false}); setStatus('Restauration terminée.'); render();
  }catch(e){ console.error(e); setStatus(`Erreur restauration : ${e.message||e}`); }
  finally{ cloudBusy=false; }
}

function exportJSON(){ download(`sport-tracker-${isoToday()}.json`,JSON.stringify(state,null,2),'application/json'); }
function exportCSV(){ const head=['date','week','type','session','completed','strengthDurationSec','volumeKg','rpe','backPain','runKm','runDurationSec','runAvgSpeed','runPace','bikeKm','bikeDurationSec','bikeAvgSpeed','bodyWeightKg','notes']; const lines=[head]; Object.entries(state.sessions).sort().forEach(([iso,s])=>{ const p=planForDate(iso), m=s.metrics||{}; lines.push([iso,p.week,p.type,p.plan.title,s.completed,m.strengthDurationSec||'',m.volumeKg||sessionVolumeKg(iso),s.rpe||'',s.backPain||'',m.runDistanceKm||'',m.runDurationSec||'',m.runAvgSpeed||'',m.runPace||'',m.bikeDistanceKm||'',m.bikeDurationSec||'',m.bikeAvgSpeed||'',currentBodyWeight(iso),String(s.notes||'').replace(/\n/g,' ')]); }); download(`sport-tracker-${isoToday()}.csv`,lines.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'),'text/csv'); }
function download(name,content,type){ const blob=new Blob([content],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function importJSON(e){ const file=e.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=()=>{ try{ state={...defaultState(),...JSON.parse(reader.result)}; saveState(); render(); alert('Sauvegarde importée.'); } catch{ alert('Fichier invalide.'); } }; reader.readAsText(file); }

function startEmom(rounds=10, seconds=60, label='EMOM'){
  clearInterval(emom.interval);
  clearInterval(timer.interval);
  emom={active:true, interval:null, totalRounds:Math.max(1,Number(rounds)||10), currentRound:1, remaining:Math.max(5,Number(seconds)||60), label};
  const panel=$('#timer');
  if(panel) panel.classList.remove('hidden');
  updateEmomDisplay();
  beep();
  if(state.settings.vibration && navigator.vibrate) navigator.vibrate(120);
  emom.interval=setInterval(()=>{
    if(timer.paused) return;
    emom.remaining--;
    updateEmomDisplay();
    if(emom.remaining<=0){
      beep();
      if(state.settings.vibration && navigator.vibrate) navigator.vibrate([180,70,180]);
      if(emom.currentRound>=emom.totalRounds){ finishEmom(); }
      else { emom.currentRound++; emom.remaining=Math.max(5,Number(seconds)||60); updateEmomDisplay(); }
    }
  },1000);
}
function updateEmomDisplay(){
  const label=$('#timerLabel'), time=$('#timerTime');
  if(label) label.textContent=`${emom.label} · minute ${emom.currentRound}/${emom.totalRounds}`;
  if(time) time.textContent=mmss(emom.remaining);
}
function finishEmom(){
  clearInterval(emom.interval);
  emom.active=false;
  const panel=$('#timer'); if(panel) panel.classList.add('hidden');
}
function startTimer(seconds,label='Repos'){ clearInterval(emom.interval); emom.active=false; clearInterval(timer.interval); timer={remaining:Number(seconds),interval:null,paused:false,label}; $('#timerLabel').textContent=label; $('#timerTime').textContent=mmss(seconds); $('#timer').classList.remove('hidden'); timer.interval=setInterval(()=>{ if(timer.paused) return; timer.remaining--; $('#timerTime').textContent=mmss(timer.remaining); if(timer.remaining<=0) finishTimer(); },1000); }
function finishTimer(){ clearInterval(timer.interval); $('#timer').classList.add('hidden'); beep(); if(state.settings.vibration && navigator.vibrate) navigator.vibrate([250,80,250]); }
function beep(){ if(state.settings.sound===false) return; try{ const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return; const ctx=new AC(), now=ctx.currentTime, g=ctx.createGain(); g.gain.setValueAtTime(.0001,now); g.gain.exponentialRampToValueAtTime(.2,now+.02); g.gain.exponentialRampToValueAtTime(.0001,now+.7); g.connect(ctx.destination); [0,.22,.44].forEach(off=>{ const o=ctx.createOscillator(); o.frequency.value=880; o.connect(g); o.start(now+off); o.stop(now+off+.15); }); setTimeout(()=>ctx.close(),900); }catch(e){} }
$('#pauseTimer').onclick=()=>{ timer.paused=!timer.paused; $('#pauseTimer').textContent=timer.paused?'Reprendre':'Pause'; };
$('#skipTimer').onclick=()=>{ if(emom.active) finishEmom(); else finishTimer(); };
$$('.tabs button').forEach(btn=>btn.onclick=()=>setView(btn.dataset.view));
window.addEventListener('resize',()=>{ if(currentView==='charts') drawCharts(); });
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredInstallPrompt=e; $('#installBtn').classList.remove('hidden'); });
$('#installBtn').onclick=async()=>{ if(deferredInstallPrompt){ deferredInstallPrompt.prompt(); deferredInstallPrompt=null; $('#installBtn').classList.add('hidden'); } };
if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
render();
initCloud();
