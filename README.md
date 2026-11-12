# QR Attendance

    npm install
    ORG_NAME="Your Org" ADMIN_PASSWORD="choose-a-strong-one" SESSION_SECRET="long-random-string" npm start

Open http://localhost:3000 (register), /scan.html (scanner), /admin.html (dashboard).
Member registration includes optional gender (Female or Male), address, and phone
number fields; these details are also available in the admin member list.
Camera access needs HTTPS or localhost. Replace public/logo.jpg and public/logo.svg
with your branding; update the PNG files in public/icons/ to match.
Member and attendance records are stored in the Google Sheets spreadsheet. QR
images are generated in memory when a member registers.

Configure these server-side environment variables before using registration,
scanning, or the admin dashboard:

- `GOOGLE_SHEETS_ID`: the spreadsheet ID from its URL.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: the service account email shared on the sheet.
- `GOOGLE_PRIVATE_KEY`: the `private_key` value from its downloaded JSON key.
- `ADMIN_PASSWORD`: a strong admin password.
- `SESSION_SECRET`: a long random session secret.

Never put the service-account key in browser code or commit it to the repository.

For local UI work, set `ENABLE_LIVE_RELOAD=true` before starting the server and
open `/?livePreview=1` (or add `?livePreview=1` to another page URL). The browser
reloads automatically when files in `public/` change.

The app is installable on supported phones and browsers using its web app manifest
and service worker. For production, deploy the Node.js server over HTTPS; the
service worker only caches the app shell, while registration, scanning, and admin
data require a network connection. On mobile, open the deployed site and choose
"Add to Home Screen" (or the browser's install option).

### Deploy to Render

1. Push this branch to GitHub.
2. In Render, choose **New → Blueprint** and select this repository.
3. Before deploying, enter `ADMIN_PASSWORD`, `GOOGLE_SHEETS_ID`,
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY` when prompted. The
   Blueprint generates `SESSION_SECRET`.
4. Open the deployed HTTPS URL on your phone and choose **Add to Home Screen**.

The Blueprint uses Render's free web-service plan and needs no persistent disk
because Sheets stores the records. Free hosting has availability and usage
limits; check whether Render allows signup and deploy without requesting a
payment method before relying on it.
