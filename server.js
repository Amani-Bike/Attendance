const express = require('express');
const path = require('path');
require('./db'); // runs schema setup

const app = express();
app.set('trust proxy', 1); // behind the host's HTTPS proxy
app.use(express.json());
app.use('/qr', express.static(require('./paths').QR_DIR));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
