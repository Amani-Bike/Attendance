const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const MEMBER_HEADERS = ['id', 'name', 'email', 'gender', 'address', 'phone', 'active', 'created_at'];
const ATTENDANCE_HEADERS = ['id', 'member_id', 'activity_type', 'timestamp'];
let sheetsClient;

function getSheetsClient() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEETS_ID is not configured.');

  if (!sheetsClient) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY;
    if (!email || !key) throw new Error('Google Sheets service-account credentials are not configured.');
    const auth = new google.auth.JWT({
      email,
      key: key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }

  return sheetsClient;
}

async function readRows(sheetName, headers) {
  const response = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1:${String.fromCharCode(64 + headers.length)}`
  });
  const values = response.data.values || [];
  const actualHeaders = values[0] || [];
  if (!headers.every((header, index) => actualHeaders[index] === header)) {
    throw new Error(`The ${sheetName} sheet headers must be: ${headers.join(', ')}.`);
  }

  return values.slice(1).map((row, index) => ({
    ...Object.fromEntries(headers.map((header, column) => [header, row[column] || ''])),
    rowNumber: index + 2
  }));
}

async function appendRow(sheetName, lastColumn, row) {
  await getSheetsClient().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A:${lastColumn}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}

async function getMembers() {
  const rows = await readRows('Members', MEMBER_HEADERS);
  return rows.map(row => ({
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

async function findMember(id) {
  return (await getMembers()).find(member => member.id === id) || null;
}

async function addMember(member) {
  await appendRow('Members', 'H', [
    member.id, member.name, member.email, member.gender, member.address,
    member.phone, 'TRUE', member.created_at
  ]);
}

async function setMemberActive(member, active) {
  await getSheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'Members'!G${member.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[active ? 'TRUE' : 'FALSE']] }
  });
}

async function getAttendance() {
  return (await readRows('Attendance', ATTENDANCE_HEADERS)).map(row => ({
    id: row.id,
    member_id: Number(row.member_id),
    activity_type: row.activity_type,
    timestamp: row.timestamp,
    rowNumber: row.rowNumber
  }));
}

async function addAttendance(memberId, activityType, timestamp = new Date().toISOString()) {
  await appendRow('Attendance', 'D', [
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    memberId, activityType, timestamp
  ]);
}

module.exports = {
  getMembers,
  findMember,
  addMember,
  setMemberActive,
  getAttendance,
  addAttendance
};
