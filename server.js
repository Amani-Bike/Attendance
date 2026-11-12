const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1); // behind the host's HTTPS proxy
app.use(express.json());
if (process.env.ENABLE_LIVE_RELOAD === 'true') {
  let revision = 0;
  fs.watch(path.join(__dirname, 'public'), { recursive: true }, () => {
    revision += 1;
  });
  app.get('/__dev/version', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ revision });
  });
}
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));

const PORT = process.env.PORT || 3000;
const onListen = () => console.log(`Running on http://localhost:${PORT}`);
if (process.env.HOST) app.listen(PORT, process.env.HOST, onListen);
else app.listen(PORT, onListen);
