# ScreenSolver

ScreenSolver is a transparent personal macOS utility that captures the primary display with a menu-bar command or `Command + Shift + Y`, uploads the screenshot to a local backend, and shows the AI result in a mobile-friendly web app.

It does not bypass permissions or run stealthily. The macOS app uses normal Screen Recording permission and always has menu-bar presence.

## Project Structure

```text
apps/
  mac/ScreenSolver/      Swift source files for an Xcode macOS App target
  backend/               Express + TypeScript API
  web/                   React + Vite + Tailwind frontend
README.md
.env.example
```

## Environment

Create local env files from `.env.example`.

For backend:

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. `OPENAI_MODEL` defaults to `gpt-4o`.

For web, either export `VITE_BACKEND_URL` before starting Vite or create `apps/web/.env`:

```bash
VITE_BACKEND_URL=http://localhost:4000
```

## Backend

```bash
npm install --prefix apps/backend
npm run dev:backend
```

Health check:

```bash
curl http://localhost:4000/api/health
```

The backend stores uploads in `apps/backend/uploads` and session JSON files in `apps/backend/data/sessions`.

## Web

```bash
npm install --prefix apps/web
npm run dev:web
```

Open:

- `http://localhost:5173/latest`
- `http://localhost:5173/session/<sessionId>`

The page polls every 2 seconds while a session is processing.

## macOS App Setup

1. Open Xcode and create a new **macOS App** target named `ScreenSolver`.
2. Use SwiftUI for the interface and Swift as the language.
3. Delete the generated app/content source files or keep the target and add all files from `apps/mac/ScreenSolver`.
4. Ensure `ScreenSolverApp.swift` is the only file containing `@main`.
5. In **Signing & Capabilities**, enable **App Sandbox** only if you also configure the needed network/client behavior for your local development target. For easiest local MVP testing, run unsigned/debug without sandbox restrictions.
6. Add `NSHumanReadableCopyright` or bundle metadata as desired.
7. Run the app from Xcode.

## Screen Recording Permission

The first capture/check may fail until permission is granted:

1. Open **System Settings**.
2. Go to **Privacy & Security** -> **Screen & System Audio Recording** or **Screen Recording**.
3. Enable the built app or Xcode-run app.
4. Quit and relaunch ScreenSolver.

## macOS Usage

Start the backend first, then run the macOS app.

Menu-bar commands:

- **Capture Now**: captures the primary display and uploads it.
- **Open Latest Result**: opens the latest web result URL.
- **Check Permission**: checks ScreenCaptureKit access.
- **Settings**: opens a small status/settings window.
- **Quit**: exits the app.

Default backend URL is `http://localhost:4000`. You can change it in the Settings window. The global hotkey is `Command + Shift + Y`.

## Production Deployment

This repo includes a GitHub Actions workflow for EC2 deployment:

- Workflow: `.github/workflows/deploy-screensolver.yml`
- PM2 config: `ecosystem.config.cjs`
- Nginx route snippet: `deploy/nginx-screensolver.conf`
- Production env template: `deploy/production.env.example`

The workflow deploys to:

- App/backend source: `/home/ubuntu/screensolver`
- Static web output: `/home/ubuntu/payment_gateway_demo/screensolver`
- PM2 process: `screensolver-backend`
- Backend port: `8000`
- Web route: `https://www.ilogicmagic.com/screensolver/latest`
- API route: `https://www.ilogicmagic.com/screensolver-api/api/health`

Add this GitHub repository secret:

```text
EC2_SSH_PRIVATE_KEY
```

Use the private key contents from your EC2 key file, not the path. On your Mac:

```bash
cat ~/Downloads/ilm_ubuntu_key.pem
```

On the EC2 server, create `/home/ubuntu/screensolver/.env` after the first deploy:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o
PORT=8000
WEB_BASE_URL=https://www.ilogicmagic.com/screensolver
```

Add the contents of `deploy/nginx-screensolver.conf` inside the existing Nginx server block at `/etc/nginx/sites-available/payment-demo`, then test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

In the macOS app Settings window, set Backend URL to:

```text
https://www.ilogicmagic.com/screensolver-api
```
