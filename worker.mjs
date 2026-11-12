import QRCode from 'qrcode';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
let cachedToken;

function randomMemberId() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return 100000000 + (value[0] % 900000000);
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
});

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemBytes(pem) {
  const encoded = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(encoded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function createAssertion(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function accessToken(env) {
  if (!env.GOOGLE_SHEETS_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY)
    throw new Error('Google Sheets secrets are not configured.');

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await createAssertion(env)
    })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error('Google service-account authentication failed.');

  cachedToken = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return cachedToken.value;
}

async function sheetsRequest(env, method, range, body) {
  const spreadsheetId = encodeURIComponent(env.GOOGLE_SHEETS_ID);
  const endpoint = `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const url = method === 'POST' ? `${endpoint}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
    : method === 'PUT' ? `${endpoint}?valueInputOption=RAW`
      : endpoint;
  const response = await fetch(url, {
    method: method === 'PUT' ? 'PUT' : method === 'POST' ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${await accessToken(env)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Google Sheets API request failed (${response.status}).`);
  return result;
}

const MEMBER_HEADERS = ['id', 'name', 'email', 'gender', 'address', 'phone', 'active', 'created_at'];
const ATTENDANCE_HEADERS = ['id', 'member_id', 'activity_type', 'timestamp'];

async function readRows(env, sheetName, headers) {
  const endColumn = String.fromCharCode(64 + headers.length);
  const result = await sheetsRequest(env, 'GET', `'${sheetName}'!A1:${endColumn}`);
  const values = result.values || [];
  if (!headers.every((header, index) => (values[0] || [])[index] === header))
    throw new Error(`The ${sheetName} sheet headers must be: ${headers.join(', ')}.`);
  return values.slice(1).map((row, index) => ({
    ...Object.fromEntries(headers.map((header, column) => [header, row[column] || ''])),
    rowNumber: index + 2
  }));
}

async function getMembers(env) {
  return (await readRows(env, 'Members', MEMBER_HEADERS)).map(row => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    gender: row.gender,
    address: row.address,
    phone: row.phone,
    active: ['true', '1'].includes(String(row.active).toLowerCase()),
    created_at: row.created_at,
    rowNumber: row.rowNumber
  }));
}

async function getAttendance(env) {
  return (await readRows(env, 'Attendance', ATTENDANCE_HEADERS)).map(row => ({
    id: row.id,
    member_id: Number(row.member_id),
    activity_type: row.activity_type,
    timestamp: row.timestamp
  }));
}

async function appendRow(env, sheetName, endColumn, row) {
  await sheetsRequest(env, 'POST', `'${sheetName}'!A:${endColumn}`, { values: [row] });
}

async function addAttendance(env, memberId, activityType, timestamp = new Date().toISOString()) {
  await appendRow(env, 'Attendance', 'D', [
    `${Date.now()}-${crypto.randomUUID()}`, memberId, activityType, timestamp
  ]);
}

async function verifyAdmin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) throw new Error('Admin secrets are not configured.');
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.split(/;\s*/).find(value => value.startsWith('admin='))?.slice(6) || '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('admin'));
  const expected = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return token.length === expected.length && [...token].every((char, index) => char === expected[index]);
}

function sessionsFrom(members, attendance) {
  const memberNames = new Map(members.map(member => [member.id, member.name]));
  const open = new Map();
  const sessions = [];
  for (const row of attendance) {
    const name = memberNames.get(row.member_id);
    if (!name) throw new Error(`Attendance record references missing member ${row.member_id}.`);
    const timestamp = new Date(row.timestamp);
    if (Number.isNaN(timestamp.getTime())) throw new Error(`Invalid attendance timestamp: ${row.timestamp}`);
    if (row.activity_type === 'IN') {
      const session = { member_id: row.member_id, name, in: timestamp, out: null };
      open.set(row.member_id, session);
      sessions.push(session);
    } else if (row.activity_type === 'OUT' && open.has(row.member_id)) {
      open.get(row.member_id).out = timestamp;
      open.delete(row.member_id);
    } else {
      throw new Error(`Unexpected attendance activity "${row.activity_type}".`);
    }
  }
  return sessions.reverse();
}

function filterSessions(sessions, url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T23:59:59.999`) : null;
  return sessions.filter(session =>
    (!start || session.in >= start) && (!end || session.in <= end));
}

const durationMinutes = session => session.out
  ? Math.round((session.out - session.in) / 60000)
  : null;

async function routeApi(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  if (pathname === '/api/config' && method === 'GET')
    return json({ name: env.ORG_NAME || 'Youth Advisory Panel', logo: '/logo.jpg' });

  if (pathname === '/api/register' && method === 'POST') {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const gender = String(body.gender || '').trim();
    const address = String(body.address || '').trim();
    const phone = String(body.phone || '').trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email))
      return json({ error: 'Enter a full name and a valid email address.' }, 400);
    if (!['', 'Female', 'Male'].includes(gender))
      return json({ error: 'Choose Female or Male for gender.' }, 400);
    if (address.length > 500 || phone.length > 50)
      return json({ error: 'Address must be 500 characters or fewer and phone number 50 characters or fewer.' }, 400);

    const members = await getMembers(env);
    if (members.some(member => member.email.toLowerCase() === email))
      return json({ error: 'That email is already registered.' }, 409);

    let id;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = randomMemberId();
      if (!members.some(member => member.id === candidate)) {
        id = candidate;
        break;
      }
    }
    if (!id) throw new Error('Could not generate a unique member ID.');

    const qr = await QRCode.toDataURL(String(id), { width: 600, margin: 1, errorCorrectionLevel: 'H' });
    await appendRow(env, 'Members', 'H', [
      id, name, email, gender, address, phone, 'TRUE', new Date().toISOString()
    ]);
    return json({ id, name, email, gender, address, phone, qr, org: { name: env.ORG_NAME || 'Youth Advisory Panel', logo: '/logo.jpg' } });
  }

  if (pathname === '/api/scan' && method === 'POST') {
    const body = await request.json();
    const memberId = String(body.memberId || '').trim();
    const mode = body.mode;
    if (!['IN', 'OUT'].includes(mode)) return json({ ok: false, error: 'Invalid mode.' }, 400);
    if (!/^\d+$/.test(memberId)) return json({ ok: false, error: 'Invalid or Unrecognized QR Code.' }, 404);
    const id = Number(memberId);
    const members = await getMembers(env);
    const member = members.find(candidate => candidate.id === id);
    if (!member) return json({ ok: false, error: 'Invalid or Unrecognized QR Code.' }, 404);
    if (!member.active) return json({ ok: false, error: 'This card has been deactivated. See an administrator.' }, 403);
    const attendance = await getAttendance(env);
    const last = attendance.filter(row => row.member_id === id).at(-1);
    const isIn = last && last.activity_type === 'IN';
    if (mode === 'IN' && isIn) return json({ ok: false, error: `${member.name} is already signed in.` }, 409);
    if (mode === 'OUT' && !isIn) return json({ ok: false, error: `${member.name} is not signed in.` }, 409);
    const time = new Date().toISOString();
    await addAttendance(env, id, mode, time);
    return json({ ok: true, name: member.name, mode, time });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET)
      return json({ error: 'Admin secrets are not configured.' }, 503);
    const body = await request.json();
    if (String(body.password || '') !== env.ADMIN_PASSWORD)
      return json({ error: 'Wrong password.' }, 401);
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(env.SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('admin'));
    const token = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return json({ ok: true }, 200, {
      'Set-Cookie': `admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
    });
  }

  if (pathname === '/api/admin/logout' && method === 'POST')
    return json({ ok: true }, 200, { 'Set-Cookie': 'admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });

  if (!pathname.startsWith('/api/admin/')) return json({ error: 'Not found.' }, 404);
  if (!(await verifyAdmin(request, env))) return json({ error: 'Login required.' }, 401);

  if (pathname === '/api/admin/members' && method === 'GET') {
    const members = (await getMembers(env)).sort((a, b) => b.id - a.id)
      .map(({ rowNumber, ...member }) => member);
    return json(members);
  }

  const activeMatch = pathname.match(/^\/api\/admin\/members\/(\d+)\/active$/);
  if (activeMatch && method === 'POST') {
    const id = Number(activeMatch[1]);
    const members = await getMembers(env);
    const member = members.find(candidate => candidate.id === id);
    if (!member) return json({ error: 'Member not found.' }, 404);
    const body = await request.json();
    const active = body.active === true || body.active === 1 || body.active === 'true';
    await sheetsRequest(env, 'PUT', `'Members'!G${member.rowNumber}`, { values: [[active ? 'TRUE' : 'FALSE']] });
    if (!active) {
      const last = (await getAttendance(env)).filter(row => row.member_id === id).at(-1);
      if (last && last.activity_type === 'IN') await addAttendance(env, id, 'OUT');
    }
    return json({ ok: true });
  }

  if (pathname === '/api/admin/metrics' && method === 'GET') {
    const [members, attendance] = await Promise.all([getMembers(env), getAttendance(env)]);
    const sessions = sessionsFrom(members, attendance);
    const memberNames = new Map(members.map(member => [member.id, member.name]));
    const recent = attendance.slice(-12).reverse().map(row => ({
      name: memberNames.get(row.member_id),
      type: row.activity_type,
      time: new Date(row.timestamp)
    }));
    return json({
      total: members.filter(member => member.active).length,
      present: sessions.filter(session => !session.out).length,
      recent
    });
  }

  if (pathname === '/api/admin/logs' && method === 'GET') {
    const sessions = sessionsFrom(await getMembers(env), await getAttendance(env));
    return json(filterSessions(sessions, url).map(session => ({ ...session, minutes: durationMinutes(session) })));
  }

  if (pathname === '/api/admin/export.csv' && method === 'GET') {
    const sessions = filterSessions(
      sessionsFrom(await getMembers(env), await getAttendance(env)), url
    );
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = ['Date,Member,Sign-In,Sign-Out,Duration (min)'];
    for (const session of sessions) {
      lines.push([
        session.in.toLocaleDateString(), session.name, session.in.toLocaleTimeString(),
        session.out ? session.out.toLocaleTimeString() : '', durationMinutes(session) ?? ''
      ].map(escape).join(','));
    }
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="attendance.csv"'
      }
    });
  }

  if (pathname === '/api/admin/trends' && method === 'GET') {
    const sessions = sessionsFrom(await getMembers(env), await getAttendance(env));
    const hours = Array(24).fill(0);
    const daily = {}, durationByDay = {};
    for (const session of sessions) {
      hours[session.in.getHours()]++;
      const day = session.in.toISOString().slice(0, 10);
      daily[day] = (daily[day] || 0) + 1;
      const duration = durationMinutes(session);
      if (duration !== null) (durationByDay[day] = durationByDay[day] || []).push(duration);
    }
    const days = Object.keys(daily).sort().slice(-30);
    const average = values => values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : 0;
    const completed = sessions.map(durationMinutes).filter(value => value !== null);
    return json({
      hours,
      daily: days.map(date => ({ date, count: daily[date] })),
      avgByDay: days.map(date => ({ date, minutes: average(durationByDay[date] || []) })),
      avgMinutes: average(completed)
    });
  }

  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await routeApi(request, env);
    } catch (error) {
      console.error('API request failed:', error);
      return json({ error: 'Google Sheets request failed. Check the server configuration and try again.' }, 500);
    }
  }
};
