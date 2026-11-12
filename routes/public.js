const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const sheets = require('../sheets');

const router = express.Router();
const ORG = { name: process.env.ORG_NAME || 'Youth Advisory Panel', logo: '/logo.jpg' };
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/config', (req, res) => res.json(ORG));

router.post('/register', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const gender = String(req.body.gender || '').trim();
  const address = String(req.body.address || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email))
    return res.status(400).json({ error: 'Enter a full name and a valid email address.' });
  if (!['', 'Female', 'Male'].includes(gender))
    return res.status(400).json({ error: 'Choose Female or Male for gender.' });
  if (address.length > 500 || phone.length > 50)
    return res.status(400).json({ error: 'Address must be 500 characters or fewer and phone number 50 characters or fewer.' });
  const members = await sheets.getMembers();
  if (members.some(member => member.email.toLowerCase() === email))
    return res.status(409).json({ error: 'That email is already registered.' });

  let id;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = crypto.randomInt(100000000, 1000000000);
    if (!members.some(member => member.id === candidate)) {
      id = candidate;
      break;
    }
  }
  if (!id) throw new Error('Could not generate a unique member ID.');

  const qr = await QRCode.toDataURL(String(id), { width: 600, margin: 1, errorCorrectionLevel: 'H' });
  await sheets.addMember({
    id, name, email, gender, address, phone, created_at: new Date().toISOString()
  });
  res.json({ id, name, email, gender, address, phone, qr, org: ORG });
}));

router.post('/scan', asyncRoute(async (req, res) => {
  const memberId = String(req.body.memberId || '').trim();
  const mode = req.body.mode;
  if (!['IN', 'OUT'].includes(mode)) return res.status(400).json({ ok: false, error: 'Invalid mode.' });
  if (!/^\d+$/.test(memberId)) return res.status(404).json({ ok: false, error: 'Invalid or Unrecognized QR Code.' });

  const member = await sheets.findMember(Number(memberId));
  if (!member) return res.status(404).json({ ok: false, error: 'Invalid or Unrecognized QR Code.' });
  if (!member.active) return res.status(403).json({ ok: false, error: 'This card has been deactivated. See an administrator.' });

  const attendance = await sheets.getAttendance();
  const last = attendance.filter(row => row.member_id === member.id).at(-1);
  const isIn = last && last.activity_type === 'IN';
  if (mode === 'IN' && isIn) return res.status(409).json({ ok: false, error: `${member.name} is already signed in.` });
  if (mode === 'OUT' && !isIn) return res.status(409).json({ ok: false, error: `${member.name} is not signed in.` });

  const time = new Date().toISOString();
  await sheets.addAttendance(member.id, mode, time);
  res.json({ ok: true, name: member.name, mode, time });
}));

router.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Google Sheets request failed. Check the server configuration and try again.' });
});

module.exports = router;
