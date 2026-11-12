(function () {
  'use strict';

  const root = './';
  const pages = {
    login: '01 登录与注册.html',
    profile1: '02 跑者建档一.html',
    profile2: '03 跑者建档二.html',
    profile3: '04 跑者建档三.html',
    profile4: '05 跑者建档四.html',
    profile5: '06 跑者建档五.html',
    profile6: '07 跑者建档六.html',
    generating: '08 ai计划生成页.html',
    plan: '09 计划页.html',
    overview: '10 计划总览页.html',
    training: '11 训练页.html',
    warmup: '12 热身页.html',
    running: '13 跑步页.html',
    stretch: '14 拉伸页.html',
    complete: '15 训练完成页.html',
    feedback: '16 用户训练反馈页.html',
    adjust: '17 ai计划调整页.html',
    compare: '18 计划前后对比页.html',
    mine: '19 我的页面.html'
  };

  const previousRoutes = {
    [pages.profile1]: 'login',
    [pages.profile2]: 'profile1',
    [pages.profile3]: 'profile2',
    [pages.profile4]: 'profile3',
    [pages.profile5]: 'profile4',
    [pages.profile6]: 'profile5',
    [pages.generating]: 'profile6',
    [pages.plan]: 'generating',
    [pages.overview]: 'plan',
    [pages.training]: 'plan',
    [pages.warmup]: 'training',
    [pages.running]: 'warmup',
    [pages.stretch]: 'running',
    [pages.complete]: 'stretch',
    [pages.feedback]: 'complete',
    [pages.adjust]: 'feedback',
    [pages.compare]: 'adjust'
  };

  const normalize = (value) => (value || '').replace(/\s+/g, '').trim();
  const currentFile = decodeURIComponent(location.pathname.split(/[\\/]/).pop() || '');
  const tokenKey = 'zc:auth-token';
  const mockMode = true;

  function mockPlan() {
    const saved = localStorage.getItem('zc:mock-plan');
    if (saved) return JSON.parse(saved);
    const workouts = [];
    const easyMinutes = [35, 40, 40, 35, 45, 45, 40, 35];
    const longDistances = [6, 7, 8, 6, 8, 9, 8, 6];
    for (let week = 1; week <= 8; week += 1) {
      workouts.push({ id: `mock-${week}-1`, week, day: 1, type: week % 2 ? 'easy' : 'recovery', durationMin: easyMinutes[week - 1], distanceKm: null, intensity: { rpe: week % 2 ? 4 : 3, talkTest: '可以完整对话', purpose: '建立或恢复有氧基础', prerequisite: '无明显疼痛', downgrade: '降低速度或缩短10分钟' } });
      workouts.push({ id: `mock-${week}-2`, week, day: 2, type: 'aerobic_base', durationMin: easyMinutes[week - 1] + 5, distanceKm: null, intensity: { rpe: 5, talkTest: '可以说完整句子', purpose: '巩固有氧能力', prerequisite: '上一节训练后无异常疲劳', downgrade: '降为easy强度' } });
      workouts.push({ id: `mock-${week}-3`, week, day: 3, type: 'long_run', durationMin: null, distanceKm: longDistances[week - 1], intensity: { rpe: 5, talkTest: '可以说完整句子', purpose: '提升持续跑能力', prerequisite: '前两节训练完成且无疼痛', downgrade: '缩短1–2公里或改为跑走结合' } });
    }
    const plan = { title: '10km基础进阶训练计划', goal: '完成10公里', targetMinutes: null, weeks: 8, trainDays: 3, startDate: new Date().toISOString().slice(0, 10), source: 'frontend-demo', workouts };
    localStorage.setItem('zc:mock-plan', JSON.stringify(plan));
    localStorage.setItem('zc:mock-workouts', JSON.stringify(workouts.map(item => ({ ...item, status: 'planned', completed: null }))));
    return plan;
  }

  async function mockApi(path, options = {}) {
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/auth/login' || path === '/auth/register') return { token: 'frontend-demo-token', user: { id: 'frontend-demo-user', account: body.account || 'demo' } };
    if (path === '/profile' && options.method === 'PUT') { localStorage.setItem('zc:mock-profile', JSON.stringify(body)); return body; }
    if (path === '/profile') return JSON.parse(localStorage.getItem('zc:mock-profile') || '{}');
    if (path === '/plan' || path === '/plan/generate') return mockPlan();
    if (path === '/workouts') return JSON.parse(localStorage.getItem('zc:mock-workouts') || JSON.stringify(mockPlan().workouts.map(item => ({ ...item, status: 'planned', completed: null }))));
    if (path.startsWith('/workouts/') && path.endsWith('/complete')) {
      const workoutId = path.split('/')[2];
      const items = JSON.parse(localStorage.getItem('zc:mock-workouts') || '[]');
      const item = items.find(row => row.id === workoutId) || items.find(row => row.status !== 'completed');
      if (!item) throw new Error('没有可完成的训练');
      item.status = 'completed'; item.completed = body;
      localStorage.setItem('zc:mock-workouts', JSON.stringify(items));
      return { id: item.id, status: 'completed', completed: body };
    }
    if (path === '/feedback') {
      const current = mockPlan();
      const previousPlan = structuredClone(current);
      const next = current.workouts.find(item => !JSON.parse(localStorage.getItem('zc:mock-workouts') || '[]').find(row => row.id === item.id)?.completed);
      if (next && Number(body.subjective || 0) >= 4) { next.type = 'recovery'; next.durationMin = 25; next.distanceKm = null; next.intensity.rpe = 3; }
      current.adjustment = { status: Number(body.subjective || 0) >= 4 ? 'reduce' : 'maintain', reason: Number(body.subjective || 0) >= 4 ? '根据反馈降低下一节训练负荷' : '当前反馈不需要调整训练负荷' };
      localStorage.setItem('zc:mock-plan', JSON.stringify(current));
      return { status: 'completed', previousPlan, plan: current, feedback: body };
    }
    return {};
  }

  async function api(path, options = {}) {
    return mockMode ? mockApi(path, options) : {};
  }

  async function syncProfile() {
    const profile = readProfile();
    delete profile.weeklyRuns;
    if (localStorage.getItem(tokenKey) && Object.keys(profile).length) await api('/profile', { method: 'PUT', body: JSON.stringify(profile) });
  }

  async function authenticate() {
    const account = document.getElementById('account-input')?.value.trim();
    const password = document.getElementById('password-input')?.value || '';
    const register = document.getElementById('tab-register')?.getAttribute('aria-selected') === 'true';
    if (!account || !password) throw new Error('请输入账号和密码');
    if (register && password !== (document.getElementById('confirm-password-input')?.value || '')) throw new Error('两次输入的密码不一致');
    const result = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify({ account, password }) });
    localStorage.setItem(tokenKey, result.token);
    localStorage.setItem('zc:user', JSON.stringify(result.user));
    return result;
  }

  function showApiError(error) { window.alert(`智程服务暂时不可用：${error.message}`); }

  const formatPace = (minutes) => { const total = Math.max(0, Math.round(Number(minutes || 0) * 60)); return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, '0')}\"`; };
  const formatWorkout = (workout) => { const parts = []; if (workout?.distanceKm != null && Number(workout.distanceKm) > 0) parts.push(`${Number(workout.distanceKm).toFixed(1)} km`); if (workout?.durationMin != null && Number(workout.durationMin) > 0) parts.push(`${Number(workout.durationMin)}分`); return parts.join(' · ') || '按课程说明执行'; };
  function showPageError(message) {
    const main = document.querySelector('main');
    if (!main) return;
    main.innerHTML = `<div class="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm"><h1 class="text-xl font-bold text-slate-900">暂时无法显示</h1><p class="mt-3 text-sm text-slate-500">${message}</p><button type="button" class="mt-6 rounded-xl bg-primary px-5 py-3 font-semibold text-white" onclick="location.reload()">重新加载</button></div>`;
  }
  const getPlanData = () => api('/plan');
  const getWorkoutData = () => api('/workouts');
  const weekRows = (block) => [...block.querySelectorAll('div.relative.py-2\\.5, div.relative.py-3')].filter((row) => row.querySelector(':scope > div:not(.absolute) span'));
  const weekLabel = (block, week) => { const label = [...block.querySelectorAll('span,h2')].find((node) => /^第\s*\d+\s*周$/.test(node.textContent.trim())); if (label) label.textContent = `第 ${week} 周`; const badge = [...block.querySelectorAll('div')].find((node) => /^W\d+$/.test(node.textContent.trim())); if (badge) badge.textContent = `W${week}`; };
  function hydrateWeekTimeline(plan, workouts) {
    const timeline = document.querySelector('main .relative.flex.flex-col.pl-2');
    if (!timeline) return;
    const weeks = Math.min(12, Math.max(8, Number(plan.weeks || 8)));
    let blocks = [...timeline.children].filter((node) => !node.classList.contains('absolute'));
    const template = blocks[blocks.length - 1];
    while (blocks.length < weeks && template) { const clone = template.cloneNode(true); timeline.appendChild(clone); blocks.push(clone); }
    blocks.forEach((block, index) => { block.hidden = index >= weeks; });
    for (let index = 0; index < weeks; index += 1) {
      const block = blocks[index]; const week = index + 1; const items = workouts.filter((item) => Number(item.week || item.weekNumber || 1) === week || (!item.week && index === 0));
      weekLabel(block, week);
      const container = block.querySelector('.ml-\\[18px\\]') || block;
      let rows = weekRows(block);
      const rowTemplate = rows[0];
      while (rows.length < items.length && rowTemplate) { const clone = rowTemplate.cloneNode(true); container.appendChild(clone); rows = weekRows(block); }
      rows.forEach((row, rowIndex) => { const workout = items[rowIndex]; row.hidden = !workout; if (!workout) return; const labels = row.querySelectorAll(':scope > div:not(.absolute) span'); const metric = row.querySelector(':scope > div:last-child span'); if (labels[0]) labels[0].textContent = `Day ${workout.day || rowIndex + 1}`; if (labels[1]) labels[1].textContent = workout.type || ''; if (metric) metric.textContent = formatWorkout(workout); });
      const status = [...block.querySelectorAll('span')].find((node) => /已完成|进行中|冲刺周|暂无安排/.test(node.textContent)); if (status) { const done = items.filter((item) => item.status === 'completed').length; status.textContent = items.length ? `${done}/${items.length} 已完成` : '暂无安排'; }
    }
  }

  async function hydratePlanPage() {
    if (currentFile !== pages.plan) return;
    try {
      const plan = await getPlanData();
      const workout = plan.workouts?.[0];
      if (!workout) throw new Error('计划没有课程');
      const title = document.querySelector('.hero-content h2');
      if (title) title.textContent = workout.type || plan.title;
      const metrics = document.querySelectorAll('.hero-content .metric-value');
      const distance = Number(workout.distanceKm || 0);
      if (metrics[0]) metrics[0].innerHTML = distance > 0 ? `${distance.toFixed(1)}<small>km</small>` : '—<small>km</small>';
      if (metrics[1]) metrics[1].innerHTML = distance > 0 ? `${formatPace(Number(workout.durationMin || 0) / distance)}<small>/km</small>` : '按RPE<small></small>';
      if (metrics[2]) metrics[2].innerHTML = `${Number(workout.durationMin || 0)}<small>分</small>`;
    } catch (_) { showPageError('请登录后查看你的训练计划。'); }
  }

  async function hydrateOverviewPage() {
    if (currentFile !== pages.overview) return;
    try {
      const [plan, workouts] = await Promise.all([getPlanData(), getWorkoutData()]);
      const title = document.querySelector('main h1');
      if (title && plan.title) title.textContent = plan.title;
      const total = workouts.length || plan.workouts?.length || 0;
      const completed = workouts.filter((item) => item.status === 'completed').length;
      const completedKm = workouts.reduce((sum, item) => sum + Number(item.completed?.distanceKm || 0), 0);
      const circle = document.querySelector('main .relative.w-24');
      const circleText = circle ? circle.querySelectorAll(':scope > div.absolute > span') : [];
      if (circleText[0]) circleText[0].textContent = `${total ? Math.round(completed / total * 100) : 0}`;
      if (circleText[1]) circleText[1].textContent = `${completed}/${total} 节`;
      if (circleText[2]) circleText[2].textContent = `已跑${completedKm.toFixed(1)}km`;
      const setMetric = (label, value) => { const node = [...document.querySelectorAll('main span')].find((item) => item.textContent.trim() === label); const values = node?.parentElement?.querySelectorAll(':scope > span'); if (values?.length) values[values.length - 1].textContent = value; };
      setMetric('目标距离', '10 km');
      setMetric('计划周期', `共 ${plan.weeks || 8} 周`);
      const totalDistance = workouts.reduce((sum, item) => sum + Number(item.distanceKm || 0), 0);
      setMetric('频次 & 总量', `${total}次 · ${totalDistance > 0 ? `${totalDistance.toFixed(1)}km` : '按课程时长'}`);
      hydrateWeekTimeline(plan, workouts.length ? workouts : (plan.workouts || []));
    } catch (error) { showPageError(`计划总览加载失败：${error.message || '请重新加载页面'}`); }
  }

  async function completeCurrentWorkout() {
    const workoutList = await getWorkoutData();
    const activeId = sessionStorage.getItem('zc:active-workout-id');
    const workout = workoutList.find((item) => item.id === activeId && item.status !== 'completed') || workoutList.find((item) => item.status !== 'completed');
    if (!workout) throw new Error('当前没有可完成的训练，请先从计划中开始一节训练');
    const value = (selector) => document.querySelector(selector)?.textContent.replace(/\s/g, '') || '';
    let distanceKm = Number(value('.distance .value').replace(/[^0-9.]/g, ''));
    let pace = value('.pace .value').replace(/′/g, "'").replace(/″/g, '"');
    const time = value('.time .value');
    const parts = time.split(':').map(Number);
    let durationMin = parts.length === 2 ? Math.round((parts[0] * 60 + parts[1]) / 60) : 0;
    if (mockMode && (!(distanceKm > 0) || !(durationMin > 0) || !pace)) {
      distanceKm = Number(workout.distanceKm || 5);
      durationMin = Number(workout.durationMin || 30);
      pace = formatPace(durationMin / distanceKm);
    }
    if (!(distanceKm > 0) || !(durationMin > 0) || !pace) throw new Error('未读取到有效的本次训练数据，请返回训练页后重试');
    const result = await api(`/workouts/${workout.id}/complete`, { method: 'POST', body: JSON.stringify({ distanceKm, durationMin, pace }) });
    sessionStorage.setItem('zc:last-workout', JSON.stringify(result));
    sessionStorage.removeItem('zc:active-workout-id');
  }

  function primeActiveWorkout() {
    if (currentFile !== pages.training || sessionStorage.getItem('zc:active-workout-id')) return;
    getWorkoutData().then((items) => {
      const next = items.find((item) => item.status !== 'completed');
      if (next) sessionStorage.setItem('zc:active-workout-id', next.id);
    }).catch(() => {});
  }

  async function hydrateCompletePage() {
    if (currentFile !== pages.complete) return;
    try {
      const workouts = await getWorkoutData();
      const lastRun = JSON.parse(sessionStorage.getItem('zc:last-workout') || '{}');
      const workout = workouts.find((item) => item.id === lastRun.id) || [...workouts].reverse().find((item) => item.status === 'completed') || workouts[workouts.length - 1];
      const data = workout?.completed || lastRun.completed;
      if (!data) throw new Error('暂无完成记录');
      const values = document.querySelectorAll('.training-summary-value');
      if (values[0]) values[0].textContent = Number(data.distanceKm || 0).toFixed(1);
      if (values[1]) values[1].textContent = String(data.durationMin || 0);
      if (values[2]) values[2].textContent = String(data.pace || '').replace(/\/km$/, '');
    } catch (_) { showPageError('暂无训练完成记录，请先完成一节训练。'); }
  }

  function hydrateComparePage() {
    if (currentFile !== pages.compare) return;
    try {
      const result = JSON.parse(sessionStorage.getItem('zc:last-adjustment') || '{}');
      const before = result.previousPlan?.workouts || [];
      const after = result.plan?.workouts || [];
      if (!before.length || !after.length) throw new Error('暂无调整结果');
      document.querySelectorAll('[data-purpose="change-item"]').forEach((card, index) => { const oldItem = before[index] || before[0]; const newItem = after[index] || after[0]; if (!oldItem || !newItem) return; const groups = card.querySelectorAll(':scope div.flex.flex-col'); const oldValue = groups[0]?.querySelectorAll('span')[1]; const newValue = groups[1]?.querySelectorAll('span')[1]; if (oldValue) oldValue.textContent = formatWorkout(oldItem); if (newValue) newValue.textContent = formatWorkout(newItem); const heading = card.querySelector(':scope > div:first-child > span'); if (heading) heading.textContent = `Day ${newItem.day || index + 1}`; });
      const explanation = document.querySelectorAll('[data-purpose="explanation-section"] p');
      if (explanation[0] && result.feedback) explanation[0].innerHTML = `<span class="text-slate-100 font-medium">触发现状：</span>本次训练反馈已同步，疲劳度 ${result.feedback.subjective || 1}/5。`;
      if (explanation[1] && result.plan?.adjustment?.reason) explanation[1].innerHTML = `<span class="text-slate-100 font-medium">即时调整：</span>${result.plan.adjustment.reason}`;
    } catch (_) { showPageError('暂无本次调整结果，请先提交训练反馈。'); }
  }

  function go(page, replace) {
    const target = pages[page] || page;
    if (!target) return;
    sessionStorage.setItem('zc:last-page', currentFile);
    (replace ? location.replace : location.assign).call(location, root + target);
  }

  function textOf(el) {
    return normalize(el && (el.innerText || el.textContent));
  }

  function routeFor(el) {
    const text = textOf(el);
    const id = el && el.id;
    const iconText = textOf(el.querySelector?.('.material-symbols-outlined'));

    if (el.dataset.profileSkip === 'true') {
      if (currentFile === pages.profile3) return 'profile4';
      if (currentFile === pages.profile4) return 'profile5';
    }

    if (/返回|上一步/.test(el.getAttribute('aria-label') || '')) return previousRoutes[currentFile] || '__back__';
    if (iconText === 'arrow_back' || iconText === 'arrow_back_ios_new') return previousRoutes[currentFile] || '__back__';
    if (currentFile === pages.compare && el.closest('[data-purpose="top-navigation"]')) return previousRoutes[currentFile] || '__back__';

    if (currentFile === pages.login && id === 'submit-cta') return 'profile1';
    if (currentFile === pages.profile1 && id === 'btn-next-step') return 'profile2';
    if (currentFile === pages.generating && id === 'ctaBtn') return 'plan';
    if (currentFile === pages.plan && /查看计划调整/.test(text)) return 'adjust';
    if (currentFile === pages.plan && /开始今日训练|开始训练/.test(text)) return 'training';
    if (currentFile === pages.plan && /完整计划|查看全部/.test(text)) return 'overview';
    if (currentFile === pages.overview && /去开跑|开始训练|开始今日训练|继续训练|训练/.test(text)) return 'training';
    if (currentFile === pages.training && /开始热身/.test(text)) return 'warmup';
    if (currentFile === pages.warmup && /开始跑步|开始训练/.test(text)) return 'running';
    if (currentFile === pages.running && /完成跑步|结束跑步|完成训练|下一步/.test(text)) return 'stretch';
    if (currentFile === pages.running && id === 'end') return 'stretch';
    if (currentFile === pages.stretch && /完成今日训练|完成训练/.test(text)) return 'complete';
    if (currentFile === pages.complete && id === 'feedback-step-btn') return 'feedback';
    if (currentFile === pages.complete && id === 'return-plan-btn') return 'overview';
    if (currentFile === pages.feedback && id === 'submit-btn') return 'adjust';
    if (currentFile === pages.adjust && id === 'ctaBtn') return 'compare';
    if (currentFile === pages.compare && /应用调整|查看新计划|查看更新后计划|返回计划|完成/.test(text)) return 'plan';

    if (currentFile === pages.profile2 && /继续/.test(text)) return 'profile3';
    if (currentFile === pages.profile3 && /继续/.test(text)) return 'profile4';
    if (currentFile === pages.profile4 && /查看我的跑者档案|继续|完成/.test(text)) return 'profile5';
    if (currentFile === pages.profile5 && /查看我的跑者档案|继续|下一步/.test(text)) return 'profile6';
    if (currentFile === pages.profile6 && /确认|生成|开始/.test(text)) return 'generating';
    if (currentFile === pages.generating && /查看计划|进入计划|完成/.test(text)) return 'plan';

    if ((el.tagName === 'A' && (el.getAttribute('href') === '#' || !el.getAttribute('href'))) || /^(训练|计划|我的)$/.test(text)) {
      if (text === '训练') return 'training';
      if (text === '计划') return 'plan';
      if (text === '我的') return 'mine';
    }
    return null;
  }

  async function startInitialGeneration(button = document.getElementById('ctaBtn')) {
    if (button) { button.disabled = true; button.dataset.originalText ||= button.textContent; button.textContent = '正在生成计划…'; }
    try {
      await syncProfile();
      await api('/plan/generate', { method: 'POST', body: '{}' });
      go('plan');
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = '重新生成计划'; }
      showApiError(error);
    }
  }

  function revealPage() {
    document.documentElement.classList.add('zc-ready');
  }

  async function install() {
    document.documentElement.dataset.page = currentFile;
    window.zcPages = pages;
    const safe = (name, fn) => { try { fn(); } catch (error) { console.error(`navigation ${name} failed`, error); } };
    safe('avatar', installAiAvatar);
    safe('progress', normalizeProfileProgress);
    safe('profile one action', normalizeProfileOneAction);
    safe('profile five action', normalizeProfileFiveAction);
    safe('profile five layout', normalizeProfileFiveLayout);
    safe('avatar label', restoreGenerationAvatarLabel);
    safe('workout actions', installWorkoutActionButtons);
    safe('profile labels', normalizeProfileActionLabels);
    installProfileData();
    installProfileActionValidation();
    if (currentFile === pages.generating && sessionStorage.getItem('zc:auto-generate') === '1') {
      sessionStorage.removeItem('zc:auto-generate');
      startInitialGeneration();
    }
    document.addEventListener('click', function (event) {
      const target = event.target.closest('button, a, [role="button"]');
      if (!target) return;
      const route = target.dataset.route || routeFor(target);
      if (!route) return;
      saveProfileData();
      if (currentFile === pages.login && target.id === 'submit-cta') {
        event.preventDefault(); event.stopImmediatePropagation();
        target.disabled = true;
        authenticate().then(() => go('profile1')).catch(showApiError).finally(() => { target.disabled = false; });
        return;
      }
      if (currentFile === pages.generating && target.id === 'ctaBtn') {
        event.preventDefault(); event.stopImmediatePropagation();
        startInitialGeneration(target);
        return;
      }
      if (currentFile === pages.feedback && target.id === 'submit-btn') {
        event.preventDefault(); event.stopImmediatePropagation();
      window.handleSubmitFeedback?.();
        return;
      }
      if (currentFile === pages.running && target.id === 'end') {
        event.preventDefault(); event.stopImmediatePropagation(); target.disabled = true;
        completeCurrentWorkout().then(() => go('stretch')).catch(showApiError).finally(() => { target.disabled = false; });
        return;
      }
      if (currentFile === pages.profile6 && route === 'generating') sessionStorage.setItem('zc:auto-generate', '1');
      event.preventDefault();
      event.stopImmediatePropagation();
      if (route === '__back__') {
        if (history.length > 1) history.back();
        else go('login', true);
        return;
      }
      go(route);
    }, true);

    window.zcNavigate = go;
    window.zcPages = pages;
    await Promise.all([
      hydratePlanPage(),
      hydrateOverviewPage(),
      hydrateCompletePage(),
      hydrateComparePage()
    ]);
    primeActiveWorkout();
    revealPage();
  }

  function installWorkoutActionButtons() {
    if (currentFile === pages.warmup) {
      document.querySelectorAll('#btn-action-1, #btn-action-2').forEach((button) => {
        button.classList.remove('w-7', 'h-7');
        button.classList.add('w-6', 'h-6');
      });
      return;
    }
    if (currentFile === pages.feedback) {
      const noteLabel = [...document.querySelectorAll('main span')].find((node) => node.textContent.trim() === '训练感受（选填）');
      if (noteLabel) {
        const dot = noteLabel.querySelector('.w-1\\.5');
        noteLabel.textContent = '';
        if (dot) noteLabel.append(dot);
        noteLabel.append('训练感受');
      }
      const textarea = document.getElementById('comment-box');
      if (textarea) textarea.placeholder = '说说这次跑步的体感、路线路况或补给细节吧...';
      return;
    }
    if (currentFile !== pages.stretch) return;
    document.querySelectorAll('main .bg-secondary-fixed').forEach((action) => {
      action.setAttribute('role', 'button');
      action.setAttribute('tabindex', '0');
      action.setAttribute('aria-pressed', 'false');
      action.className = 'zc-stretch-action w-6 h-6 rounded-full border-2 border-slate-300 bg-transparent text-transparent flex items-center justify-center shrink-0 cursor-pointer transition-all';
      action.innerHTML = '<span class="material-symbols-outlined text-[16px] font-semibold">check</span>';
      const toggle = () => {
        const checked = action.getAttribute('aria-pressed') === 'true';
        action.setAttribute('aria-pressed', String(!checked));
        action.className = checked
          ? 'zc-stretch-action w-6 h-6 rounded-full border-2 border-slate-300 bg-transparent text-transparent flex items-center justify-center shrink-0 cursor-pointer transition-all'
          : 'zc-stretch-action w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shrink-0 cursor-pointer transition-all shadow-sm';
      };
      action.addEventListener('click', toggle);
      action.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
      });
    });
  }

  function installAiAvatar() {
  // 页面位于 pages/，共享资源位于同级 assets/。
  const avatar = '../assets/ai-avatar.png';
    const image = (size) => {
      const img = document.createElement('img');
      img.src = avatar;
      img.alt = '智程 AI';
      img.width = size;
      img.height = size;
      img.className = 'zc-ai-avatar';
      img.style.cssText = `width:${size}px;height:${size}px;display:block;object-fit:contain;`;
      return img;
    };
    const replace = (el, size) => {
      if (!el || el.dataset.aiAvatarReady) return;
      el.dataset.aiAvatarReady = 'true';
      el.innerHTML = '';
      el.appendChild(image(size));
    };
    if (currentFile === pages.login) {
      replace(document.querySelector('.w-20.h-20'), 72);
      return;
    }
    if ([pages.profile1, pages.profile2, pages.profile3, pages.profile4, pages.profile5].includes(currentFile)) {
      document.querySelector('header div.w-9.h-9[class*="bg-gradient"]')?.remove();
      document.querySelectorAll('header *').forEach((node) => {
        if (node.children.length === 0 && /智✦|智程/.test(node.textContent.trim())) node.parentElement?.remove();
      });
    }
    if (currentFile === pages.profile2) {
      document.querySelector('[data-purpose="step-header"] > div')?.remove();
    }
    if (currentFile === pages.profile3) {
      document.querySelector('[data-purpose="header-section"] > div')?.remove();
    }
  }

  function normalizeProfileProgress() {
    const profileSteps = [pages.profile1, pages.profile2, pages.profile3, pages.profile4, pages.profile5];
    const activeStep = profileSteps.indexOf(currentFile) + 1;
    if (!activeStep) return;

    const selectors = {
      [pages.profile1]: 'header > div > div.flex.items-center.gap-1\\.5.flex-1',
      [pages.profile2]: '[data-purpose="step-indicators"]',
      [pages.profile3]: '[data-purpose="progress-bars"]',
      [pages.profile4]: '[data-purpose="stepper-indicator"]',
      [pages.profile5]: 'header > div > div.flex.items-center.gap-1\\.5.flex-1'
    };
    const progress = document.querySelector(selectors[currentFile]);
    if (!progress) return;

    progress.classList.add('zc-profile-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '1');
    progress.setAttribute('aria-valuemax', '5');
    progress.setAttribute('aria-valuenow', String(activeStep));
    progress.setAttribute('aria-label', `建档进度：第 ${activeStep} 页，共 5 页`);
    progress.replaceChildren();
    for (let step = 1; step <= 5; step += 1) {
      const bar = document.createElement('span');
      bar.className = `zc-profile-progress-bar${step <= activeStep ? ' is-active' : ''}`;
      progress.appendChild(bar);
    }
  }

  function normalizeProfileOneAction() {
    if (currentFile !== pages.profile1) return;
    const button = document.getElementById('btn-next-step');
    const action = button?.closest('div.fixed');
    if (!action) return;
    ['fixed', 'bottom-0', 'inset-x-0', 'z-40', 'bg-surface/90', 'backdrop-blur-xl', 'border-t'].forEach((name) => action.classList.remove(name));
    action.classList.add('zc-profile-action');
    action.style.cssText = 'position:fixed;width:min(100vw,428px);max-width:428px;left:50%;right:auto;bottom:0;transform:translateX(-50%);z-index:40;margin:0;padding:12px 20px calc(18px + env(safe-area-inset-bottom));background:transparent;border:0;box-shadow:none;backdrop-filter:none;';
    const inner = action.firstElementChild;
    if (inner) {
      inner.style.maxWidth = '440px';
      inner.style.margin = '0 auto';
      inner.style.padding = '0';
    }
  }

  function normalizeProfileFiveAction() {
    if (currentFile !== pages.profile5) return;
    const button = [...document.querySelectorAll('button')].find((node) => /查看我的跑者档案|继续/.test(textOf(node)));
    const action = button?.parentElement;
    if (!action) return;
    action.classList.add('zc-profile-action-five');
    action.style.cssText = 'position:fixed;width:min(100vw,428px);max-width:428px;left:50%;right:auto;bottom:0;transform:translateX(-50%);z-index:40;margin:0;padding:12px 20px calc(18px + env(safe-area-inset-bottom));background:transparent;border:0;box-shadow:none;backdrop-filter:none;';
    const inner = action.firstElementChild;
    if (inner) {
      inner.style.width = '100%';
      inner.style.maxWidth = 'none';
      inner.style.margin = '0';
      inner.style.padding = '0';
    }
  }

  function normalizeProfileFiveLayout() {
    if (currentFile !== pages.profile5) return;
    const content = document.querySelector('main > div.flex.flex-col');
    if (!content) return;
    content.style.width = '100%';
    content.style.maxWidth = '388px';
    content.style.marginLeft = 'auto';
    content.style.marginRight = 'auto';
    const title = content.firstElementChild;
    const card = content.querySelector('div.bg-surface-container-lowest.rounded-3xl');
    [title, card].forEach((node) => {
      if (!node) return;
      node.style.width = '100%';
      node.style.maxWidth = '388px';
      node.style.marginLeft = '0';
      node.style.marginRight = '0';
    });
  }

  function normalizeProfileActionLabels() {
    if (currentFile === pages.profile4) {
      const card = document.querySelector('[data-purpose="metric-stepper-card"]');
      const display = document.getElementById('targetValueDisplay');
      if (display && display.tagName !== 'INPUT') {
        const input = document.createElement('input');
        input.id = 'targetValueDisplay';
        input.type = 'number';
        input.min = '15';
        input.max = '300';
        input.placeholder = '';
        input.className = `${display.className} w-32 text-center bg-transparent border-0 focus:outline-none focus:ring-0`;
        input.value = '';
        display.replaceWith(input);
        card?.querySelectorAll('div').forEach((node) => {
          if (node.classList.contains('w-48') && node.classList.contains('h-[1.5px]')) node.remove();
        });
        const up = document.getElementById('stepUpBtn');
        const down = document.getElementById('stepDownBtn');
        up?.addEventListener('click', () => { input.value = String((Number(input.value) || 15) + 1); input.dispatchEvent(new Event('input', { bubbles: true })); });
        down?.addEventListener('click', () => { const value = Number(input.value); if (value > 15) { input.value = String(value - 1); input.dispatchEvent(new Event('input', { bubbles: true })); } });
      }
      const button = document.querySelector('[data-purpose="bottom-action"] button');
      const label = button?.querySelector('span');
      if (label) label.textContent = '继续';
      const title = document.querySelector('[data-purpose="title-section"]');
      if (title && !title.querySelector('[data-profile-hint]')) {
        const hint = document.createElement('p');
        hint.dataset.profileHint = 'true';
        hint.className = 'text-sm text-neutral-500 mt-2';
        hint.textContent = '填得越具体，智程越能为你定制训练计划。';
        title.appendChild(hint);
      }
    }
    if (currentFile === pages.profile5) {
      const button = [...document.querySelectorAll('button')].find((node) => /查看我的跑者档案|继续/.test(textOf(node)));
      const label = button?.querySelector('span');
      if (label) label.textContent = '查看我的跑者档案';
    }
  }

  function profileActionButton() {
    if (currentFile === pages.profile1) return document.getElementById('btn-next-step');
    if (currentFile === pages.profile2 || currentFile === pages.profile3) return [...document.querySelectorAll('button')].find((node) => /^继续/.test(textOf(node)));
    if (currentFile === pages.profile4) return document.querySelector('[data-purpose="bottom-action"] button');
    if (currentFile === pages.profile5) return [...document.querySelectorAll('button')].find((node) => /查看我的跑者档案/.test(textOf(node)));
    return null;
  }

  function profileActionReady() {
    const data = readProfile();
    if (currentFile === pages.profile1) return ['heightInput', 'weightInput'].every((id) => document.getElementById(id)?.dataset.userEdited === 'true');
    if (currentFile === pages.profile2) return Boolean(document.querySelector('#optionsContainer [aria-checked="true"]'));
    if (currentFile === pages.profile3) return ['longest-run', 'train-days'].every((id) => document.getElementById(id)?.dataset.userEdited === 'true') && Number(document.getElementById('train-days')?.value || 0) >= 3;
    if (currentFile === pages.profile4) return Boolean(document.getElementById('targetValueDisplay')?.value?.trim()) || document.querySelector('[data-purpose="target-setting-view"]')?.dataset.userEdited === 'true';
    if (currentFile === pages.profile5) return document.querySelectorAll('.health-item.selected-active').length > 0;
    return true;
  }

  function updateProfileActionState() {
    const button = profileActionButton();
    if (!button) return;
    const enabled = profileActionReady();
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', String(!enabled));
    button.style.opacity = enabled ? '1' : '0.45';
    button.style.filter = enabled ? 'none' : 'grayscale(0.7)';
    button.style.cursor = enabled ? 'pointer' : 'not-allowed';
  }

  function installProfileActionValidation() {
    if (![pages.profile1, pages.profile2, pages.profile3, pages.profile4, pages.profile5].includes(currentFile)) return;
    document.addEventListener('input', (event) => {
      if (event.target.matches('#heightInput, #weightInput, #longest-run, #latest-10k, #train-days, #targetValueDisplay')) event.target.dataset.userEdited = 'true';
      updateProfileActionState();
    });
    document.addEventListener('change', (event) => {
      if (event.target.matches('#heightInput, #weightInput, #longest-run, #latest-10k, #train-days, #targetValueDisplay')) event.target.dataset.userEdited = 'true';
      updateProfileActionState();
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('#heightRange, #weightRange, #stepUpBtn, #stepDownBtn, .health-item, #cardio-permit, #optionsContainer [role="radio"]')) {
        if (currentFile === pages.profile4) document.querySelector('[data-purpose="target-setting-view"]')?.setAttribute('data-user-edited', 'true');
        setTimeout(updateProfileActionState, 0);
      }
    });
    updateProfileActionState();
  }

  const profileKey = 'zc:runner-profile';
  function readProfile() {
    try { return JSON.parse(localStorage.getItem(profileKey) || '{}'); } catch { return {}; }
  }
  function saveProfileData() {
    const data = readProfile();
    delete data.weeklyRuns;
    const value = (id) => document.getElementById(id)?.value;
    if (currentFile === pages.profile1) {
      data.height = value('heightInput') || data.height;
      data.weight = value('weightInput') || data.weight;
    } else if (currentFile === pages.profile2) {
      data.goal = document.querySelector('#optionsContainer [aria-checked="true"] h3')?.textContent.trim() || data.goal;
    } else if (currentFile === pages.profile3) {
      data.longestRun = value('longest-run');
      data.latest10k = value('latest-10k');
      data.trainDays = value('train-days');
    } else if (currentFile === pages.profile4) {
      const targetDisplay = document.getElementById('targetValueDisplay');
      data.targetMinutes = targetDisplay?.value?.trim() || targetDisplay?.textContent.trim();
    } else if (currentFile === pages.profile5) {
      data.health = [...document.querySelectorAll('.health-item.selected-active .item-title')].map((el) => el.textContent.trim());
      data.cardioPermit = Boolean(document.getElementById('cardio-permit')?.checked);
    } else return;
    localStorage.setItem(profileKey, JSON.stringify(data));
    if (localStorage.getItem(tokenKey)) syncProfile().catch(() => {});
  }
  function installProfileData() {
    const data = readProfile();
    const set = (id, value) => { if (value != null && document.getElementById(id)) document.getElementById(id).value = value; };
    if (currentFile === pages.profile6) {
      const card = document.querySelector('[data-purpose="metrics-summary"]');
      if (!card) return;
      const rows = [...card.children];
      const entries = [
        [`${data.height || 175} cm · ${data.weight || 65} kg`, 'profile1'],
        [data.goal || '完成 10 公里', 'profile2'],
        [
          `最长连续跑 ${data.longestRun || '—'} km`,
          `每周可训练 ${data.trainDays || '—'} 天`
        ],
        [`${data.targetMinutes || 55} 分钟`, 'profile4'],
        [data.health?.join('、') || '近期无明显伤痛', 'profile5']
      ];
      const labels = ['身体数据', '训练目标', '跑步基础', '目标成绩', '身体状态'];
      rows.slice(0, 5).forEach((row, index) => {
        row.replaceChildren();
        row.className = `flex ${index === 2 ? 'items-start' : 'items-center'} justify-between ${index === 4 ? 'pt-3.5' : 'py-3.5 border-b border-slate-100'} text-sm`;
        const label = document.createElement('span');
        label.className = 'text-[14.5px] text-slate-500 font-normal';
        label.textContent = labels[index];
        const right = document.createElement('div');
        right.className = `flex ${index === 2 ? 'items-start' : 'items-center'} gap-2`;
        const value = document.createElement('span');
        value.className = 'text-[15px] font-semibold text-slate-900 font-num tracking-tight';
        if (index === 2) {
          const valueLines = document.createElement('span');
          valueLines.className = 'flex flex-col items-end gap-0.5 text-right leading-snug';
          entries[index].forEach((line) => {
            const lineNode = document.createElement('span');
            lineNode.textContent = line;
            valueLines.appendChild(lineNode);
          });
          value.replaceChildren(valueLines);
        } else {
          value.textContent = entries[index][0];
        }
        const check = document.createElement('span');
        check.className = 'text-[18px] text-slate-400';
        check.textContent = '✓';
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'zc-profile-edit';
        edit.textContent = '修改'; edit.dataset.route = index === 2 ? 'profile3' : entries[index][1];
        edit.setAttribute('aria-label', `修改${labels[index]}`);
        right.append(value, check, edit);
        row.append(label, right);
      });
    }
    if ([pages.profile1, pages.profile2, pages.profile3, pages.profile4, pages.profile5].includes(currentFile)) {
      document.addEventListener('input', saveProfileData);
      document.addEventListener('change', saveProfileData);
      document.addEventListener('click', (event) => { if (event.target.closest('.health-item,[role="radio"],#stepUpBtn,#stepDownBtn')) setTimeout(saveProfileData, 0); });
    }
  }

  function restoreGenerationAvatarLabel() {
    if (currentFile !== pages.generating) return;
    const label = [...document.querySelectorAll('span')].find((node) => /智程\s*AI/.test(node.textContent || ''));
    if (!label) return;
    label.textContent = '智程 AI';
    label.style.setProperty('color', '#ffffff', 'important');
  }

  window.handleSubmitFeedback = async function () {
    const btn = document.getElementById('submit-btn');
    if (!btn || btn.disabled) return;
    const selected = (id) => document.querySelectorAll(`#stars-${id} button.is-active`).length;
    const scores = ['subjective', 'physical', 'pain'].map(selected);
    if (scores.some((score) => score < 1)) { window.alert('请完成训练感受、身体状态和疼痛程度三项评分'); return; }
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span><span>正在分析并调配计划...</span>';
    const discomfort = document.getElementById('btn-discomfort-yes')?.className.includes('amber') || false;
    const parts = [...document.querySelectorAll('.part-chip.bg-primary')].map((el) => el.textContent.trim());
    let completed = null;
    try {
      const lastWorkout = JSON.parse(sessionStorage.getItem('zc:last-workout') || '{}');
      const rawCompleted = lastWorkout.completed || null;
      if (rawCompleted) completed = { workoutId: lastWorkout.id, distanceKm: rawCompleted.distanceKm, durationMin: rawCompleted.durationMin, pace: rawCompleted.pace };
    } catch { completed = null; }
    const data = { subjective: scores[0], physical: scores[1], pain: scores[2], discomfort, discomfortParts: parts, note: document.getElementById('comment-box')?.value || '', workoutId: completed?.workoutId || '', completed: completed ? { distanceKm: completed.distanceKm, durationMin: completed.durationMin, pace: completed.pace } : null };
    try { const result = await api('/feedback', { method: 'POST', body: JSON.stringify(data) }); sessionStorage.setItem('zc:last-adjustment', JSON.stringify(result)); go('adjust'); }
    catch (error) { showApiError(error); btn.innerHTML = original; btn.disabled = false; }
  };

  const boot = () => install().catch((error) => { console.error('navigation init failed', error); revealPage(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
