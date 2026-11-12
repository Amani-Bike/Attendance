// Admin API: login, /metrics, /logs, /export.csv, /trends
const express = require('express');
const crypto = require('crypto');
const sheets = require('../sheets');

const router = express.Router();
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // CHANGE in production
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN = crypto.createHmac('sha256', SECRET).update('admin').digest('hex');
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const getCookie = (req, k) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === k)?.[1] || '';

router.post('/login', (req, res) => {
  if (!safeEq(String(req.body.password || ''), PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  res.setHeader('Set-Cookie', `admin=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

router.use((req, res, next) =>
  safeEq(getCookie(req, 'admin'), TOKEN) ? next() : res.status(401).json({ error: 'Login required.' }));

const asDate = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid attendance timestamp: ${value}`);
  return date;
};

async function sessions() {
  const [members, attendance] = await Promise.all([sheets.getMembers(), sheets.getAttendance()]);
  const memberNames = new Map(members.map(member => [member.id, member.name]));
  const open = new Map();
  const result = [];

  for (const row of attendance) {
    const name = memberNames.get(row.member_id);
    if (!name) throw new Error(`Attendance record references missing member ${row.member_id}.`);
    if (row.activity_type === 'IN') {
      const session = { member_id: row.member_id, name, in: asDate(row.timestamp), out: null };
      open.set(row.member_id, session);
      result.push(session);
    } else if (row.activity_type === 'OUT' && open.has(row.member_id)) {
      open.get(row.member_id).out = asDate(row.timestamp);
      open.delete(row.member_id);
    } else {
      throw new Error(`Unexpected attendance activity "${row.activity_type}".`);
    }
  }
  return result.reverse();
}

function filtered(all, query) {
  const from = query.from ? new Date(query.from + 'T00:00:00') : null;
  const to = query.to ? new Date(query.to + 'T23:59:59.999') : null;
  return all.filter(session =>
    (!from || session.in >= from) && (!to || session.in <= to));
}
const mins = session => session.out ? Math.round((session.out - session.in) / 60000) : null;

router.get('/metrics', asyncRoute(async (req, res) => {
  const [members, attendance, allSessions] = await Promise.all([
    sheets.getMembers(), sheets.getAttendance(), sessions()
  ]);
  const memberNames = new Map(members.map(member => [member.id, member.name]));
  const recent = attendance.slice(-12).reverse().map(row => ({
    name: memberNames.get(row.member_id),
    type: row.activity_type,
    time: asDate(row.timestamp)
  }));
  res.json({
    total: members.filter(member => member.active).length,
    present: allSessions.filter(session => !session.out).length,
    recent
  });
}));

router.get('/members', asyncRoute(async (req, res) => {
  const members = await sheets.getMembers();
  res.json(members.sort((a, b) => b.id - a.id).map(({ rowNumber, ...member }) => member));
}));

router.post('/members/:id/active', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const member = Number.isSafeInteger(id) ? await sheets.findMember(id) : null;
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  const active = Boolean(req.body.active);
  await sheets.setMemberActive(member, active);
  if (!active) {
    const last = (await sheets.getAttendance()).filter(row => row.member_id === id).at(-1);
    if (last && last.activity_type === 'IN') await sheets.addAttendance(id, 'OUT');
  }
  res.json({ ok: true });
}));

router.get('/logs', asyncRoute(async (req, res) =>
  res.json(filtered(await sessions(), req.query).map(session => ({ ...session, minutes: mins(session) })))));

router.get('/export.csv', asyncRoute(async (req, res) => {
  const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = ['Date,Member,Sign-In,Sign-Out,Duration (min)'];
  for (const session of filtered(await sessions(), req.query)) {
    lines.push([
      session.in.toLocaleDateString(), session.name, session.in.toLocaleTimeString(),
      session.out ? session.out.toLocaleTimeString() : '', mins(session) ?? ''
    ].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send(lines.join('\n'));
}));

router.get('/trends', asyncRoute(async (req, res) => {
  const all = await sessions();
  const hours = Array(24).fill(0);
  const daily = {}, durationByDay = {};
  for (const session of all) {
    hours[session.in.getHours()]++;
    const day = session.in.toISOString().slice(0, 10);
    daily[day] = (daily[day] || 0) + 1;
    const duration = mins(session);
    if (duration !== null) (durationByDay[day] = durationByDay[day] || []).push(duration);
  }
  const days = Object.keys(daily).sort().slice(-30);
  const average = values => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
  const completed = all.map(mins).filter(value => value !== null);
  res.json({
    hours,
    daily: days.map(date => ({ date, count: daily[date] })),
    avgByDay: days.map(date => ({ date, minutes: average(durationByDay[date] || []) })),
    avgMinutes: average(completed)
  });
}));

router.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Google Sheets request failed. Check the server configuration and try again.' });
});

module.exports = router;
