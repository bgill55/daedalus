# Marathon Roadmap: Transform the Daedalus WebUI in src/webui/public/ into a sovereign mobile-first PWA companion with installable manifest, service worker caching, touch-optimized responsive layout, QR code pairing for local/Tailscale networks, and milestone push notifications.

- **Status**: `COMPLETED`
- **Progress**: 8/8 milestones passed (100%)
- **Base Branch**: `main`
- **Integration Branch**: `marathon/transform-the-daedalus-webui-i`
- **Last Updated**: 2026-09-05T04:05:54.734Z

## Milestones

### [x] M-1: Add PWA manifest and HTML integration

Create a web app manifest file with required fields and link it from index.html so browsers recognise the app as installable.

- **Target Files**: `src/webui/public/manifest.json`, `src/webui/public/index.html`
- **Git Tag**: `daedalus-checkpoint/m-1`
- **Attempts**: 1/3

**Acceptance Criteria:**
- [x] manifest.json exists with name, short_name, start_url, display, icons, and background_color fields
- [x] index.html contains a <link rel="manifest" href="manifest.json"> tag inside <head>
- [x] Running `npm run build` does not error and the manifest is served correctly via the dev server

### [x] M-2: Service worker file and registration

Add a service worker script (sw.js) that caches core assets and register it from script.js on page load.

- **Target Files**: `src/webui/public/sw.js`, `src/webui/public/script.js`
- **Git Tag**: `daedalus-checkpoint/m-2`
- **Attempts**: 3/3

**Acceptance Criteria:**
- [x] sw.js implements install event to cache index.html, styles.css, script.js, and manifest.json
- [x] script.js registers the service worker and logs success or failure
- [x] When the site is loaded offline, the cached assets are served and the UI renders correctly

### [x] M-3: Mobile‑first responsive styling

Introduce responsive breakpoints and fluid layout in styles.css to make the UI adapt to phones, tablets, and desktops.

- **Target Files**: `src/webui/public/styles.css`
- **Git Tag**: `daedalus-checkpoint/m-3`
- **Attempts**: 5/3

**Acceptance Criteria:**
- [x] CSS includes @media queries for max-width: 600px and 900px
- [x] All UI elements reflow without horizontal scroll on a 375 px viewport
- [x] Visual regression test confirms layout matches expected screenshots on mobile and desktop

### [x] M-4: Touch‑optimized UI components

Increase tap target sizes, add hover‑fallbacks, and ensure interactive elements are keyboard accessible.

- **Target Files**: `src/webui/public/index.html`, `src/webui/public/script.js`
- **Git Tag**: `daedalus-checkpoint/m-4`
- **Attempts**: 1/3

**Acceptance Criteria:**
- [x] Buttons and links have a minimum 48 px height/width
- [x] CSS adds `touch-action: manipulation` where appropriate
- [x] Script.js adds `pointerdown` listeners in addition to `click` for critical actions
- [x] Automated accessibility test (axe) reports no violations for tap targets

### [x] M-5: QR code generation endpoint

Implement a server‑side endpoint that returns a PNG QR code encoding the local WebSocket URL for pairing over LAN/Tailscale.

- **Target Files**: `src/webui/server.ts`, `src/webui/qr.ts`
- **Git Tag**: `daedalus-checkpoint/m-5`
- **Attempts**: 1/3

**Acceptance Criteria:**
- [x] GET /api/qr returns image/png with a valid QR code
- [x] QR encodes the WebSocket URL (e.g., ws://<host>:<port>)
- [x] Unit test verifies response status 200 and correct content‑type
- [x] Endpoint does not modify existing routes or break current server start

### [x] M-6: Client‑side QR code scanner for pairing

Add UI to capture a QR code using the device camera, decode it, and open a WebSocket connection to the paired server.

- **Target Files**: `src/webui/public/index.html`, `src/webui/public/script.js`
- **Git Tag**: `daedalus-checkpoint/m-6`
- **Attempts**: 1/3

**Acceptance Criteria:**
- [x] A "Pair via QR" button appears on mobile view
- [x] Clicking the button launches the camera and scans the QR code using a lightweight library (e.g., @zxing/browser)
- [x] Decoded URL is used to open a WebSocket; connection success is logged
- [x] If scanning fails, a user‑friendly error message is displayed

### [x] M-7: Milestone push notifications via WebSocket

Create a WebSocket server that pushes milestone events to connected clients and update the client to display native notifications.

- **Target Files**: `src/webui/ws.ts`, `src/webui/public/script.js`
- **Git Tag**: `daedalus-checkpoint/m-7`
- **Attempts**: 4/3

**Acceptance Criteria:**
- [x] ws.ts exports a function to start a WebSocket server on the same HTTP port
- [x] When the server emits a "milestone" message, script.js receives it and calls Notification API
- [x] Browser prompts for notification permission on first receipt
- [x] Automated integration test confirms a test message sent from server appears as a notification in the client mock

### [x] M-8: PWA install prompt handling and UI cue

Detect the `beforeinstallprompt` event, show a custom install banner, and trigger the native install flow when the user accepts.

- **Target Files**: `src/webui/public/index.html`, `src/webui/public/script.js`
- **Git Tag**: `daedalus-checkpoint/m-8`
- **Attempts**: 3/3

**Acceptance Criteria:**
- [x] script.js listens for `beforeinstallprompt` and stores the event
- [x] A visible install banner appears on mobile after the event is captured
- [x] Clicking the banner calls `prompt()` on the stored event and handles the user choice
- [x] Successful install logs a confirmation and the banner disappears
- [x] E2E test simulates the event and verifies banner visibility and prompt call
