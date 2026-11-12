(() => {
  'use strict';

  const pageFiles = {
    1: '01 登录与注册.html', 2: '02 基础数据.html', 3: '03 训练目标.html',
    4: '04 运动基础.html', 5: '05 目标成绩.html', 6: '06 身体状态.html',
    7: '07 跑者档案确认.html', 8: '08 AI计划生成.html', 9: '09 训练计划.html',
    10: '10 计划总览.html', 11: '11 今日训练.html', 12: '12 练前热身.html',
    13: '13 跑步中.html', 14: '14 练后拉伸.html', 15: '15 训练完成.html',
    16: '16 训练反馈.html', 17: '17 AI计划调整.html', 18: '18 计划调整结果.html',
    19: '19 我的.html'
  };
  const stateKey = 'zc-redesign-state-v1';
  const authKey = 'zc-redesign-auth-v1';
  const tokenKey = 'zc-access-token-v1';
  const page = document.body.dataset.page || '';
  document.documentElement.dataset.page = decodeURIComponent(location.pathname.split('/').pop() || '');
  document.documentElement.classList.add('zc-ready');

  function read(key, fallback = {}) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null') || fallback; }
    catch (_) { return fallback; }
  }
  function write(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
  }
  let state = read(stateKey);
  function save() { write(stateKey, state); }
  function token() { return localStorage.getItem(tokenKey) || ''; }
  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(`/api${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `请求失败（${response.status}）`);
    return data;
  }
  async function streamApi(path, options = {}, onProgress = () => {}) {
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(`/api${path}`, { ...options, headers });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || `请求失败（${response.status}）`); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', result = null;
    while (true) {
      const { value: chunk, done } = await reader.read(); buffer += decoder.decode(chunk || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop();
      for (const frame of frames) {
        const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim(); const dataLine = frame.match(/^data:\s*(.+)$/m)?.[1];
        if (!dataLine) continue;
        const data = JSON.parse(dataLine);
        if (event === 'progress' || event === 'workflow_started' || event === 'node_started' || event === 'node_finished') onProgress(data);
        else if (event === 'result') result = data.data;
        else if (event === 'error') throw new Error(data.message || 'Dify 工作流执行失败');
      }
      if (done) break;
    }
    if (!result) throw new Error('工作流未返回结果');
    return result;
  }
  function courseName(workout) {
    const name = workout?.courseName || workout?.title || '课程';
    const key = workout?.courseKey || workout?.courseId;
    return String(name).replace(key ? new RegExp(`^${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·•-]?\\s*`) : /^E-\d+\s*[·•-]?\s*/i, '').replace(/^E-\d+\s*[·•-]?\s*/i, '').trim();
  }
  function distanceRangeText(workout) {
    const range = workout?.distanceRangeKm;
    if (Array.isArray(range) && range.length === 2 && range.every((value) => Number.isFinite(Number(value)))) return `${Number(range[0]).toFixed(1)}–${Number(range[1]).toFixed(1)} km`;
    return workout?.distanceKm != null ? `${workout.distanceKm} km` : '';
  }
  function paceRangeText(workout) { return typeof workout?.paceRangeMinPerKm === 'string' ? workout.paceRangeMinPerKm.trim() : ''; }
  function workoutTargetText(workout) {
    return [distanceRangeText(workout) ? `距离 ${distanceRangeText(workout)}` : '', paceRangeText(workout) ? `配速 ${paceRangeText(workout)}` : '', workout?.durationMin != null ? `${workout.durationMin} 分钟` : ''].filter(Boolean).join(' · ');
  }
  if (page !== 'login' && !token()) { window.location.replace(encodeURI(pageFiles[1])); return; }
  function go(number) {
    const file = pageFiles[number];
    if (file) window.location.href = encodeURI(file);
  }
  function value(id) { return document.getElementById(id)?.value?.trim() || ''; }
  function setValue(id, v) {
    const el = document.getElementById(id);
    if (el && v !== undefined && v !== null) { el.value = v; el.classList.toggle('has-value', String(v).trim() !== ''); }
  }
  document.querySelectorAll('input[type="number"]').forEach((input) => {
    input.classList.toggle('has-value', input.value.trim() !== '');
    input.addEventListener('input', () => input.classList.toggle('has-value', input.value.trim() !== ''));
  });
  function profile() { state.profile ||= {}; return state.profile; }
  function notify(message) { window.alert(message); }
  if (page !== 'login' && token() && !state.profile?.height) {
    api('/profile').then(({ profile: saved }) => {
      if (!saved) return;
      Object.assign(profile(), { height: saved.height, weight: saved.weight, goal: '完成 10 公里', 'longest-run': saved.longestRunKm, 'latest-10k': saved.latest10kMinutes, 'train-days': saved.trainDays, targetMinutes: saved.targetMinutes, health: saved.health || [] });
      save(); window.location.reload();
    }).catch(() => {});
  }
  function setAction(button, label, action) {
    if (!button) return;
    button.dataset.action = action;
    if (label) button.setAttribute('aria-label', label);
  }

  // Routing for shared navigation and back controls.
  const backTargets = {
    'profile-goal': 2, 'profile-running': 3, 'profile-target': 4,
    'profile-health': 5, 'profile-review': 6, 'plan-home': 11,
    'plan-overview': 9, 'training': 9, 'warmup': 11, 'stretch': 15,
    'complete': 14, 'feedback': 15, 'plan-generation': 7, 'plan-adjust': 16, 'plan-changes': 9,
    'mine': 11
  };
  document.querySelectorAll('.back, .icon-button').forEach((el) => {
    if (page === 'profile-basic' && el.classList.contains('back')) return;
    if (el.textContent.trim() === '‹' || el.classList.contains('back')) {
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', '返回'); el.dataset.action = 'back';
    }
  });
  document.querySelectorAll('header button[aria-label*="返回"]').forEach((el) => {
    el.setAttribute('role', 'button'); el.dataset.action = 'back';
  });
  document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
    const label = item.textContent.trim();
    const target = label.includes('训练') ? 11 : label.includes('计划') ? 9 : label.includes('我的') ? 19 : 0;
    if (target) { item.dataset.route = String(target); item.setAttribute('role', 'button'); item.setAttribute('tabindex', '0'); }
  });

  // Login/register via the backend API.
  if (page === 'login') {
    const tabs = [...document.querySelectorAll('.auth-tabs span')];
    const card = document.querySelector('.auth-card');
    const button = card?.querySelector('.primary-button');
    const confirmField = document.getElementById('confirm-field');
    const confirmInput = document.getElementById('confirm-password-input');
    let mode = 'login';
    const submit = async () => {
      const username = value('account-input'); const pass = value('password-input');
      const input = document.getElementById('account-input');
      if (!/^[A-Za-z0-9]+$/.test(username)) { input.setCustomValidity('账号只能使用英文字母和数字'); input.reportValidity(); input.setCustomValidity(''); return; }
      if (pass.length < 6) { const pw = document.getElementById('password-input'); pw.setCustomValidity('密码至少需要 6 位'); pw.reportValidity(); pw.setCustomValidity(''); return; }
      if (mode === 'register' && pass !== value('confirm-password-input')) { confirmInput.setCustomValidity('两次输入的密码不一致'); confirmInput.reportValidity(); confirmInput.setCustomValidity(''); return; }
      if (button) button.disabled = true;
      try {
        const result = await api(mode === 'register' ? '/auth/register' : '/auth/login', {
          method: 'POST', body: JSON.stringify({ account: username, password: pass })
        });
        localStorage.setItem(tokenKey, result.accessToken);
        write(authKey, { username });
        const saved = await api('/profile');
        if (saved.profile) {
          const p = saved.profile;
          Object.assign(profile(), { height: p.height, weight: p.weight, goal: '完成 10 公里', 'longest-run': p.longestRunKm, 'latest-10k': p.latest10kMinutes, 'train-days': p.trainDays, targetMinutes: p.targetMinutes, health: p.health || [] });
          save(); go(9);
        } else go(2);
      } catch (error) { notify(error.message); }
      finally { if (button) button.disabled = false; }
    };
    const renderMode = (nextMode) => {
      mode = nextMode;
      tabs.forEach((tab, i) => { tab.classList.toggle('current', (i === 1) === (mode === 'register')); tab.setAttribute('role', 'button'); tab.tabIndex = 0; });
      confirmField?.classList.toggle('is-hidden', mode !== 'register');
      document.getElementById('password-input').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      if (button) button.innerHTML = mode === 'register' ? '创建账号并继续 <span>→</span>' : '开启智程跑步 <span>→</span>';
    };
    tabs.forEach((tab, i) => tab.addEventListener('click', () => renderMode(i === 1 ? 'register' : 'login')));
    button?.addEventListener('click', submit);
    card?.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
    renderMode('login');
  }

  // Restore form values from this tab's session only; new sessions remain blank.
  if (page === 'profile-basic') {
    setValue('height', profile().height); setValue('weight', profile().weight);
    const continueButton = document.querySelector('.action button');
    const syncBasicButton = () => {
      const h = Number(value('height')), w = Number(value('weight'));
      continueButton.disabled = !Number.isInteger(h) || h < 150 || h > 210 || !Number.isInteger(w) || w < 40 || w > 120;
    };
    document.querySelectorAll('#height, #weight').forEach((input) => input.addEventListener('input', syncBasicButton));
    syncBasicButton();
    document.querySelectorAll('.measure').forEach((measure) => {
      const input = measure.querySelector('input');
      const min = Number(input.min), max = Number(input.max);
      measure.querySelectorAll('[data-measure-step]').forEach((button) => button.addEventListener('click', () => {
        const current = input.value === '' ? min : Number(input.value);
        const next = Math.max(min, Math.min(max, current + (button.dataset.measureStep === 'up' ? 1 : -1)));
        input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
      }));
    });
    document.querySelector('.action button')?.addEventListener('click', () => {
      const h = value('height'), w = value('weight');
      if (!Number.isInteger(Number(h)) || Number(h) < 150 || Number(h) > 210) { const el = document.getElementById('height'); el.setCustomValidity('身高需为 150–210 厘米的整数'); el.reportValidity(); el.setCustomValidity(''); return; }
      if (!Number.isInteger(Number(w)) || Number(w) < 40 || Number(w) > 120) { const el = document.getElementById('weight'); el.setCustomValidity('体重需为 40–120 千克的整数'); el.reportValidity(); el.setCustomValidity(''); return; }
      Object.assign(profile(), { height: h, weight: w }); save(); go(3);
    });
  }
  if (page === 'profile-goal') {
    const cards = [...document.querySelectorAll('#optionsContainer [role="radio"]')];
    const selectedGoal = profile().goal === '完成 10 公里' ? profile().goal : '';
    const continueButton = document.querySelector('[data-purpose="bottom-bar"] button');
    function paintGoal(goal) {
      cards.forEach((card) => {
        const selected = goal && card.querySelector('h3')?.textContent.trim() === goal;
        card.setAttribute('aria-checked', String(!!selected));
        card.classList.toggle('border-2', !!selected); card.classList.toggle('border-[#087df5]', !!selected);
        card.classList.toggle('border', !selected); card.classList.toggle('border-zinc-200', !selected);
        const circle = card.querySelector('.check-circle');
        circle?.classList.toggle('bg-[#087df5]', !!selected); circle?.classList.toggle('border-[#087df5]', !!selected);
        circle?.classList.toggle('border-zinc-200', !selected);
      });
      if (continueButton) continueButton.disabled = !goal;
    }
    paintGoal(selectedGoal);
    cards.forEach((card) => {
      const choose = () => { const goal = card.querySelector('h3')?.textContent.trim() || ''; if (goal !== '完成 10 公里') return; profile().goal = goal; save(); paintGoal(goal); };
      card.addEventListener('click', choose); card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    });
    document.querySelector('[data-purpose="bottom-bar"] button')?.addEventListener('click', () => {
      if (!profile().goal) { notify('请选择“完成 10 公里”后继续。'); return; } go(4);
    });
  }
  if (page === 'profile-running') {
    ['longest-run', 'latest-10k', 'train-days'].forEach((id) => setValue(id, profile()[id]));
    document.querySelector('.action button')?.addEventListener('click', () => {
      const fields = [
        ['longest-run', (v) => Number.isFinite(Number(v)) && Number(v) >= 5 && Number(v) <= 20, '最长连续跑距离需为 5–20 公里'],
        ['latest-10k', (v) => !v || (Number.isInteger(Number(v)) && Number(v) >= 40 && Number(v) <= 80), '10km 成绩需为 40–80 分钟的整数'],
        ['train-days', (v) => Number.isInteger(Number(v)) && Number(v) >= 3 && Number(v) <= 7, '每周训练天数需为 3–7 天的整数']
      ];
      for (const [id, valid, message] of fields) { const el = document.getElementById(id); const v = value(id); if ((id !== 'latest-10k' && !v) || !valid(v)) { el.setCustomValidity(message); el.reportValidity(); el.setCustomValidity(''); return; } }
      fields.forEach(([id]) => profile()[id] = value(id)); save(); go(5);
    });
  }
  if (page === 'profile-target') {
    setValue('target-minutes', profile().targetMinutes);
    const stepper = document.querySelector('.stepper');
    stepper?.removeAttribute('aria-hidden');
    stepper?.querySelectorAll('span').forEach((arrow, index) => {
      arrow.setAttribute('role', 'button'); arrow.tabIndex = 0;
      const adjust = () => { const input = document.getElementById('target-minutes'); const current = Number(input.value || 55); input.value = String(Math.min(70, Math.max(40, current + (index === 0 ? 1 : -1)))); input.dispatchEvent(new Event('input', { bubbles: true })); };
      arrow.addEventListener('click', adjust); arrow.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adjust(); } });
    });
    document.querySelector('.action button')?.addEventListener('click', () => {
      const el = document.getElementById('target-minutes'), v = value('target-minutes');
      if (!Number.isInteger(Number(v)) || Number(v) < 40 || Number(v) > 70) { el.setCustomValidity('目标成绩需为 40–70 分钟的整数'); el.reportValidity(); el.setCustomValidity(''); return; }
      profile().targetMinutes = v; save(); go(6);
    });
  }
  if (page === 'profile-health') {
    const options = [...document.querySelectorAll('.health-option')];
    function paintHealth(selected) { options.forEach((item) => { const yes = selected.includes(item.querySelector('.health-title')?.textContent.trim()); item.classList.toggle('selected', yes); }); }
    let health = Array.isArray(profile().health) ? profile().health : [];
    paintHealth(health);
    options.forEach((option, index) => option.addEventListener('click', () => {
      const name = option.querySelector('.health-title')?.textContent.trim();
      if (index === 0) health = health.includes(name) ? [] : [name];
      else { health = health.filter((v) => v !== options[0].querySelector('.health-title').textContent.trim()); health = health.includes(name) ? health.filter((v) => v !== name) : [...health, name]; }
      profile().health = health; save(); paintHealth(health);
    }));
    document.querySelector('.action button')?.addEventListener('click', () => { if (!health.length) { notify('请选择当前身体状态后继续。'); return; } go(7); });
  }

  // Runner profile confirmation and edit links.
  if (page === 'profile-review') {
    const p = profile();
    const summaries = [
      p.height && p.weight ? `${p.height} cm · ${p.weight} kg` : '',
      p.goal || '',
      p['longest-run'] ? `最长连续跑 ${p['longest-run']} km<br>最近一次10km ${p['latest-10k'] ? `${p['latest-10k']} 分钟` : '未填写'}<br>每周可训练 ${p['train-days'] || ''} 天` : '',
      p.targetMinutes ? `${p.targetMinutes} 分钟` : '',
      Array.isArray(p.health) && p.health.length ? p.health.join('、') : ''
    ];
    const readOnly = new URLSearchParams(location.search).get('readonly') === '1';
    if (readOnly) { document.querySelector('.back')?.remove(); document.querySelector('.action')?.remove(); }
    const editPages = [2, 3, 4, 5, 6];
    document.querySelectorAll('.profile-row').forEach((row, index) => {
      if (index === 2) row.classList.add('profile-running-row');
      const valueNode = row.querySelector('.profile-value'); const edit = row.querySelector('.edit');
      if (valueNode) { const text = document.createElement('span'); text.className = 'profile-summary'; text.innerHTML = summaries[index]; valueNode.insertBefore(text, valueNode.firstChild); }
      if (edit && readOnly) edit.remove();
      else if (edit) { edit.setAttribute('role', 'button'); edit.tabIndex = 0; edit.dataset.route = String(editPages[index]); }
    });
    document.querySelector('.action button')?.addEventListener('click', () => {
      if (!p.goal || !p.height || !p.weight || !p['longest-run'] || !p['train-days'] || !p.targetMinutes || !p.health?.length) { notify('请先完成所有建档信息。'); return; }
      api('/profile', { method: 'PUT', body: JSON.stringify({ height: Number(p.height), weight: Number(p.weight), goal: p.goal, longestRunKm: Number(p['longest-run']), latest10kMinutes: p['latest-10k'] ? Number(p['latest-10k']) : null, trainDays: Number(p['train-days']), targetMinutes: Number(p.targetMinutes), health: p.health, healthStatus: p.health.join('、') }) })
        .then(() => go(8)).catch((error) => notify(error.message));
    });
  }

  // Generate and adjust plans through the configured Dify workflows on the backend.
  if (page === 'plan-generation' || page === 'plan-adjust') {
    const cta = document.getElementById('ctaBtn');
    if (cta) cta.disabled = true;
    const steps = [...document.querySelectorAll('main h4')];
    const nodeTitles = page === 'plan-adjust'
      ? [['用户输入'], ['分析训练反馈', '检索调整规则'], ['调整后续训练'], ['检索热身与拉伸动作', '输出调整结果']]
      : [['用户输入'], ['检索10km课程'], ['组合首次训练计划'], ['输出']];
    const finishedNodes = new Set(); let activeStep = 0;
    const flowGlyphs = ['person_search', 'travel_explore', 'event_note', 'fact_check'];
    const setProgress = (current = -1, allDone = false) => steps.forEach((heading, index) => {
      const box = heading.closest('.flex.items-start'); const status = box?.querySelector('span[class*="text-[10px]"]');
      if (!box) return;
      const icon = box.querySelector('[data-flow-icon]') || box.firstElementChild;
      if (icon && !icon.dataset.flowIcon) { icon.dataset.flowIcon = '1'; icon.innerHTML = ''; const glyph = document.createElement('span'); glyph.className = 'material-symbols-outlined'; glyph.dataset.glyph = '1'; icon.append(glyph); }
      const done = allDone || (nodeTitles[index] || []).every((title) => finishedNodes.has(title));
      const active = !done && index === current;
      if (icon) { icon.className = `flow-icon ${done ? 'is-done' : active ? 'is-active' : 'is-pending'}`; icon.querySelector('[data-glyph]').textContent = flowGlyphs[index]; }
      if (status) { status.textContent = done ? '已完成' : active ? '进行中' : '等待中'; status.className = `text-[10px] px-1.5 py-0.5 rounded font-medium border flow-status ${done ? 'is-done' : active ? 'is-active' : 'is-pending'}`; }
    });
    setProgress(-1);
    if (page === 'plan-generation') state.planRequestKey ||= crypto.randomUUID();
    let taskSucceeded = false;
    const task = page === 'plan-adjust'
      ? streamApi(`/training-records/${state.trainingRecordId}/adjust-plan/stream`, { method: 'POST' }, (event) => {
          if (event.event === 'node_finished') finishedNodes.add(event.title);
          const idx = event.event === 'workflow_started' ? 0 : nodeTitles.findIndex((group) => group.includes(event.title));
          if (idx >= 0) activeStep = event.event === 'node_finished' && nodeTitles[idx].every((title) => finishedNodes.has(title)) ? Math.min(idx + 1, steps.length - 1) : idx;
          setProgress(activeStep);
        })
      : streamApi('/plans/generate/stream', { method: 'POST', headers: { 'Idempotency-Key': state.planRequestKey } }, (event) => {
          if (event.event === 'node_finished') finishedNodes.add(event.title);
          const idx = event.event === 'workflow_started' ? 0 : nodeTitles.findIndex((group) => group.includes(event.title));
          if (idx >= 0) activeStep = event.event === 'node_finished' && nodeTitles[idx].every((title) => finishedNodes.has(title)) ? Math.min(idx + 1, steps.length - 1) : idx;
          setProgress(activeStep);
        });
    if (page === 'plan-adjust') state.previousPlan = state.activePlan;
    task.then((result) => {
      taskSucceeded = true; state.activePlan = result.plan;
      if (page === 'plan-adjust') { state.adjustment = result.adjustment || null; state.feedbackAnalysis = result.feedbackAnalysis || ''; state.warmupStretchSources = result.warmupStretchSources || []; }
      if (page === 'plan-generation') delete state.planRequestKey; save(); setProgress(-1, true);
      if (cta) { cta.disabled = false; const label = cta.querySelector('span:last-child'); if (label) label.textContent = page === 'plan-adjust' ? '查看调整结果' : '查看训练计划'; cta.querySelector('.animate-spin')?.remove(); }
    }).catch((error) => {
      if (cta) { cta.disabled = false; const label = cta.querySelector('span:last-child'); if (label) label.textContent = '重试'; }
      notify(error.message);
    });
    cta?.addEventListener('click', () => { if (!taskSucceeded) { window.location.reload(); return; } go(page === 'plan-adjust' ? 18 : 9); });
  }
  if (page === 'plan-home' || page === 'plan-overview') {
    api('/plans/active').then(({ plan }) => {
      if (!plan) { if (page === 'plan-home') notify('还没有训练计划，请先生成计划。'); return; }
      state.activePlan = plan; save();
      if (page === 'plan-home') {
        api('/workouts/today').then(({ workout }) => {
          if (!workout) return;
          if (state.workoutId && state.workoutId !== workout.id) {
            delete state.trainingRecordId; delete state.feedbackId; delete state.feedbackAnalysis; delete state.feedback; delete state.run;
          }
          state.workoutId = workout.id; save();
          const title = document.querySelector('.today-card h2'); if (title) title.textContent = courseName(workout);
          const metrics = document.querySelectorAll('.today-metrics .metric strong');
          if (metrics[0]) metrics[0].textContent = distanceRangeText(workout) || '按课程安排';
          if (metrics[1]) metrics[1].textContent = (paceRangeText(workout).replace(/\s*min\s*\/\s*km\s*$/i, ' /km')) || '按 RPE';
          if (metrics[2]) metrics[2].textContent = workout.durationMin != null ? `${workout.durationMin} 分钟` : '—';
        }).catch((error) => notify(error.message));
      }
      if (page === 'plan-overview') {
        const heading = document.querySelector('main h1'); if (heading) heading.textContent = plan.title;
        const total = plan.workouts.length;
        const completed = plan.workouts.filter((item) => item.status === 'completed').length;
        const percent = total ? Math.round(completed * 100 / total) : 0;
        const progress = document.querySelector('main svg circle[stroke-dasharray] + circle');
        if (progress) progress.setAttribute('stroke-dashoffset', String(251.32 * (1 - percent / 100)));
        const progressText = document.querySelector('main .absolute.inset-0 span');
        if (progressText) progressText.innerHTML = `${percent}<span class="text-[11px] font-semibold text-[#007AFF]">%</span>`;
        const progressCaption = document.querySelector('main .absolute.inset-0 span:nth-child(2)');
        if (progressCaption) progressCaption.textContent = `${completed}/${total} 节`;
        const period = [...document.querySelectorAll('main span')].find((el) => el.textContent.trim() === '计划周期');
        if (period?.parentElement?.lastElementChild) period.parentElement.lastElementChild.textContent = `共 ${plan.weeks} 周`;
        const frequency = [...document.querySelectorAll('main span')].find((el) => el.textContent.trim() === '频次 & 总量');
        if (frequency?.parentElement?.lastElementChild) {
          const value = frequency.parentElement.lastElementChild;
          value.textContent = `每周 ${plan.trainDays} 次 · 共 ${total} 节`;
        }
        const timeline = document.querySelector('main .relative.flex.flex-col.pl-2');
        if (timeline) {
          timeline.replaceChildren();
          for (let week = 1; week <= plan.weeks; week++) {
            const rows = plan.workouts.filter((w) => w.week === week);
            const details = document.createElement('details'); details.open = week === 1; details.className = `group relative ${week === plan.weeks ? 'mb-2' : 'mb-6'} z-10`;
            const summary = document.createElement('summary'); summary.className = 'list-none cursor-pointer flex items-center gap-3 select-none';
            const completedWeek = rows.filter((item) => item.status === 'completed').length;
            const badge = document.createElement('div'); badge.className = completedWeek === rows.length && rows.length ? 'w-9 h-9 rounded-full bg-[#34C759] text-white flex items-center justify-center font-bold text-[13px] shadow-[0_2px_8px_rgba(52,199,89,0.35)] shrink-0 ring-4 ring-[#F8F9FA]' : 'w-9 h-9 rounded-full bg-white border border-[#C1C6D7] text-[#717786] flex items-center justify-center font-bold text-[13px] shrink-0 ring-4 ring-[#F8F9FA]'; badge.textContent = `W${week}`;
            const summaryInner = document.createElement('div'); summaryInner.className = 'flex-1 flex items-center justify-between min-w-0 pr-1 py-1';
            const weekName = document.createElement('span'); weekName.className = 'text-[14px] font-bold text-[#1D1D1F]'; weekName.textContent = `第 ${week} 周`;
            const count = document.createElement('span'); count.className = completedWeek === rows.length && rows.length ? 'text-[11px] font-semibold text-[#34C759]' : 'text-[11px] text-[#86868B]'; count.textContent = `${completedWeek}/${rows.length} ${completedWeek === rows.length && rows.length ? '已完成' : '待开始'}`;
            summaryInner.append(weekName, count); summary.append(badge, summaryInner);
            const body = document.createElement('div'); body.className = 'ml-[18px] pl-6 pt-1.5 flex flex-col';
            rows.forEach((w) => {
              const row = document.createElement('div'); row.className = `relative ${w.status === 'in_progress' ? 'py-3' : 'py-2.5'} flex items-center justify-between gap-3`;
              const dotColor = w.status === 'completed' ? 'bg-[#34C759]' : w.status === 'in_progress' ? 'bg-[#007AFF]' : 'bg-[#C1C6D7]';
              const dot = document.createElement('div'); dot.className = `absolute -left-[28px] top-1/2 -translate-y-1/2 ${w.status === 'in_progress' ? 'w-2.5 h-2.5' : 'w-2 h-2'} rounded-full ${dotColor} ring-2 ring-[#F8F9FA]`;
              const labelWrap = document.createElement('div'); labelWrap.className = 'flex flex-col items-start gap-1 min-w-0 flex-1';
              const identity = document.createElement('div'); identity.className = 'flex items-center gap-2.5 min-w-0';
              const dayLabel = document.createElement('span'); dayLabel.className = `text-[12px] ${w.status === 'in_progress' ? 'font-bold text-[#007AFF]' : 'font-semibold text-[#86868B]'} shrink-0`; dayLabel.textContent = `Day ${w.day}`;
              const name = document.createElement('span'); name.className = `text-[13px] ${w.status === 'in_progress' ? 'font-bold' : 'font-medium'} text-[#1D1D1F] truncate`; name.textContent = courseName(w);
              identity.append(dayLabel, name); labelWrap.append(identity);
              const meta = document.createElement('span'); meta.className = 'text-[10px] text-[#86868B] whitespace-normal'; meta.textContent = workoutTargetText(w); labelWrap.append(meta);
              const right = document.createElement('div'); right.className = 'flex items-center gap-2 shrink-0';
              const stateLabel = document.createElement('span'); stateLabel.className = 'text-[11px] text-[#86868B]'; stateLabel.textContent = w.status === 'completed' ? '已完成' : w.status === 'in_progress' ? '进行中' : w.status === 'skipped' ? '已取消 · 休息' : '待开始';
              right.append(stateLabel); row.append(dot, labelWrap, right);
              if (w.status === 'scheduled' && !timeline.querySelector('[data-first-workout]')) { row.dataset.firstWorkout = 'true'; row.tabIndex = 0; row.setAttribute('role', 'button'); row.dataset.route = '11'; row.addEventListener('click', () => { state.workoutId = w.id; save(); }); }
              body.append(row);
            });
            details.append(summary, body); timeline.append(details);
          }
        }
      }
    }).catch((error) => notify(error.message));
  }
  if (page === 'plan-home') {
    const buttons = document.querySelectorAll('.plan-home .primary-button, .today-card .primary-button');
    buttons.forEach((b) => b.dataset.route = '11');
    const textLinks = [...document.querySelectorAll('.today-card div')];
    textLinks.forEach((el) => { if (el.textContent.includes('查看完整计划')) { el.dataset.route = '10'; el.setAttribute('role', 'button'); el.tabIndex = 0; } });
    document.querySelector('.page-heading .icon-button')?.setAttribute('data-route', '11');
  }
  if (page === 'plan-overview') {
    const targetLabel = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === '目标成绩');
    const targetValue = targetLabel?.parentElement?.querySelectorAll('span')[1];
    if (targetValue && profile().targetMinutes) targetValue.textContent = `${profile().targetMinutes}'00\"`;
    document.querySelectorAll('button').forEach((button) => { if (button.textContent.includes('去开跑')) button.dataset.route = '11'; });
    document.querySelectorAll('.icon-button, header button[aria-label="返回"], header button').forEach((el) => { if (el.textContent.trim() === '‹' || el.getAttribute('aria-label') === '返回') el.dataset.route = '9'; });
  }
  if (page === 'training') {
    api('/workouts/today').then(({ workout }) => {
      if (!workout) return;
      if (state.workoutId && state.workoutId !== workout.id) {
        delete state.trainingRecordId; delete state.feedbackId; delete state.feedbackAnalysis; delete state.feedback; delete state.run;
      }
      state.workoutId = workout.id; save();
      const title = document.querySelector('.workout-title');
       if (title) title.textContent = courseName(workout);
      const value = document.querySelector('[data-workout-value]');
      if (value) value.textContent = distanceRangeText(workout) || `${workout.durationMin ?? '—'} 分钟`;
    }).catch((error) => notify(error.message));
    document.querySelector('.primary-button')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      if (!state.workoutId) {
        const today = await api('/workouts/today');
        if (!today.workout) throw new Error('当前没有待开始的训练，请先生成计划。');
        state.workoutId = today.workout.id;
      }
      if (!state.trainingRecordId) {
        const result = await api(`/workouts/${state.workoutId}/start`, { method: 'POST' });
        state.trainingRecordId = result.trainingRecordId; save();
      }
      go(12);
    } catch (error) { notify(error.message); event.currentTarget.disabled = false; }
    });
  }
  if (page === 'warmup' || page === 'stretch') {
    const cards = [...document.querySelectorAll('.movement-card')];
    const button = document.querySelector('.primary-button');
    const updateMovementSelection = () => {
      const selectedCount = cards.filter((card) => card.dataset.done === 'true').length;
      cards.forEach((card) => {
        const done = card.dataset.done === 'true';
        const completeButton = card.querySelector('.movement-complete');
        completeButton?.classList.toggle('is-complete', done);
        completeButton?.setAttribute('aria-pressed', String(done));
        completeButton?.setAttribute('aria-label', done ? '取消此动作的完成状态' : '标记此动作为完成');
      });
      if (button) button.disabled = selectedCount !== cards.length;
      return selectedCount;
    };
    cards.forEach((card) => card.querySelector('.movement-complete')?.addEventListener('click', () => {
      card.dataset.done = card.dataset.done === 'true' ? 'false' : 'true';
      updateMovementSelection();
    }));
    updateMovementSelection();
    button?.addEventListener('click', () => {
      const done = updateMovementSelection();
      if (done < cards.length) { notify('请先完成本页所有动作，再继续。'); return; }
      go(page === 'warmup' ? 13 : 15);
    });
  }
  if (page === 'running') {
    const metrics = document.querySelectorAll('.run-metric strong');
    const distance = document.querySelector('.run-distance strong');
    const stopButton = document.querySelector('.run-control-button.stop');
    const pauseButton = document.querySelector('.run-control-button.pause');
    const progressCircle = stopButton?.querySelector('.hold-progress');
    const gpsBadge = document.querySelector('.run-top .pill');
    let seconds = 0, paused = false, hasFix = false, lastPoint = null, distanceMeters = 0, watchId = null;
    let holdStart = 0, holdFrame = 0, runEnded = false;
    const holdDuration = 1700;
    const circumference = 2 * Math.PI * 36;
    let activeStartedAt = 0, pausedAt = 0, pausedTotal = 0;
    const setGps = (text, color = '#52dfbf') => { if (gpsBadge) { gpsBadge.textContent = `● ${text}`; gpsBadge.style.color = color; } };
    const renderRun = () => {
      seconds = hasFix ? Math.max(0, Math.floor(((paused ? pausedAt : Date.now()) - activeStartedAt - pausedTotal) / 1000)) : 0;
      const min = String(Math.floor(seconds / 60)).padStart(2, '0'), sec = String(seconds % 60).padStart(2, '0');
      const km = distanceMeters / 1000;
      if (metrics[1]) metrics[1].textContent = `${min}:${sec}`;
      if (distance) distance.textContent = km.toFixed(2);
      if (metrics[0]) metrics[0].textContent = km > 0 && seconds > 0 ? `${Math.floor(seconds / 60 / km)}'${String(Math.floor(seconds / km) % 60).padStart(2, '0')}"` : '—';
    };
    const timer = window.setInterval(renderRun, 1000);
    const radians = (degrees) => degrees * Math.PI / 180;
    const metersBetween = (a, b) => { const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude); const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
    if (!navigator.geolocation) setGps('设备不支持GPS', '#ff6b6b');
    else {
      setGps('正在获取GPS…', '#f0b44d');
      watchId = navigator.geolocation.watchPosition((position) => {
        const point = position.coords;
        if (point.accuracy > 35) { setGps(`GPS信号较弱 ±${Math.round(point.accuracy)}米`, '#f0b44d'); return; }
        const current = { latitude: point.latitude, longitude: point.longitude, at: position.timestamp || Date.now() };
        if (!hasFix) { hasFix = true; activeStartedAt = Date.now(); setGps('GPS已连接'); }
        if (lastPoint && !paused) {
          const meters = metersBetween(lastPoint, current), elapsed = Math.max(.2, (current.at - lastPoint.at) / 1000);
          if (meters >= 2 && meters / elapsed <= 8) distanceMeters += meters;
        }
        lastPoint = current; renderRun();
      }, (error) => {
        const message = error.code === 1 ? '请允许定位权限' : error.code === 3 ? 'GPS定位超时，正在重试' : 'GPS暂不可用';
        setGps(message, '#ff6b6b');
      }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    }
    const finishRun = () => {
      if (runEnded) return;
      runEnded = true;
      window.cancelAnimationFrame(holdFrame);
      window.clearInterval(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      renderRun();
      state.run = { seconds, distance: Number((distanceMeters / 1000).toFixed(3)), completedAt: Date.now() };
      save();
      const saveRun = state.trainingRecordId ? api(`/training-records/${state.trainingRecordId}/finish`, { method: 'POST', body: JSON.stringify({ distanceKm: state.run.distance, durationMin: Number((seconds / 60).toFixed(2)), completed: seconds > 0 && state.run.distance > 0 }) }) : Promise.resolve();
      saveRun.then(() => go(14)).catch((error) => { notify(error.message); go(14); });
    };
    const updateHoldProgress = (now) => {
      if (!holdStart || runEnded) return;
      const progress = Math.min(1, (now - holdStart) / holdDuration);
      if (progressCircle) progressCircle.style.strokeDashoffset = String(circumference * (1 - progress));
      if (progress >= 1) { finishRun(); return; }
      holdFrame = window.requestAnimationFrame(updateHoldProgress);
    };
    const beginHold = (event) => {
      if (runEnded || holdStart) return;
      if (event?.cancelable) event.preventDefault();
      holdStart = performance.now();
      stopButton?.classList.add('holding');
      holdFrame = window.requestAnimationFrame(updateHoldProgress);
    };
    const cancelHold = () => {
      if (!holdStart || runEnded) return;
      holdStart = 0;
      window.cancelAnimationFrame(holdFrame);
      stopButton?.classList.remove('holding');
      if (progressCircle) progressCircle.style.strokeDashoffset = String(circumference);
    };
    stopButton?.addEventListener('pointerdown', (event) => {
      beginHold(event);
      try { stopButton.setPointerCapture(event.pointerId); } catch (_) { /* capture may be unavailable */ }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach((name) => stopButton?.addEventListener(name, cancelHold));
    stopButton?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') beginHold(event); });
    stopButton?.addEventListener('keyup', cancelHold);
    pauseButton?.addEventListener('click', () => {
      if (!hasFix) { notify('等待GPS定位成功后才能开始训练。'); return; }
      paused = !paused;
      if (paused) pausedAt = Date.now(); else { pausedTotal += Date.now() - pausedAt; pausedAt = 0; lastPoint = null; }
      pauseButton.textContent = paused ? '▶' : 'Ⅱ';
      pauseButton.setAttribute('aria-label', paused ? '继续跑步' : '暂停跑步');
      setGps(paused ? '训练已暂停' : 'GPS已连接', paused ? '#f0b44d' : '#52dfbf'); renderRun();
    });
  }
  if (page === 'complete') {
    const run = state.run || { distance: 0, seconds: 0 };
    const vals = document.querySelectorAll('.training-summary-value');
    const mins = Number(run.seconds || 0) / 60;
    if (vals[0]) vals[0].textContent = Number(run.distance || 0).toFixed(2);
    if (vals[1]) vals[1].textContent = mins.toFixed(1);
    if (vals[2]) { const paceSeconds = Number(run.distance) > 0 ? Math.round(Number(run.seconds) / Number(run.distance)) : 0; vals[2].textContent = paceSeconds ? `${Math.floor(paceSeconds / 60)}'${String(paceSeconds % 60).padStart(2, '0')}"` : '—'; }
    document.getElementById('feedback-step-btn')?.addEventListener('click', () => go(16));
    document.getElementById('return-plan-btn')?.addEventListener('click', () => go(9));
  }

  // Feedback controls, ratings, tags, optional note and local photo selection.
  if (page === 'feedback') {
    const feedback = state.feedback || { scores: {} };
      const workoutLabel = document.querySelector('[data-feedback-workout]');
    if (workoutLabel) api('/plans/active').then(({ plan }) => {
      const workout = plan?.workouts?.find((item) => item.id === state.workoutId);
      if (!workout) return;
      const amount = workout.distanceKm != null ? `${workout.distanceKm} km` : workout.durationMin != null ? `${workout.durationMin} 分钟` : '';
      workoutLabel.textContent = `${courseName(workout)}${amount ? ` · ${amount}` : ''}`;
    }).catch((error) => notify(error.message));
    ['subjective', 'physical', 'pain'].forEach((key) => {
      const container = document.getElementById(`stars-${key}`); if (!container) return;
      container.innerHTML = Array.from({ length: 5 }, (_, i) => `<button type="button" aria-label="${i + 1} 分" aria-pressed="${i < (feedback.scores[key] || 0)}" data-rating="${i + 1}" class="rating-star transition-transform active:scale-125 focus:outline-none p-0.5"><svg class="w-7 h-7 drop-shadow-sm" fill="${i < (feedback.scores[key] || 0) ? '#ff9800' : '#cbd5e1'}" viewBox="0 0 24 24"><path style="fill:${i < (feedback.scores[key] || 0) ? '#ff9800' : '#cbd5e1'} !important" d="M12 0 C12 7, 7 12, 0 12 C7 12, 12 17, 12 24 C12 17, 17 12, 24 12 C17 12, 12 7, 12 0 Z"></path><rect fill="#ffffff" height="3.2" rx="0.8" transform="rotate(45 12 12)" width="3.2" x="10.4" y="10.4"></rect></svg></button>`).join('');
      container.addEventListener('click', (event) => {
        const b = event.target.closest('[data-rating]'); if (!b) return;
        const rating = Number(b.dataset.rating);
        feedback.scores[key] = Number(feedback.scores[key]) === rating ? 0 : rating;
        container.querySelectorAll('[data-rating]').forEach((star) => {
          const active = Number(star.dataset.rating) <= feedback.scores[key];
          star.setAttribute('aria-pressed', String(active));
          star.querySelector('svg')?.setAttribute('fill', active ? '#ff9800' : '#cbd5e1');
          const starShape = star.querySelector('svg path');
          if (starShape) starShape.style.setProperty('fill', active ? '#ff9800' : '#cbd5e1', 'important');
        });
        state.feedback = feedback; save();
      });
    });
    const comment = document.getElementById('comment-box');
    if (comment && feedback.comment) comment.value = feedback.comment;
    if (comment && document.getElementById('char-count')) document.getElementById('char-count').textContent = `${comment.value.length} / 200`;
    comment?.addEventListener('input', () => { feedback.comment = comment.value; const counter = document.getElementById('char-count'); if (counter) counter.textContent = `${comment.value.length} / 200`; state.feedback = feedback; save(); });
    const attach = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('配图'));
    if (attach) { const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true; document.body.append(picker); attach.addEventListener('click', () => picker.click()); picker.addEventListener('change', () => { if (picker.files?.[0]) attach.setAttribute('aria-label', `已选择图片：${picker.files[0].name}`); }); }
    document.getElementById('submit-btn')?.addEventListener('click', () => {
      if (!['subjective', 'physical', 'pain'].every((key) => Number(feedback.scores[key]) >= 1 && Number(feedback.scores[key]) <= 5)) { notify('请完成三项训练感受评分后提交。'); return; }
      feedback.comment = comment?.value || ''; state.feedback = feedback; save();
      if (!state.trainingRecordId) { notify('找不到本次训练记录，请从今日训练重新开始。'); return; }
      api(`/training-records/${state.trainingRecordId}/feedback`, { method: 'POST', body: JSON.stringify({ subjective: Number(feedback.scores.subjective), physical: Number(feedback.scores.physical), pain: Number(feedback.scores.pain), note: feedback.comment, completion: state.run?.seconds ? 'completed' : 'partial' }) })
        .then((result) => { state.feedbackId = result.feedbackId; state.feedbackAnalysis = result.analysis; save(); go(17); })
        .catch((error) => notify(error.message));
    });
  }
  if (page === 'plan-changes') {
    document.querySelectorAll('button').forEach((button) => { if (button.textContent.includes('返回计划')) button.dataset.route = '9'; });
    const header = document.querySelector('[data-purpose="top-navigation"]');
    const fromPlanPage = new URLSearchParams(location.search).get('source') === 'plan';
    if (header?.firstElementChild) {
      header.firstElementChild.replaceChildren();
      if (fromPlanPage) {
        const back = document.createElement('button'); back.type = 'button'; back.className = 'w-9 h-9 flex items-center justify-center rounded-full text-2xl text-slate-300 hover:bg-white/10';
        back.setAttribute('aria-label', '返回计划'); back.textContent = '‹'; back.dataset.route = '9'; header.firstElementChild.append(back);
      }
    }
    const list = document.querySelector('[data-purpose="specific-changes-section"] .space-y-3');
    const note = document.querySelector('[data-purpose="explanation-section"] .space-y-3');
    const explanationSection = document.querySelector('[data-purpose="explanation-section"]');
    const explanationCard = explanationSection?.querySelector('.bg-navy-850\\/75');
    const explanationHeader = explanationSection?.querySelector('.flex.items-center');
    if (explanationCard && explanationHeader) {
      explanationCard.id = 'plan-adjustment-explanation';
      explanationCard.hidden = true;
      explanationCard.style.display = 'none';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100 shadow-[0_4px_14px_rgba(16,185,129,0.12)] transition hover:border-emerald-200/45 hover:bg-emerald-300/[0.14] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50';
      toggle.setAttribute('aria-controls', explanationCard.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', '查看具体调整说明');
      toggle.title = '查看具体调整说明';
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('viewBox', '0 0 24 24');
      chevron.setAttribute('width', '20');
      chevron.setAttribute('height', '20');
      chevron.setAttribute('fill', 'none');
      chevron.setAttribute('stroke', 'currentColor');
      chevron.setAttribute('stroke-width', '2.25');
      chevron.setAttribute('stroke-linecap', 'round');
      chevron.setAttribute('stroke-linejoin', 'round');
      chevron.classList.add('transition-transform', 'duration-200');
      const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      chevronPath.setAttribute('d', 'm6 9 6 6 6-6');
      chevron.append(chevronPath);
      toggle.append(chevron); explanationHeader.append(toggle);
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        explanationCard.hidden = expanded;
        explanationCard.style.display = expanded ? 'none' : '';
        toggle.setAttribute('aria-label', expanded ? '查看具体调整说明' : '收起调整说明');
        toggle.title = expanded ? '查看具体调整说明' : '收起调整说明';
        chevron.style.transform = expanded ? '' : 'rotate(180deg)';
      });
    }
    const renderPlanChanges = () => {
      const before = state.previousPlan?.workouts || [];
      const after = state.activePlan?.workouts || [];
      const adjustment = state.adjustment;
      const edits = adjustment?.workouts?.length ? adjustment.workouts
        : ['rest', 'medical_review'].includes(adjustment?.status) ? (adjustment?.planChanges || []) : [];
      const changed = edits.map((edit) => {
        const prior = before.find((candidate) => candidate.week === edit.week && candidate.day === edit.day);
        const current = after.find((candidate) => candidate.week === edit.week && candidate.day === edit.day);
        const item = { ...(current || {}), ...edit };
        if (current?.status) item.status = current.status;
        else if (['rest', 'medical_review'].includes(adjustment?.status) && Number(edit.durationMin) === 0) item.status = 'skipped';
        return prior ? { prior, item } : null;
      }).filter(Boolean).slice(0, 3);
      if (list) {
      list.replaceChildren();
      changed.forEach(({ prior, item }, index) => {
        const card = document.createElement('article'); card.className = `bg-navy-850/75 backdrop-blur-xl rounded-2xl border border-white/[0.08] p-3.5 animate-fade-slide stagger-${Math.min(index + 1, 3)} shadow-[0_4px_20px_rgba(0,0,0,0.3)]`; card.dataset.purpose = 'change-item';
        const top = document.createElement('div'); top.className = 'flex items-center justify-between pb-2 border-b border-white/[0.06] mb-2.5';
        const badge = document.createElement('span'); badge.className = 'text-[12px] font-semibold tracking-wide text-white bg-white/[0.06] px-2 py-0.5 rounded border border-white/10'; badge.textContent = `第 ${item.week} 周 · Day ${item.day}`; top.append(badge);
        const comparison = document.createElement('div'); comparison.className = 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[13px]';
        const oldBox = document.createElement('div'); oldBox.className = 'flex min-w-0 flex-col gap-0.5 text-left';
        const oldLabel = document.createElement('span'); oldLabel.className = 'text-[11px] text-slate-400 font-medium'; oldLabel.textContent = '原计划';
        const oldName = document.createElement('span'); oldName.className = 'text-slate-300 font-normal'; oldName.textContent = courseName(prior);
        const workoutMeta = (workout) => {
          const range = Array.isArray(workout.distanceRangeKm) && workout.distanceRangeKm.length === 2
            ? `${Number(workout.distanceRangeKm[0]).toFixed(1)}–${Number(workout.distanceRangeKm[1]).toFixed(1)} km`
            : '';
          const pace = paceRangeText(workout);
          return [range, pace].filter(Boolean).join(' · ') || '距离和配速暂不可用';
        };
        const oldMeta = document.createElement('span'); oldMeta.className = 'text-[9px] leading-4 tracking-tight text-slate-400 whitespace-nowrap'; oldMeta.textContent = workoutMeta(prior); oldBox.append(oldLabel, oldName, oldMeta);
        const arrow = document.createElement('span'); arrow.className = 'text-cyan-400 shrink-0'; arrow.textContent = '→';
        const newBox = document.createElement('div'); newBox.className = 'flex min-w-0 flex-col gap-0.5 text-right';
        const cancelled = item.status === 'skipped';
        const newLabel = document.createElement('span'); newLabel.className = 'text-[11px] text-cyan-400 font-medium'; newLabel.textContent = cancelled ? '调整为休息' : '调整后计划';
        const newName = document.createElement('span'); newName.className = 'text-cyan-300 font-semibold truncate'; newName.textContent = cancelled ? '本次训练已取消' : courseName(item);
        const newMeta = document.createElement('span'); newMeta.className = 'text-[9px] leading-4 tracking-tight text-cyan-200 whitespace-nowrap'; newMeta.textContent = cancelled ? '按反馈暂停本周训练' : workoutMeta(item); newBox.append(newLabel, newName, newMeta);
        comparison.append(oldBox, arrow, newBox); card.append(top, comparison); list.append(card);
      });
      if (!changed.length) { const card = document.createElement('div'); card.className = 'bg-navy-850/75 backdrop-blur-xl rounded-2xl border border-white/[0.08] p-4 text-[13px] text-slate-300'; card.textContent = !adjustment ? '还没有训练计划调整记录。' : adjustment.status === 'maintain' ? '本次计划保持不变。' : '本次没有需要变更的后续课程。'; list.append(card); }
      }
      if (note) {
        note.replaceChildren();
        const lines = String(state.feedbackAnalysis || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) lines.push(adjustment ? '本次暂无调整说明。' : '还没有训练计划调整说明。');
        lines.forEach((line) => { const entry = document.createElement('div'); entry.className = 'flex items-start gap-2.5'; const dot = document.createElement('span'); dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-400 mt-2 shrink-0'; const text = document.createElement('p'); text.className = 'text-slate-300'; text.textContent = line; entry.append(dot, text); note.append(entry); });
      }
    };
    if (list) { list.replaceChildren(); const loading = document.createElement('div'); loading.className = 'text-[13px] text-slate-400'; loading.textContent = '正在读取最近一次计划调整…'; list.append(loading); }
    api('/plans/adjustments/latest').then((result) => {
      state.previousPlan = result.previousPlan || null;
      state.activePlan = result.plan || state.activePlan || null;
      state.adjustment = result.adjustment || null;
      state.feedbackAnalysis = result.feedbackAnalysis || '';
      save(); renderPlanChanges();
    }).catch((error) => { renderPlanChanges(); notify(error.message); });
  }
  if (page === 'mine') {
    const rows = [...document.querySelectorAll('.menu-row')];
    if (rows[0]) { rows[0].dataset.profileReadonly = '1'; rows[0].querySelector('span:last-child')?.remove(); rows[0].setAttribute('role', 'button'); rows[0].tabIndex = 0; }
    if (rows[1]) { rows[1].dataset.action = 'logout'; rows[1].setAttribute('role', 'button'); rows[1].tabIndex = 0; }
    if (rows[2]) { rows[2].dataset.action = 'delete-account'; rows[2].setAttribute('role', 'button'); rows[2].tabIndex = 0; }
  }

  // One delegated handler covers every data-driven route and back/logout action.
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-route], [data-action]'); if (!target) return;
    if (target.dataset.profileReadonly) { window.location.href = `${encodeURI(pageFiles[7])}?readonly=1`; return; }
    if (target.dataset.route) { const n = Number(target.dataset.route); if (n) go(n); return; }
    if (target.dataset.action === 'back') { go(backTargets[page] || 1); return; }
    if (target.dataset.action === 'logout') { sessionStorage.removeItem(stateKey); sessionStorage.removeItem(authKey); localStorage.removeItem(tokenKey); go(1); }
    if (target.dataset.action === 'delete-account') {
      if (!window.confirm('注销后，此账号的跑者档案、训练计划、训练记录和反馈将被永久删除，无法恢复。确定注销账户吗？')) return;
      target.setAttribute('aria-disabled', 'true');
      api('/me/account', { method: 'DELETE' }).then(() => {
        sessionStorage.removeItem(stateKey); sessionStorage.removeItem(authKey); localStorage.removeItem(tokenKey);
        window.location.href = encodeURI(pageFiles[1]);
      }).catch((error) => { target.removeAttribute('aria-disabled'); notify(error.message); });
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-route], [data-action]');
    if (target && target.tagName !== 'BUTTON' && target.tagName !== 'A') { event.preventDefault(); target.click(); }
  });
})();
