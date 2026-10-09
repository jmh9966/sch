const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');
const MAX_RUNS = 300;

let jobs = [];
let runs = [];

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

async function init() {
  await ensureDir();
  const jobData = await readJson(JOBS_FILE, { jobs: [] });
  const runData = await readJson(RUNS_FILE, { runs: [] });
  jobs = Array.isArray(jobData.jobs) ? jobData.jobs : [];
  runs = Array.isArray(runData.runs) ? runData.runs : [];
}

function listJobs() {
  return jobs.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getJob(id) {
  return jobs.find((job) => job.id === id) || null;
}

async function saveJobs() {
  await writeJson(JOBS_FILE, { jobs });
}

async function saveRuns() {
  await writeJson(RUNS_FILE, { runs });
}

async function upsertJob(job) {
  const index = jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) jobs[index] = job;
  else jobs.push(job);
  await saveJobs();
  return job;
}

async function deleteJob(id) {
  const before = jobs.length;
  jobs = jobs.filter((job) => job.id !== id);
  if (jobs.length === before) return false;
  await saveJobs();
  return true;
}

async function addRun(record) {
  runs.unshift(record);
  if (runs.length > MAX_RUNS) runs = runs.slice(0, MAX_RUNS);
  await saveRuns();
  return record;
}

function listRuns(jobId, limit = 50) {
  const filtered = jobId ? runs.filter((item) => item.jobId === jobId) : runs;
  return filtered.slice(0, limit);
}

module.exports = {
  init,
  listJobs,
  getJob,
  upsertJob,
  deleteJob,
  addRun,
  listRuns,
};
