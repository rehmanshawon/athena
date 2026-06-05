# Athena

Athena is a transparent personal macOS utility plus API and mobile-friendly web viewer. The macOS app captures the primary display with a menu-bar command, global `Command + Shift + Y` hotkey, or optional timer, uploads the screenshot to the API, and the web app displays the AI-generated result.

It does not bypass permissions or run stealthily. The macOS app uses normal Screen Recording permission and always has menu-bar presence.

## Project Structure

```text
apps/
  athena-api/            Express + TypeScript API
  athena-web/            React + Vite + Tailwind frontend
  mac/athena-mac/        Swift source files for the macOS app
deploy/
README.md
.env.example
```

## Environment

Create local env files from `.env.example`.

For the API:

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. `OPENAI_MODEL` defaults to `gpt-4o`.

For the web app, either export `VITE_API_URL` before starting Vite or create `apps/athena-web/.env`:

```bash
VITE_API_URL=http://localhost:4000
VITE_BASE_PATH=/
```

## API

```bash
npm install --prefix apps/athena-api
npm run dev:api
```

Health check:

```bash
curl http://localhost:4000/api/health
```

The API stores uploads in `apps/athena-api/uploads` and session JSON files in `apps/athena-api/data/sessions`.

## Web

```bash
npm install --prefix apps/athena-web
npm run dev:web
```

Open:

- `http://localhost:5173/latest`
- `http://localhost:5173/session/<sessionId>`

The page polls every 2 seconds while a session is processing.

## macOS App Setup

An Xcode project is generated separately at:

```text
/Users/rehman/Workspace/XCode_Projects/athena-mac
```

If you create a fresh Xcode target, add all files from `apps/mac/athena-mac` and ensure `AthenaMacApp.swift` is the only file containing `@main`.

## Screen Recording Permission

The first capture/check may fail until permission is granted:

1. Open **System Settings**.
2. Go to **Privacy & Security** -> **Screen & System Audio Recording** or **Screen Recording**.
3. Enable the built Athena app.
4. Quit and relaunch Athena.

## macOS Usage

Start the API first, then run the macOS app.

For no-focus capture, use the global `Command + Shift + Y` hotkey or Auto Capture. These paths use ScreenCaptureKit directly and do not open Athena's window or result page. Avoid using the menu-bar **Capture Now**, **Settings**, or **Open Latest Result** actions while another app is monitoring foreground-app changes, because clicking the menu bar or opening a window/browser is normal foreground interaction.

Menu-bar commands:

- **Capture Now**: captures the primary display and uploads it.
- **Open Latest Result**: opens the latest web result URL.
- **Check Permission**: checks ScreenCaptureKit access.
- **Settings**: opens a small status/settings window.
- **Quit**: exits the app.

Default API URL is `http://localhost:4000`. You can change it in the Settings window. The global hotkey is `Command + Shift + Y`.

## Production Deployment

This repo includes GitHub Actions deployment for EC2:

- Workflow: `.github/workflows/deploy-athena.yml`
- PM2 config: `ecosystem.config.cjs`
- Nginx route snippet: `deploy/nginx-athena.conf`
- Production env template: `deploy/production.env.example`

The workflow deploys to:

- App/API source: `/home/ubuntu/athena`
- Static web output: `/home/ubuntu/payment_gateway_demo/athena`
- PM2 process: `athena-api`
- API port: `8000`
- Web route: `https://www.ilogicmagic.com/athena/latest`
- API route: `https://www.ilogicmagic.com/athena-api/api/health`

Add this GitHub repository secret:

```text
EC2_SSH_PRIVATE_KEY
```

Use the private key contents from your EC2 key file, not the path. On your Mac:

```bash
cat ~/Downloads/ilm_ubuntu_key.pem
```

On the EC2 server, create `/home/ubuntu/athena/.env` after the first deploy:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o
PORT=8000
WEB_BASE_URL=https://www.ilogicmagic.com/athena
```

Add the contents of `deploy/nginx-athena.conf` inside the existing Nginx server block at `/etc/nginx/sites-available/payment-demo`, then test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

In the macOS app Settings window, set Athena API URL to:

```text
https://www.ilogicmagic.com/athena-api
```
