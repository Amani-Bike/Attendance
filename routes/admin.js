// Admin API: login, /metrics, /logs, /export.csv, /trends
const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';       // CHANGE in production
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN = crypto.createHmac('sha256', SECRET).update('admin').digest('hex');

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

// Everything below requires login.
router.use((req, res, next) => safeEq(getCookie(req, 'admin'), TOKEN) ? next() : res.status(401).json({ error: 'Login required.' }));

const iso = ts => new Date(ts.replace(' ', 'T') + 'Z');

// Pair each IN with the member's next OUT to build sessions.
function sessions() {
  const rows = db.prepare(`SELECT a.member_id, m.name, a.activity_type, a.timestamp
    FROM attendance a JOIN members m ON m.id = a.member_id ORDER BY a.id`).all();
  const open = {}, out = [];
  for (const r of rows) {
    if (r.activity_type === 'IN') {
      open[r.member_id] = { member_id: r.member_id, name: r.name, in: iso(r.timestamp), out: null };
      out.push(open[r.member_id]);
    } else if (open[r.member_id]) {
      open[r.member_id].out = iso(r.timestamp);
      delete open[r.member_id];
    }
  }
  return out.reverse(); // newest first
}
function filtered(q) {
  const from = q.from ? new Date(q.from + 'T00:00:00') : null;
  const to = q.to ? new Date(q.to + 'T23:59:59.999') : null;
  return sessions().filter(s => (!from || s.in >= from) && (!to || s.in <= to));
}
const mins = s => s.out ? Math.round((s.out - s.in) / 60000) : null;

router.get('/metrics', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM members WHERE active = 1').get().c;
  const present = sessions().filter(s => !s.out).length;
  const recent = db.prepare(`SELECT m.name, a.activity_type, a.timestamp FROM attendance a
    JOIN members m ON m.id = a.member_id ORDER BY a.id DESC LIMIT 12`).all()
    .map(r => ({ name: r.name, type: r.activity_type, time: iso(r.timestamp) }));
  res.json({ total, present, recent });
});

router.get('/members', (req, res) =>
  res.json(db.prepare('SELECT id, name, email, active FROM members ORDER BY id DESC').all()));

// Deactivate / reactivate. History is kept; a deactivated card is refused at the scanner.
router.post('/members/:id/active', (req, res) => {
  const id = parseInt(req.params.id, 10), active = req.body.active ? 1 : 0;
  if (!db.prepare('SELECT id FROM members WHERE id = ?').get(id)) return res.status(404).json({ error: 'Member not found.' });
  db.transaction(() => {
    db.prepare('UPDATE members SET active = ? WHERE id = ?').run(active, id);
    if (!active) { // close any open session so they don't stay "present"
      const last = db.prepare('SELECT activity_type FROM attendance WHERE member_id = ? ORDER BY id DESC LIMIT 1').get(id);
      if (last && last.activity_type === 'IN') db.prepare("INSERT INTO attendance (member_id, activity_type) VALUES (?, 'OUT')").run(id);
    }
  })();
  res.json({ ok: true });
});

router.get('/logs', (req, res) =>
  res.json(filtered(req.query).map(s => ({ ...s, minutes: mins(s) }))));

router.get('/export.csv', (req, res) => {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Date,Member,Sign-In,Sign-Out,Duration (min)'];
  for (const s of filtered(req.query))
    lines.push([s.in.toLocaleDateString(), s.name, s.in.toLocaleTimeString(), s.out ? s.out.toLocaleTimeString() : '', mins(s) ?? ''].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send(lines.join('\n'));
});

router.get('/trends', (req, res) => {
  const all = sessions();
  const hours = Array(24).fill(0);
  const daily = {}, durByDay = {};
  for (const s of all) {
    hours[s.in.getHours()]++;
    const d = s.in.toISOString().slice(0, 10);
    daily[d] = (daily[d] || 0) + 1;
    const m = mins(s);
    if (m !== null) (durByDay[d] = durByDay[d] || []).push(m);
  }
  const days = Object.keys(daily).sort().slice(-30);
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
  const completed = all.map(mins).filter(m => m !== null);
  res.json({
    hours,
    daily: days.map(d => ({ date: d, count: daily[d] })),
    avgByDay: days.map(d => ({ date: d, minutes: avg(durByDay[d] || []) })),
    avgMinutes: avg(completed)
  });
});

module.exports = router;
