// Where data lives. On a host with a persistent disk, set DATA_DIR to the disk's mount path.
const path = require('path');
const fs = require('fs');
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'data.db');
const QR_DIR = process.env.DATA_DIR ? path.join(DATA_DIR, 'qr') : path.join(__dirname, 'public', 'qr');
fs.mkdirSync(QR_DIR, { recursive: true });
module.exports = { DB_PATH, QR_DIR };
