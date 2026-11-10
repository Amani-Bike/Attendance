# QR Attendance

    npm install
    ORG_NAME="Your Org" ADMIN_PASSWORD="choose-a-strong-one" SESSION_SECRET="long-random-string" npm start

Open http://localhost:3000 (register), /scan.html (scanner), /admin.html (dashboard).
Camera access needs HTTPS or localhost. Replace public/logo.jpg and public/logo.svg
with your branding; update the PNG files in public/icons/ to match.
The database (data.db) and QR images (public/qr/) are created automatically.

The app is installable on supported phones and browsers using its web app manifest
and service worker. For production, deploy the Node.js server over HTTPS; the
service worker only caches the app shell, while registration, scanning, and admin
data require a network connection. On mobile, open the deployed site and choose
"Add to Home Screen" (or the browser's install option).

### Deploy to Render

1. Push this branch to GitHub.
2. In Render, choose **New → Blueprint** and select this repository.
3. Before deploying, enter a strong value for `ADMIN_PASSWORD` when prompted.
   The Blueprint generates `SESSION_SECRET` and provisions a persistent disk for
   the SQLite database and QR images.
4. Open the deployed HTTPS URL on your phone and choose **Add to Home Screen**.

The persistent disk requires a paid Render web service plan. Do not remove the
disk or change `DATA_DIR` after deployment, or the app will no longer find its
database and generated QR files.
