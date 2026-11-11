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
        ['latest-10k', (v) => Number.isInteger(Number(v)) && Number(v) >= 40 && Number(v) <= 80, '10km 成绩需为 40–80 分钟的整数'],
        ['train-days', (v) => Number.isInteger(Number(v)) && Number(v) >= 3 && Number(v) <= 7, '每周训练天数需为 3–7 天的整数']
      ];
      for (const [id, valid, message] of fields) { const el = document.getElementById(id); const v = value(id); if (!v || !valid(v)) { el.setCustomValidity(message); el.reportValidity(); el.setCustomValidity(''); return; } }
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
      p['longest-run'] ? `最长连续跑 ${p['longest-run']} km<br>最近一次10km ${p['latest-10k'] || ''} 分钟<br>每周可训练 ${p['train-days'] || ''} 天` : '',
      p.targetMinutes ? `${p.targetMinutes} 分钟` : '',
      Array.isArray(p.health) && p.health.length ? p.health.join('、') : ''
    ];
    const editPages = [2, 3, 4, 5, 6];
    document.querySelectorAll('.profile-row').forEach((row, index) => {
      if (index === 2) row.classList.add('profile-running-row');
      const valueNode = row.querySelector('.profile-value'); const edit = row.querySelector('.edit');
      if (valueNode) { const text = document.createElement('span'); text.className = 'profile-summary'; text.innerHTML = summaries[index]; valueNode.insertBefore(text, valueNode.firstChild); }
      if (edit) { edit.setAttribute('role', 'button'); edit.tabIndex = 0; edit.dataset.route = String(editPages[index]); }
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
    const setProgress = (done) => steps.forEach((heading, index) => {
      const box = heading.closest('.flex.items-start');
      const status = box?.querySelector('span[class*="text-[10px]"]');
      if (status) status.textContent = done ? '已完成' : index === 0 ? '进行中' : '等待中';
    });
    setProgress(false);
    if (page === 'plan-generation') state.planRequestKey ||= crypto.randomUUID();
    let taskSucceeded = false;
    const task = page === 'plan-adjust'
      ? api(`/training-records/${state.trainingRecordId}/adjust-plan`, { method: 'POST' })
      : api('/plans/generate', { method: 'POST', headers: { 'Idempotency-Key': state.planRequestKey } });
    if (page === 'plan-adjust') state.previousPlan = state.activePlan;
    task.then((result) => {
      taskSucceeded = true; state.activePlan = result.plan;
      if (page === 'plan-adjust') { state.adjustment = result.adjustment || null; state.feedbackAnalysis = result.feedbackAnalysis || ''; state.warmupStretchSources = result.warmupStretchSources || []; }
      if (page === 'plan-generation') delete state.planRequestKey; save(); setProgress(true);
      if (cta) { cta.disabled = false; const label = cta.querySelector('span:last-child'); if (label) label.textContent = page === 'plan-adjust' ? '查看调整结果' : '查看训练计划'; const spinner = cta.querySelector('.animate-spin'); if (spinner) spinner.textContent = '✓'; }
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
          const title = document.querySelector('.today-card h2'); if (title) title.textContent = `${workout.courseKey || '课程'} · ${workout.courseName || workout.title}`;
          const metrics = document.querySelectorAll('.today-metrics .metric strong');
          if (metrics[0]) metrics[0].innerHTML = `${workout.distanceKm ?? '—'} <small>km</small>`;
          if (metrics[2]) metrics[2].innerHTML = `${workout.durationMin ?? '—'} <small>分</small>`;
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
        if (frequency?.parentElement?.lastElementChild) frequency.parentElement.lastElementChild.textContent = `每周最多 ${plan.trainDays} 次 · ${total} 节训练`;
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
              const row = document.createElement('div'); row.className = `relative ${w.status === 'in_progress' ? 'py-3' : 'py-2.5'} flex items-center justify-between gap-3 whitespace-nowrap`;
              const dot = document.createElement('div'); dot.className = `absolute -left-[28px] top-1/2 -translate-y-1/2 ${w.status === 'in_progress' ? 'w-2.5 h-2.5 rounded-full bg-[#007AFF]' : 'w-2 h-2 rounded-full bg-[#C1C6D7]'} ring-2 ring-[#F8F9FA]`;
              const labelWrap = document.createElement('div'); labelWrap.className = 'flex items-center gap-2.5 min-w-0 flex-1';
              const dayLabel = document.createElement('span'); dayLabel.className = `text-[12px] ${w.status === 'in_progress' ? 'font-bold text-[#007AFF]' : 'font-semibold text-[#86868B]'} shrink-0`; dayLabel.textContent = `Day ${w.day}`;
              const name = document.createElement('span'); name.className = `text-[13px] ${w.status === 'in_progress' ? 'font-bold' : 'font-medium'} text-[#1D1D1F] truncate`; name.textContent = `${w.courseKey || w.courseId || '课程'} · ${w.courseName || w.title}`;
              labelWrap.append(dayLabel, name);
              const right = document.createElement('div'); right.className = 'flex items-center gap-2 shrink-0';
              const meta = document.createElement('span'); meta.className = 'text-[11px] text-[#86868B]'; meta.textContent = `${w.distanceKm != null ? `${w.distanceKm} km` : ''}${w.distanceKm != null && w.durationMin ? ' · ' : ''}${w.durationMin ? `${w.durationMin}分` : ''}`;
              const stateLabel = document.createElement('span'); stateLabel.className = 'text-[11px] text-[#86868B]'; stateLabel.textContent = w.status === 'completed' ? '已完成' : w.status === 'in_progress' ? '进行中' : '待开始';
              right.append(meta, stateLabel); row.append(dot, labelWrap, right);
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
      if (title) title.textContent = `${workout.courseKey || '课程'} · ${workout.courseName || workout.title}`;
      const value = document.querySelector('[data-workout-value]');
      if (value) value.textContent = workout.distanceKm != null ? `${workout.distanceKm} km` : `${workout.durationMin ?? '—'} 分钟`;
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
    let seconds = 0, paused = false;
    let holdStart = 0, holdFrame = 0, runEnded = false;
    const holdDuration = 1700;
    const circumference = 2 * Math.PI * 36;
    const timer = window.setInterval(() => { if (!paused) seconds += 1; const min = String(Math.floor(seconds / 60)).padStart(2, '0'); const sec = String(seconds % 60).padStart(2, '0'); if (metrics[1]) metrics[1].textContent = `${min}:${sec}`; if (distance) distance.textContent = (seconds * .00278).toFixed(2); if (metrics[0]) metrics[0].textContent = seconds ? `${Math.floor(360 + seconds / 60)}'00"` : '—'; }, 1000);
    const finishRun = () => {
      if (runEnded) return;
      runEnded = true;
      window.cancelAnimationFrame(holdFrame);
      window.clearInterval(timer);
      state.run = { seconds, distance: Number((seconds * .00278).toFixed(2)), completedAt: Date.now() };
      save();
      const saveRun = state.trainingRecordId ? api(`/training-records/${state.trainingRecordId}/finish`, { method: 'POST', body: JSON.stringify({ distanceKm: state.run.distance, durationMin: Number((seconds / 60).toFixed(2)), completed: seconds > 0 }) }) : Promise.resolve();
      saveRun.then(() => go(14)).catch((error) => notify(error.message));
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
      paused = !paused;
      pauseButton.textContent = paused ? '▶' : 'Ⅱ';
      pauseButton.setAttribute('aria-label', paused ? '继续跑步' : '暂停跑步');
    });
  }
  if (page === 'complete') {
    const run = state.run || { distance: 0, seconds: 0 };
    const vals = document.querySelectorAll('.training-summary-value');
    const mins = Math.max(1, Math.round(run.seconds / 60));
    if (vals[0]) vals[0].textContent = Number(run.distance).toFixed(1);
    if (vals[1]) vals[1].textContent = String(mins);
    if (vals[2]) vals[2].textContent = Number(run.distance) < .01 ? '—' : `${Math.floor(mins / Number(run.distance))}'00"`;
    document.getElementById('feedback-step-btn')?.addEventListener('click', () => go(16));
    document.getElementById('return-plan-btn')?.addEventListener('click', () => go(9));
  }

  // Feedback controls, ratings, tags, optional note and local photo selection.
  if (page === 'feedback') {
    const feedback = state.feedback || { scores: {}, parts: [] };
    const workoutLabel = document.querySelector('[data-feedback-workout]');
    if (workoutLabel) api('/plans/active').then(({ plan }) => {
      const workout = plan?.workouts?.find((item) => item.id === state.workoutId);
      if (!workout) return;
      const amount = workout.distanceKm != null ? `${workout.distanceKm} km` : workout.durationMin != null ? `${workout.durationMin} 分钟` : '';
      workoutLabel.textContent = `${workout.courseKey || workout.courseId || '课程'} · ${workout.courseName || workout.title}${amount ? ` · ${amount}` : ''}`;
    }).catch((error) => notify(error.message));
    ['subjective', 'physical', 'pain'].forEach((key) => {
      const container = document.getElementById(`stars-${key}`); if (!container) return;
      container.innerHTML = Array.from({ length: 5 }, (_, i) => `<button type="button" aria-label="${i + 1} 分" aria-pressed="${i < (feedback.scores[key] || 0)}" data-rating="${i + 1}" class="rating-star transition-transform active:scale-125 focus:outline-none p-0.5"><svg class="w-7 h-7 drop-shadow-sm" fill="${i < (feedback.scores[key] || 0) ? '#ff9800' : '#cbd5e1'}" viewBox="0 0 24 24"><path style="fill:${i < (feedback.scores[key] || 0) ? '#ff9800' : '#cbd5e1'} !important" d="M12 0 C12 7, 7 12, 0 12 C7 12, 12 17, 12 24 C12 17, 17 12, 24 12 C17 12, 12 7, 12 0 Z"></path><rect fill="#ffffff" height="3.2" rx="0.8" transform="rotate(45 12 12)" width="3.2" x="10.4" y="10.4"></rect></svg></button>`).join('');
      container.addEventListener('click', (event) => {
        const b = event.target.closest('[data-rating]'); if (!b) return;
        feedback.scores[key] = Number(b.dataset.rating);
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
    const no = document.getElementById('btn-discomfort-no'), yes = document.getElementById('btn-discomfort-yes'), box = document.getElementById('discomfort-box');
    const locationInput = box?.querySelector('input');
    const showParts = (show) => { if (box) { box.classList.toggle('hidden', !show); box.classList.toggle('flex', show); } no?.classList.toggle('ring-2', !show); yes?.classList.toggle('ring-2', show); };
    no?.addEventListener('click', () => { feedback.discomfort = false; feedback.parts = []; if (locationInput) locationInput.value = ''; state.feedback = feedback; save(); showParts(false); });
    yes?.addEventListener('click', () => { feedback.discomfort = true; state.feedback = feedback; save(); showParts(true); });
    box?.querySelectorAll('.part-chip').forEach((chip) => chip.addEventListener('click', () => { chip.classList.toggle('ring-2'); const name = chip.textContent.trim(); feedback.parts = feedback.parts.includes(name) ? feedback.parts.filter((v) => v !== name) : [...feedback.parts, name]; state.feedback = feedback; save(); }));
    if (feedback.discomfort) showParts(true);
    const comment = document.getElementById('comment-box');
    if (comment && feedback.comment) comment.value = feedback.comment;
    if (comment && document.getElementById('char-count')) document.getElementById('char-count').textContent = `${comment.value.length} / 200`;
    if (locationInput && feedback.location) locationInput.value = feedback.location;
    box?.querySelectorAll('.part-chip').forEach((chip) => { if (feedback.parts.includes(chip.textContent.trim())) chip.classList.add('ring-2'); });
    locationInput?.addEventListener('input', () => { feedback.location = locationInput.value; state.feedback = feedback; save(); });
    comment?.addEventListener('input', () => { feedback.comment = comment.value; const counter = document.getElementById('char-count'); if (counter) counter.textContent = `${comment.value.length} / 200`; state.feedback = feedback; save(); });
    const attach = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('配图'));
    if (attach) { const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true; document.body.append(picker); attach.addEventListener('click', () => picker.click()); picker.addEventListener('change', () => { if (picker.files?.[0]) attach.setAttribute('aria-label', `已选择图片：${picker.files[0].name}`); }); }
    document.getElementById('submit-btn')?.addEventListener('click', () => {
      if (!['subjective', 'physical', 'pain'].every((key) => Number(feedback.scores[key]) >= 1 && Number(feedback.scores[key]) <= 5)) { notify('请完成三项训练感受评分后提交。'); return; }
      if (feedback.discomfort !== true && feedback.discomfort !== false) { notify('请选择是否有局部不适后提交。'); return; }
      feedback.comment = comment?.value || ''; feedback.location = locationInput?.value || ''; state.feedback = feedback; save();
      if (!state.trainingRecordId) { notify('找不到本次训练记录，请从今日训练重新开始。'); return; }
      api(`/training-records/${state.trainingRecordId}/feedback`, { method: 'POST', body: JSON.stringify({ subjective: Number(feedback.scores.subjective), physical: Number(feedback.scores.physical), pain: Number(feedback.scores.pain), discomfort: feedback.discomfort, discomfortParts: [...feedback.parts, ...(feedback.location ? [feedback.location] : [])], note: feedback.comment, completion: state.run?.seconds ? 'completed' : 'partial' }) })
        .then((result) => { state.feedbackId = result.feedbackId; state.feedbackAnalysis = result.analysis; save(); go(17); })
        .catch((error) => notify(error.message));
    });
  }
  if (page === 'plan-changes') {
    document.querySelectorAll('button').forEach((button) => { if (button.textContent.includes('返回计划')) button.dataset.route = '9'; });
    const headerBack = document.querySelector('header button'); if (headerBack) headerBack.dataset.route = '9';
    const before = state.previousPlan?.workouts || [];
    const after = state.activePlan?.workouts || [];
    const changed = after.filter((item) => item.status === 'scheduled').map((item) => {
      const prior = before.find((candidate) => candidate.week === item.week && candidate.day === item.day);
      return prior && (prior.courseKey !== item.courseKey || prior.title !== item.title || prior.type !== item.type || prior.durationMin !== item.durationMin || prior.distanceKm !== item.distanceKm || prior.intensity !== item.intensity || prior.talkTest !== item.talkTest) ? { prior, item } : null;
    }).filter(Boolean).slice(0, 3);
    const list = document.querySelector('[data-purpose="specific-changes-section"] .space-y-3');
    if (list) {
      list.replaceChildren();
      changed.forEach(({ prior, item }, index) => {
        const card = document.createElement('article'); card.className = `bg-navy-850/75 backdrop-blur-xl rounded-2xl border border-white/[0.08] p-3.5 animate-fade-slide stagger-${Math.min(index + 1, 3)} shadow-[0_4px_20px_rgba(0,0,0,0.3)]`; card.dataset.purpose = 'change-item';
        const top = document.createElement('div'); top.className = 'flex items-center justify-between pb-2 border-b border-white/[0.06] mb-2.5';
        const badge = document.createElement('span'); badge.className = 'text-[12px] font-semibold tracking-wide text-white bg-white/[0.06] px-2 py-0.5 rounded border border-white/10'; badge.textContent = `第 ${item.week} 周 · Day ${item.day}`; top.append(badge);
        const comparison = document.createElement('div'); comparison.className = 'flex items-center justify-between gap-2 text-[13px]';
        const oldBox = document.createElement('div'); oldBox.className = 'flex flex-col gap-0.5 shrink-0 w-28';
        const oldLabel = document.createElement('span'); oldLabel.className = 'text-[11px] text-slate-400 font-medium'; oldLabel.textContent = '原计划';
        const oldName = document.createElement('span'); oldName.className = 'text-slate-300 font-normal'; oldName.textContent = `${prior.courseKey || prior.courseId || '课程'} · ${prior.courseName || prior.title}`;
        const workoutMeta = (workout) => [workout.distanceKm != null ? `${workout.distanceKm} km` : workout.durationMin != null ? `${workout.durationMin} 分钟` : '', workout.intensity].filter(Boolean).join(' · ');
        const oldMeta = document.createElement('span'); oldMeta.className = 'text-[10px] text-slate-400'; oldMeta.textContent = workoutMeta(prior); oldBox.append(oldLabel, oldName, oldMeta);
        const arrow = document.createElement('span'); arrow.className = 'text-cyan-400 shrink-0 mr-auto'; arrow.textContent = '→';
        const newBox = document.createElement('div'); newBox.className = 'flex flex-col gap-0.5 text-right shrink-0';
        const newLabel = document.createElement('span'); newLabel.className = 'text-[11px] text-cyan-400 font-medium'; newLabel.textContent = '调整后计划';
        const newName = document.createElement('span'); newName.className = 'text-cyan-300 font-semibold truncate'; newName.textContent = `${item.courseKey || item.courseId || '课程'} · ${item.courseName || item.title}`;
        const newMeta = document.createElement('span'); newMeta.className = 'text-[10px] text-cyan-200'; newMeta.textContent = workoutMeta(item); newBox.append(newLabel, newName, newMeta);
        comparison.append(oldBox, arrow, newBox); card.append(top, comparison); list.append(card);
      });
      if (!changed.length) { const card = document.createElement('div'); card.className = 'bg-navy-850/75 backdrop-blur-xl rounded-2xl border border-white/[0.08] p-4 text-[13px] text-slate-300'; card.textContent = state.adjustment?.status === 'maintain' ? '本次计划保持不变。' : '本次没有需要变更的后续课程。'; list.append(card); }
    }
    const note = document.querySelector('[data-purpose="explanation-section"] .space-y-3');
    if (note) {
      note.replaceChildren();
      const lines = String(state.feedbackAnalysis || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const reason = state.adjustment?.reason; if (reason) lines.push(`调整原因=${reason}`);
      if (!lines.length) lines.push('Dify 未返回反馈分析说明。');
      lines.forEach((line) => { const entry = document.createElement('div'); entry.className = 'flex items-start gap-2.5'; const dot = document.createElement('span'); dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-400 mt-2 shrink-0'; const text = document.createElement('p'); text.className = 'text-slate-300'; text.textContent = line; entry.append(dot, text); note.append(entry); });
    }
  }
  if (page === 'mine') {
    const rows = [...document.querySelectorAll('.menu-row')];
    if (rows[0]) { rows[0].dataset.route = '7'; rows[0].setAttribute('role', 'button'); rows[0].tabIndex = 0; }
    if (rows[1]) { rows[1].dataset.action = 'logout'; rows[1].setAttribute('role', 'button'); rows[1].tabIndex = 0; }
  }

  // One delegated handler covers every data-driven route and back/logout action.
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-route], [data-action]'); if (!target) return;
    if (target.dataset.route) { const n = Number(target.dataset.route); if (n) go(n); return; }
    if (target.dataset.action === 'back') { go(backTargets[page] || 1); return; }
    if (target.dataset.action === 'logout') { sessionStorage.removeItem(stateKey); sessionStorage.removeItem(authKey); localStorage.removeItem(tokenKey); go(1); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-route], [data-action]');
    if (target && target.tagName !== 'BUTTON' && target.tagName !== 'A') { event.preventDefault(); target.click(); }
  });
})();
