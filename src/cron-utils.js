const cron = require('node-cron');
const cronParser = require('cron-parser');

const TIMEZONE = 'Asia/Shanghai';
const TIMEZONE_LABEL = '北京时间';

const VISUAL_TYPES = [
  'every_minute',
  'interval_minute',
  'hourly',
  'interval_hour',
  'daily',
  'weekly',
  'monthly',
];

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function uniqueSorted(list, min, max) {
  const set = new Set();
  for (const item of list || []) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= min && n <= max) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function visualToCron(visual = {}) {
  const type = visual.type;
  if (!VISUAL_TYPES.includes(type)) {
    throw new Error('不支持的可视化调度类型');
  }

  const minute = clamp(visual.minute, 0, 59, 0);
  const hour = clamp(visual.hour, 0, 23, 0);
  const day = clamp(visual.day, 1, 31, 1);
  const interval = clamp(visual.interval, 1, 59, 1);
  const hourInterval = clamp(visual.interval, 1, 23, 1);
  const weekdays = uniqueSorted(visual.weekdays, 0, 6);

  switch (type) {
    case 'every_minute':
      return '* * * * *';
    case 'interval_minute':
      return `*/${interval} * * * *`;
    case 'hourly':
      return `${minute} * * * *`;
    case 'interval_hour':
      return `${minute} */${hourInterval} * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${weekdays.length ? weekdays.join(',') : '1'}`;
    case 'monthly':
      return `${minute} ${hour} ${day} * *`;
    default:
      throw new Error('不支持的可视化调度类型');
  }
}

function parseFieldList(field) {
  if (field === '*') return null;
  return field.split(',').map((part) => Number(part));
}

function cronToVisual(expression) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) {
    return { type: 'daily', minute: 0, hour: 0, day: 1, interval: 1, weekdays: [1] };
  }

  const [minute, hour, day, month, weekday] = parts;

  if (minute === '*' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return { type: 'every_minute', minute: 0, hour: 0, day: 1, interval: 1, weekdays: [1] };
  }

  const minuteStep = minute.match(/^\*\/(\d+)$/);
  if (minuteStep && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return { type: 'interval_minute', minute: 0, hour: 0, day: 1, interval: Number(minuteStep[1]), weekdays: [1] };
  }

  if (/^\d+$/.test(minute) && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return { type: 'hourly', minute: Number(minute), hour: 0, day: 1, interval: 1, weekdays: [1] };
  }

  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (/^\d+$/.test(minute) && hourStep && day === '*' && month === '*' && weekday === '*') {
    return { type: 'interval_hour', minute: Number(minute), hour: 0, day: 1, interval: Number(hourStep[1]), weekdays: [1] };
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*' && weekday === '*') {
    return { type: 'daily', minute: Number(minute), hour: Number(hour), day: 1, interval: 1, weekdays: [1] };
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*' && weekday !== '*') {
    const weekdays = uniqueSorted(parseFieldList(weekday) || [1], 0, 6);
    return { type: 'weekly', minute: Number(minute), hour: Number(hour), day: 1, interval: 1, weekdays: weekdays.length ? weekdays : [1] };
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(day) && month === '*' && weekday === '*') {
    return { type: 'monthly', minute: Number(minute), hour: Number(hour), day: Number(day), interval: 1, weekdays: [1] };
  }

  return {
    type: 'daily',
    minute: /^\d+$/.test(minute) ? Number(minute) : 0,
    hour: /^\d+$/.test(hour) ? Number(hour) : 0,
    day: /^\d+$/.test(day) ? Number(day) : 1,
    interval: 1,
    weekdays: [1],
  };
}

function validateCron(expression) {
  const value = String(expression || '').trim();
  if (!value) return { valid: false, message: 'Cron 表达式不能为空' };
  const fields = value.split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    return { valid: false, message: 'Cron 表达式必须是 5 段或 6 段' };
  }
  if (!cron.validate(value)) {
    return { valid: false, message: 'Cron 表达式不合法' };
  }
  try {
    cronParser.parseExpression(value, { tz: TIMEZONE });
  } catch (error) {
    return { valid: false, message: error.message || 'Cron 表达式无法解析' };
  }
  return { valid: true, expression: value };
}

function nextRuns(expression, count = 5, fromDate = new Date()) {
  const checked = validateCron(expression);
  if (!checked.valid) return [];
  try {
    const interval = cronParser.parseExpression(checked.expression, {
      currentDate: fromDate,
      tz: TIMEZONE,
    });
    const result = [];
    for (let i = 0; i < count; i += 1) {
      const date = interval.next().toDate();
      result.push({
        at: date.toISOString(),
        text: formatBeijing(date),
      });
    }
    return result;
  } catch (error) {
    return [];
  }
}

function formatBeijing(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function nowISO() {
  return new Date().toISOString();
}

function resolveSchedule(payload) {
  const mode = payload.scheduleMode === 'cron' ? 'cron' : 'visual';
  if (mode === 'visual') {
    const cronExpr = visualToCron(payload.visual || {});
    const checked = validateCron(cronExpr);
    if (!checked.valid) {
      const error = new Error(checked.message);
      error.status = 400;
      throw error;
    }
    return {
      scheduleMode: 'visual',
      visual: {
        type: payload.visual.type,
        minute: clamp(payload.visual.minute, 0, 59, 0),
        hour: clamp(payload.visual.hour, 0, 23, 0),
        day: clamp(payload.visual.day, 1, 31, 1),
        interval: clamp(payload.visual.interval, 1, 59, 1),
        weekdays: uniqueSorted(payload.visual.weekdays, 0, 6),
      },
      cron: checked.expression,
    };
  }

  const checked = validateCron(payload.cron);
  if (!checked.valid) {
    const error = new Error(checked.message);
    error.status = 400;
    throw error;
  }
  return {
    scheduleMode: 'cron',
    visual: cronToVisual(checked.expression),
    cron: checked.expression,
  };
}

module.exports = {
  TIMEZONE,
  TIMEZONE_LABEL,
  VISUAL_TYPES,
  visualToCron,
  cronToVisual,
  validateCron,
  nextRuns,
  formatBeijing,
  nowISO,
  resolveSchedule,
};
