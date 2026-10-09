const crypto = require('crypto');

const COOKIE_NAME = 'cron_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();

function getPassword() {
  return String(process.env.ADMIN_PASSWORD || process.env.PANEL_PASSWORD || 'admin');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function cookieOptions(req, maxAge) {
  const parts = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function setSessionCookie(res, req, token) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions(req, Math.floor(SESSION_TTL_MS / 1000))}`);
}

function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieOptions(req, 0)}`);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function isValidSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || '';
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function tooManyAttempts(req) {
  const key = clientKey(req);
  const now = Date.now();
  const item = attempts.get(key);
  if (!item || item.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + 5 * 60 * 1000 });
    return false;
  }
  return item.count >= 8;
}

function recordAttempt(req, success) {
  const key = clientKey(req);
  if (success) {
    attempts.delete(key);
    return;
  }
  const now = Date.now();
  const item = attempts.get(key) || { count: 0, resetAt: now + 5 * 60 * 1000 };
  item.count += 1;
  attempts.set(key, item);
}

function requireAuth(req, res, next) {
  if (isValidSession(getSessionToken(req))) {
    next();
    return;
  }
  res.status(401).json({ error: '未登录', code: 'UNAUTHENTICATED' });
}

function login(req) {
  if (tooManyAttempts(req)) {
    const error = new Error('尝试次数过多，请稍后再试');
    error.status = 429;
    throw error;
  }
  const password = String((req.body && req.body.password) || '');
  if (!password || !safeEqual(password, getPassword())) {
    recordAttempt(req, false);
    const error = new Error('密码错误');
    error.status = 401;
    throw error;
  }
  recordAttempt(req, true);
  return createSession();
}

module.exports = {
  COOKIE_NAME,
  getPassword,
  getSessionToken,
  isValidSession,
  requireAuth,
  login,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
};
