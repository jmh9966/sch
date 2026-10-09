const { exec } = require('child_process');
const path = require('path');
const cron = require('node-cron');
const store = require('./store');
const { TIMEZONE, nowISO, formatBeijing } = require('./cron-utils');

const tasks = new Map();
const running = new Set();

function stopTask(id) {
  const task = tasks.get(id);
  if (task) {
    task.stop();
    tasks.delete(id);
  }
}

function truncate(text, max = 8000) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated]`;
}

async function executeJob(job, trigger) {
  if (running.has(job.id)) {
    await store.addRun({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      jobId: job.id,
      jobName: job.name,
      trigger,
      status: 'skipped',
      startedAt: nowISO(),
      startedAtText: formatBeijing(new Date()),
      finishedAt: nowISO(),
      finishedAtText: formatBeijing(new Date()),
      exitCode: null,
      output: '任务仍在执行，已跳过本次触发',
    });
    return;
  }

  running.add(job.id);
  const started = new Date();
  const cwd = job.cwd && String(job.cwd).trim()
    ? path.resolve(process.cwd(), job.cwd)
    : process.cwd();
  const timeoutMs = Number(job.timeoutMs) > 0 ? Number(job.timeoutMs) : 120000;

  return new Promise((resolve) => {
    exec(job.command, { cwd, timeout: timeoutMs, env: process.env, maxBuffer: 1024 * 1024 }, async (error, stdout, stderr) => {
      const finished = new Date();
      const output = truncate(`${stdout || ''}${stderr ? `\n${stderr}` : ''}${error && !stderr ? `\n${error.message}` : ''}`);
      const status = error ? 'failed' : 'success';
      const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;

      await store.addRun({
        id: `${finished.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
        jobId: job.id,
        jobName: job.name,
        trigger,
        status,
        startedAt: started.toISOString(),
        startedAtText: formatBeijing(started),
        finishedAt: finished.toISOString(),
        finishedAtText: formatBeijing(finished),
        exitCode,
        output,
      });

      const latest = store.getJob(job.id);
      if (latest) {
        latest.lastRunAt = finished.toISOString();
        latest.lastRunAtText = formatBeijing(finished);
        latest.lastStatus = status;
        latest.runCount = Number(latest.runCount || 0) + 1;
        latest.updatedAt = nowISO();
        await store.upsertJob(latest);
      }

      running.delete(job.id);
      resolve();
    });
  });
}

function startJob(job) {
  stopTask(job.id);
  if (!job.enabled) return;
  const task = cron.schedule(job.cron, () => {
    executeJob(job, 'schedule').catch((error) => {
      console.error(`[scheduler] job ${job.id} failed:`, error.message);
    });
  }, {
    scheduled: true,
    timezone: TIMEZONE,
  });
  tasks.set(job.id, task);
}

function reloadAll() {
  for (const id of tasks.keys()) stopTask(id);
  for (const job of store.listJobs()) startJob(job);
}

function syncJob(job) {
  startJob(job);
}

function removeJob(id) {
  stopTask(id);
}

function runNow(job) {
  return executeJob(job, 'manual');
}

function runningIds() {
  return [...running];
}

module.exports = {
  reloadAll,
  syncJob,
  removeJob,
  runNow,
  runningIds,
};
