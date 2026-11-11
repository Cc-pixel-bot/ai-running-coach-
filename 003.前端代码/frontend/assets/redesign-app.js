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

  // Login/register. Authentication is a front-end prototype until a backend exists.
  if (page === 'login') {
    const tabs = [...document.querySelectorAll('.auth-tabs span')];
    const card = document.querySelector('.auth-card');
    const button = card?.querySelector('.primary-button');
    const confirmField = document.getElementById('confirm-field');
    const confirmInput = document.getElementById('confirm-password-input');
    let mode = 'login';
    const submit = () => {
      const username = value('account-input'); const pass = value('password-input');
      const input = document.getElementById('account-input');
      if (!/^[A-Za-z0-9]+$/.test(username)) { input.setCustomValidity('账号只能使用英文字母和数字'); input.reportValidity(); input.setCustomValidity(''); return; }
      if (pass.length < 6) { const pw = document.getElementById('password-input'); pw.setCustomValidity('密码至少需要 6 位'); pw.reportValidity(); pw.setCustomValidity(''); return; }
      if (mode === 'register' && pass !== value('confirm-password-input')) { confirmInput.setCustomValidity('两次输入的密码不一致'); confirmInput.reportValidity(); confirmInput.setCustomValidity(''); return; }
      write(authKey, { username }); go(2);
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
      if (!p.goal || !p.height || !p.weight || !p['longest-run'] || !p.latest10k && !p['latest-10k'] || !p['train-days'] || !p.targetMinutes || !p.health?.length) { notify('请先完成所有建档信息。'); return; }
      go(8);
    });
  }

  // Plan pages.
  if (page === 'plan-generation' || page === 'plan-adjust') {
    let step = 0;
    const cta = document.getElementById('ctaBtn');
    const steps = [...document.querySelectorAll('main h4')];
    const timer = window.setInterval(() => {
      step = Math.min(step + 1, 4);
      steps.forEach((heading, index) => {
        const box = heading.closest('.flex.items-start');
        const status = box?.querySelector('span[class*="text-[10px]"]');
        if (status) status.textContent = index < step ? '已完成' : index === step ? '进行中' : '等待中';
        const icon = box?.querySelector('.w-6.h-6');
        if (icon && index < step) { icon.textContent = '✓'; icon.classList.add('bg-emerald-500/20'); }
      });
      if (step >= 4) {
        window.clearInterval(timer);
        if (cta) { cta.disabled = false; const label = cta.querySelector('span:last-child'); if (label) label.textContent = page === 'plan-adjust' ? '查看调整结果' : '查看训练计划'; const spinner = cta.querySelector('.animate-spin'); if (spinner) spinner.textContent = '✓'; }
      }
    }, 650);
    cta?.addEventListener('click', () => { if (step < 4) return; go(page === 'plan-adjust' ? 18 : 9); });
  }
  if (page === 'plan-home') {
    const p = profile();
    const distance = document.querySelector('.today-metrics .metric strong');
    const time = document.querySelectorAll('.today-metrics .metric strong')[2];
    if (distance && p['longest-run']) distance.innerHTML = `${p['longest-run']} <small>km</small>`;
    if (time && p['latest-10k']) time.innerHTML = `${Math.round(Number(p['latest-10k']) * .58)} <small>分</small>`;
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
  if (page === 'training') document.querySelector('.primary-button')?.setAttribute('data-route', '12');
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
      save(); go(14);
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
    const run = state.run || { distance: 6, seconds: 2160 };
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
      feedback.comment = comment?.value || ''; feedback.location = locationInput?.value || ''; state.feedback = feedback; save(); go(17);
    });
  }
  if (page === 'plan-changes') {
    document.querySelectorAll('button').forEach((button) => { if (button.textContent.includes('返回计划')) button.dataset.route = '9'; });
    const headerBack = document.querySelector('header button'); if (headerBack) headerBack.dataset.route = '9';
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
    if (target.dataset.action === 'logout') { sessionStorage.removeItem(stateKey); sessionStorage.removeItem(authKey); go(1); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-route], [data-action]');
    if (target && target.tagName !== 'BUTTON' && target.tagName !== 'A') { event.preventDefault(); target.click(); }
  });
})();
