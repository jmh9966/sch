
const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

const els = {
  clock: document.getElementById('clock'),
  modal: document.getElementById('modal'),
  formTitle: document.getElementById('form-title'),
  form: document.getElementById('job-form'),
  id: document.getElementById('job-id'),
  name: document.getElementById('name'),
  command: document.getElementById('command'),
  cwd: document.getElementById('cwd'),
  timeoutMs: document.getElementById('timeoutMs'),
  enabled: document.getElementById('enabled'),
  enabledLabel: document.getElementById('enabled-label'),
  visualBox: document.getElementById('visual-box'),
  cronBox: document.getElementById('cron-box'),
  visualType: document.getElementById('visual-type'),
  hour: document.getElementById('visual-hour'),
  minute: document.getElementById('visual-minute'),
  interval: document.getElementById('visual-interval'),
  day: document.getElementById('visual-day'),
  weekdays: document.getElementById('weekdays'),
  cron: document.getElementById('cron'),
  cronPreview: document.getElementById('cron-preview'),
  nextRuns: document.getElementById('next-runs'),
  jobsBody: document.getElementById('jobs-body'),
  runs: document.getElementById('runs'),
  loginScreen: document.getElementById('login-screen'),
  loginForm: document.getElementById('login-form'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  logoutBtn: document.getElementById('logout-btn'),
};

let scheduleMode = 'visual';
let previewTimer = 0;
let authenticated = false;
let clockTimer = 0;
let loadTimer = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function weekdayChecks() {
  return [...els.weekdays.querySelectorAll('input:checked')].map((el) => Number(el.value));
}

function visualPayload() {
  return {
    type: els.visualType.value,
    hour: Number(els.hour.value),
    minute: Number(els.minute.value),
    interval: Number(els.interval.value),
    day: Number(els.day.value),
    weekdays: weekdayChecks(),
  };
}

function payload() {
  return {
    name: els.name.value.trim(),
    command: els.command.value.trim(),
    cwd: els.cwd.value.trim(),
    timeoutMs: Number(els.timeoutMs.value),
    enabled: els.enabled.checked,
    scheduleMode,
    visual: visualPayload(),
    cron: els.cron.value.trim(),
  };
}

function showLogin(message) {
  authenticated = false;
  document.body.classList.add('locked');
  els.loginError.textContent = message || '';
  els.loginPassword.value = '';
  els.loginPassword.focus();
  stopPolling();
}

function showApp() {
  authenticated = true;
  document.body.classList.remove('locked');
  els.loginError.textContent = '';
}

function startPolling() {
  stopPolling();
  clockTimer = setInterval(tickClock, 1000);
  loadTimer = setInterval(loadAll, 8000);
}

function stopPolling() {
  clearInterval(clockTimer);
  clearInterval(loadTimer);
}

async function api(url, options) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
  } catch (error) {
    throw new Error(error.message || '网络异常');
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = {};
    }
  }
  if (res.status === 401 && url !== '/api/login' && url !== '/api/session') {
    showLogin(data.error || '请先登录');
    throw new Error(data.error || '未登录');
  }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function renderNextRuns(runs) {
  els.nextRuns.innerHTML = (runs || []).map((item) => `<li>${escapeHtml(item.text)}</li>`).join('') || '<li>暂无预览</li>';
}

async function refreshPreview() {
  try {
    const data = await api('/api/preview', { method: 'POST', body: JSON.stringify(payload()) });
    if (scheduleMode === 'visual') els.cron.value = data.cron;
    els.cronPreview.textContent = data.cron;
    renderNextRuns(data.nextRuns);
  } catch (error) {
    els.cronPreview.textContent = error.message;
    els.nextRuns.innerHTML = `<li>${escapeHtml(error.message)}</li>`;
  }
}

function queuePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 120);
}

function setMode(mode) {
  scheduleMode = mode;
  document.querySelectorAll('.mode').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  els.visualBox.classList.toggle('hidden', mode !== 'visual');
  els.cronBox.classList.toggle('hidden', mode !== 'cron');
  queuePreview();
}

function fillForm(job) {
  els.id.value = job ? job.id : '';
  els.formTitle.textContent = job ? `编辑任务：${job.name}` : '新建任务';
  els.enabledLabel.textContent = job ? '启用该任务' : '创建后立即启用';
  els.name.value = job ? job.name : '';
  els.command.value = job ? job.command : '';
  els.cwd.value = job ? job.cwd || '' : '';
  els.timeoutMs.value = job ? job.timeoutMs : 120000;
  els.enabled.checked = job ? job.enabled : true;
  const visual = job && job.visual ? job.visual : { type: 'daily', hour: 9, minute: 0, interval: 5, day: 1, weekdays: [1] };
  els.visualType.value = visual.type || 'daily';
  els.hour.value = visual.hour ?? 9;
  els.minute.value = visual.minute ?? 0;
  els.interval.value = visual.interval ?? 5;
  els.day.value = visual.day ?? 1;
  els.cron.value = job ? job.cron : '0 9 * * *';
  els.weekdays.querySelectorAll('input').forEach((input) => {
    input.checked = (visual.weekdays || [1]).includes(Number(input.value));
  });
  setMode(job ? job.scheduleMode : 'visual');
}

function openModal(job) {
  fillForm(job || null);
  els.modal.classList.remove('hidden');
  els.modal.setAttribute('aria-hidden', 'false');
  els.name.focus();
}

function closeModal() {
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
  fillForm(null);
}

function statusBadge(job) {
  if (job.running) return '<span class="badge on">执行中</span>';
  return job.enabled ? '<span class="badge on">已启用</span>' : '<span class="badge off">已停用</span>';
}

function renderJobs(jobs) {
  if (!jobs.length) {
    els.jobsBody.innerHTML = '<tr><td colspan="8" class="empty">还没有任务</td></tr>';
    return;
  }
  els.jobsBody.innerHTML = jobs.map((job) => `
    <tr>
      <td class="cell-name">${escapeHtml(job.name)}</td>
      <td class="cell-cmd" title="${escapeHtml(job.command)}">${escapeHtml(job.command)}</td>
      <td class="cell-cron"><code title="${escapeHtml(job.cron)}">${escapeHtml(job.cron)}</code></td>
      <td>${statusBadge(job)}</td>
      <td>${escapeHtml((job.nextRuns[0] && job.nextRuns[0].text) || '-')}</td>
      <td>${escapeHtml(job.lastRunAtText || '尚未执行')} ${escapeHtml(job.lastStatus || '')}</td>
      <td><button class="edit-btn" data-edit="${escapeHtml(job.id)}">编辑</button></td>
      <td>
        <div class="row-actions">
          <button data-toggle="${escapeHtml(job.id)}">${job.enabled ? '停用' : '启用'}</button>
          <button data-run="${escapeHtml(job.id)}">立即运行</button>
          <button data-delete="${escapeHtml(job.id)}">删除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderRuns(runs) {
  els.runs.innerHTML = runs.map((run) => `
    <article class="run">
      <div class="run-head">
        <strong>${escapeHtml(run.jobName)}</strong>
        <span class="badge ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
      </div>
      <div class="meta">${escapeHtml(run.startedAtText)} · ${escapeHtml(run.trigger)} · exit ${escapeHtml(run.exitCode ?? '-')}</div>
      <pre>${escapeHtml(run.output || '(无输出)')}</pre>
    </article>
  `).join('') || '<p class="meta">暂无运行记录</p>';
}

async function loadAll() {
  const [jobs, runs] = await Promise.all([api('/api/jobs'), api('/api/runs')]);
  renderJobs(jobs.jobs);
  renderRuns(runs.runs);
}

async function tickClock() {
  try {
    const meta = await api('/api/meta');
    els.clock.textContent = meta.nowText;
  } catch (_error) {
    els.clock.textContent = '时钟同步失败';
  }
}

els.weekdays.innerHTML = WEEKDAYS.map((day) => `
  <label><input type="checkbox" value="${day.value}" ${day.value === 1 ? 'checked' : ''}> ${day.label}</label>
`).join('');

document.querySelectorAll('.mode').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

['visual-type', 'visual-hour', 'visual-minute', 'visual-interval', 'visual-day', 'cron'].forEach((id) => {
  document.getElementById(id).addEventListener('input', queuePreview);
});
els.weekdays.addEventListener('change', queuePreview);

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = payload();
  const id = els.id.value;
  await api(id ? `/api/jobs/${id}` : '/api/jobs', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
  closeModal();
  await loadAll();
});

document.getElementById('create-btn').addEventListener('click', () => openModal(null));
document.getElementById('refresh-btn').addEventListener('click', loadAll);
document.querySelectorAll('[data-close-modal]').forEach((el) => {
  el.addEventListener('click', closeModal);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal();
});

els.jobsBody.addEventListener('click', async (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  try {
    if (btn.dataset.edit) {
      const data = await api(`/api/jobs/${btn.dataset.edit}`);
      openModal(data.job);
    } else if (btn.dataset.toggle) {
      await api(`/api/jobs/${btn.dataset.toggle}/toggle`, { method: 'POST' });
      await loadAll();
    } else if (btn.dataset.run) {
      btn.disabled = true;
      await api(`/api/jobs/${btn.dataset.run}/run`, { method: 'POST' });
      await loadAll();
    } else if (btn.dataset.delete) {
      if (window.confirm('确认删除该任务？')) {
        await api(`/api/jobs/${btn.dataset.delete}`, { method: 'DELETE' });
        await loadAll();
      }
    }
  } finally {
    btn.disabled = false;
  }
});

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.loginError.textContent = '';
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: els.loginPassword.value }),
    });
    showApp();
    await Promise.all([tickClock(), loadAll()]);
    startPolling();
  } catch (error) {
    els.loginError.textContent = error.message || '登录失败';
  }
});

els.logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_error) {
    // ignore
  }
  showLogin('');
});

async function boot() {
  fillForm(null);
  try {
    const session = await api('/api/session');
    if (!session.authenticated) {
      showLogin('');
      return;
    }
    showApp();
    await Promise.all([tickClock(), loadAll()]);
    startPolling();
  } catch (_error) {
    showLogin('请先登录');
  }
}

boot();
