require('./load-env');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const scheduler = require('./scheduler');
const auth = require('./auth');
const {
  TIMEZONE,
  TIMEZONE_LABEL,
  formatBeijing,
  nowISO,
  resolveSchedule,
  nextRuns,
  visualToCron,
  validateCron,
} = require('./cron-utils');

process.env.TZ = TIMEZONE;

const app = express();
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const HOST = '0.0.0.0';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/session', (req, res) => {
  res.json({ authenticated: auth.isValidSession(auth.getSessionToken(req)) });
});

app.post('/api/login', (req, res) => {
  try {
    const token = auth.login(req);
    auth.setSessionCookie(res, req, token);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(auth.getSessionToken(req));
  auth.clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.use('/api', auth.requireAuth);

function jobView(job) {
  return {
    ...job,
    nextRuns: nextRuns(job.cron, 5),
    running: scheduler.runningIds().includes(job.id),
  };
}

app.get('/api/meta', (_req, res) => {
  res.json({
    timezone: TIMEZONE,
    timezoneLabel: TIMEZONE_LABEL,
    now: nowISO(),
    nowText: formatBeijing(new Date()),
    port: PORT,
  });
});

app.post('/api/preview', (req, res) => {
  try {
    const schedule = resolveSchedule(req.body || {});
    res.json({
      ...schedule,
      nextRuns: nextRuns(schedule.cron, 5),
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.post('/api/visual-to-cron', (req, res) => {
  try {
    const cronExpr = visualToCron(req.body || {});
    const checked = validateCron(cronExpr);
    if (!checked.valid) {
      res.status(400).json({ error: checked.message });
      return;
    }
    res.json({
      cron: checked.expression,
      nextRuns: nextRuns(checked.expression, 5),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: store.listJobs().map(jobView) });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  res.json({ job: jobView(job) });
});

app.post('/api/jobs', async (req, res) => {
  try {
    const body = req.body || {};
    if (!String(body.name || '').trim()) {
      res.status(400).json({ error: '任务名称不能为空' });
      return;
    }
    if (!String(body.command || '').trim()) {
      res.status(400).json({ error: '执行命令不能为空' });
      return;
    }
    const schedule = resolveSchedule(body);
    const now = nowISO();
    const job = {
      id: crypto.randomUUID(),
      name: String(body.name).trim(),
      command: String(body.command).trim(),
      cwd: String(body.cwd || '').trim(),
      enabled: body.enabled !== false,
      timeoutMs: Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 120000,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunAtText: null,
      lastStatus: null,
      runCount: 0,
      ...schedule,
    };
    await store.upsertJob(job);
    scheduler.syncJob(job);
    res.status(201).json({ job: jobView(job) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const current = store.getJob(req.params.id);
    if (!current) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    const body = req.body || {};
    const schedule = resolveSchedule({
      scheduleMode: body.scheduleMode || current.scheduleMode,
      visual: body.visual || current.visual,
      cron: body.cron || current.cron,
    });
    const job = {
      ...current,
      name: String(body.name || current.name).trim(),
      command: String(body.command || current.command).trim(),
      cwd: body.cwd !== undefined ? String(body.cwd).trim() : current.cwd,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : current.enabled,
      timeoutMs: Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : current.timeoutMs,
      updatedAt: nowISO(),
      ...schedule,
    };
    if (!job.name || !job.command) {
      res.status(400).json({ error: '任务名称和执行命令不能为空' });
      return;
    }
    await store.upsertJob(job);
    scheduler.syncJob(job);
    res.json({ job: jobView(job) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/jobs/:id/toggle', async (req, res) => {
  const current = store.getJob(req.params.id);
  if (!current) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  current.enabled = !current.enabled;
  current.updatedAt = nowISO();
  await store.upsertJob(current);
  scheduler.syncJob(current);
  res.json({ job: jobView(current) });
});

app.post('/api/jobs/:id/run', async (req, res) => {
  const current = store.getJob(req.params.id);
  if (!current) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  await scheduler.runNow(current);
  const latest = store.getJob(current.id);
  res.json({ job: jobView(latest) });
});

app.delete('/api/jobs/:id', async (req, res) => {
  const ok = await store.deleteJob(req.params.id);
  if (!ok) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  scheduler.removeJob(req.params.id);
  res.json({ ok: true });
});

app.get('/api/runs', (req, res) => {
  res.json({ runs: store.listRuns(req.query.jobId, Number(req.query.limit) || 50) });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || '服务器错误' });
});

async function main() {
  await store.init();
  scheduler.reloadAll();
  app.listen(PORT, HOST, () => {
    console.log(`Cron Task Manager listening on ${HOST}:${PORT}`);
    console.log(`Timezone: ${TIMEZONE} (${TIMEZONE_LABEL}) ${formatBeijing(new Date())}`);
    if (auth.getPassword() === 'admin') {
      console.log('Login password is the default value. Set ADMIN_PASSWORD before production use.');
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
