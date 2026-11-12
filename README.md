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

### Deploy to Cloudflare Workers

The Cloudflare Worker serves the pages directly over HTTPS, so the scanner runs
as a top-level web page rather than inside the Apps Script HTML sandbox.

1. Push this branch to GitHub and open Cloudflare **Workers & Pages**.
2. Choose **Create application → GitHub**, connect this repository, and select
   the `agents/git-push-to-attendance-repo` branch. Cloudflare reads
   `wrangler.jsonc`; keep the Worker name `qr-attendance`.
3. Deploy the Worker, then open its **Settings → Variables and Secrets** and
   add these as secrets (not plain-text variables): `GOOGLE_SHEETS_ID`,
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `ADMIN_PASSWORD`, and
   `SESSION_SECRET`.
4. Redeploy after adding the secrets. Open the HTTPS `workers.dev` URL on your
   phone, test camera scanning, then choose **Add to Home Screen**.

Cloudflare documents a free Workers plan with a daily request limit. Signup
requirements can vary; if the dashboard asks for payment details, stop rather
than entering them. The Worker uses the existing restricted spreadsheet and
service account; never put the private key in the repository or browser code.
