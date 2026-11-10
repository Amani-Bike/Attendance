// POST /api/register  -> create member, generate QR on this server
// POST /api/scan      -> record IN / OUT for a scanned member ID
const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const db = require('../db');
const { QR_DIR } = require('../paths');

const router = express.Router();
const ORG = { name: process.env.ORG_NAME || 'Youth Advisory Panel', logo: '/logo.jpg' };

router.get('/config', (req, res) => res.json(ORG));

router.post('/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email))
    return res.status(400).json({ error: 'Enter a full name and a valid email address.' });
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO members (name, email) VALUES (?, ?)').run(name, email);
    const id = Number(lastInsertRowid);
    const rel = `/qr/${id}.png`;
    // The QR payload is only the numeric member ID.
    await QRCode.toFile(path.join(QR_DIR, `${id}.png`), String(id), { width: 600, margin: 1, errorCorrectionLevel: 'H' });
    db.prepare('UPDATE members SET qr_code_path = ? WHERE id = ?').run(rel, id);
    res.json({ id, name, email, qr: rel, org: ORG });
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'That email is already registered.' });
    console.error(e);
    res.status(500).json({ error: 'Registration failed. Try again.' });
  }
});

router.post('/scan', (req, res) => {
  const id = parseInt(String(req.body.memberId || '').trim(), 10);
  const mode = req.body.mode;
  if (!['IN', 'OUT'].includes(mode)) return res.status(400).json({ ok: false, error: 'Invalid mode.' });
  const member = Number.isInteger(id) ? db.prepare('SELECT id, name, active FROM members WHERE id = ?').get(id) : null;
  if (!member) return res.status(404).json({ ok: false, error: 'Invalid or Unrecognized QR Code.' });

  if (!member.active) return res.status(403).json({ ok: false, error: 'This card has been deactivated. See an administrator.' });

  const last = db.prepare('SELECT activity_type FROM attendance WHERE member_id = ? ORDER BY id DESC LIMIT 1').get(id);
  const isIn = last && last.activity_type === 'IN';
  if (mode === 'IN' && isIn) return res.status(409).json({ ok: false, error: `${member.name} is already signed in.` });
  if (mode === 'OUT' && !isIn) return res.status(409).json({ ok: false, error: `${member.name} is not signed in.` });

  db.prepare('INSERT INTO attendance (member_id, activity_type) VALUES (?, ?)').run(id, mode);
  res.json({ ok: true, name: member.name, mode, time: new Date().toISOString() });
});

module.exports = router;
