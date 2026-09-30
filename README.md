# WebFig Archive — tool first

**Capture the actual MikroTik RouterOS WebFig DOM into one offline interactive HTML.** This is not a recreated router UI and not a screenshot slideshow. You navigate a real authorized lab router; the tool saves its displayed HTML, computed styles, available raster assets, and observed click → captured-state transitions. Students can then click recorded menus/tabs/dialog controls in the saved interface, without a router, network connection, or backend.

**Status:** first capture-tool implementation. Browser integration tests use a clearly labelled WebFig-shaped **test fixture**, not MikroTik. **No real RouterOS session has been captured or validated yet.** Do not interpret test success as complete RouterOS support. The old `index.html` is the previous learning simulator and is **not** this tool's output; it is left unchanged.

## Install on your capture workstation

Requires Node.js 22+, a graphical desktop, and access to your own disposable RouterOS CHR lab. QEMU and RouterOS are **not** installed/launched by this tool. Log in and change the password privately before capturing.

```sh
npm ci
npx playwright install --with-deps chromium
node bin/webfig-archive.mjs --help
node bin/webfig-archive.mjs \
  --url http://127.0.0.1:8080/webfig/ \
  --output captures/routeros.html
```

Use the actual WebFig path for your installed version. `webfig.do` is not a magic router hostname; the tool rejects that public domain. Never put a password in the URL, arguments, notes, config, or Git. If Chromium is already installed, pass `--executable-path /path/to/chromium`.

The loopback URL above is only an example of an existing QEMU host forward **on the capture workstation**. A remote/headless sandbox does not display a desktop browser in your browser automatically; run this interactive CLI on a desktop or via your existing secured remote desktop. Do not expose the router or Chromium debugging ports publicly.

## Record a real session

The tool opens a fresh browser, initially **paused**. It does not keep a browser profile, cookies, HAR, raw HTML dumps, console logs, screenshots, typed keys, or login requests on disk.

1. Log in/change the password yourself in the live browser while paused. Close password dialogs.
2. In the recorder terminal: `arm` then `capture WebFig / Home`.
3. Click **one** sidebar item in the live browser, wait for it to settle, then capture:
   ```text
   capture IP | Expanded IP submenu
   ```
4. Click one submenu, tab, row, dialog opener, close control, or pagination control. Capture each resulting state, including intermediate menu expansion:
   ```text
   capture IP / Firewall
   capture IP / Firewall / Filter Rules
   capture IP / Firewall / Filter Rules / Rule details
   ```
   These commands only save what is on screen; they do not navigate for you. Execute the corresponding **real click before each capture**. They are example labels, not a promise about version-specific menus.
5. Repeat through every depth you want students to explore. Capture backward navigation and alternate branches too. There is no fixed menu-depth limit.
6. `pause` before any sensitive work; `arm` and make a fresh baseline capture to resume. The recorder deliberately does not join transitions across a pause.
7. `status` shows coverage. `drop` deletes the last state if it needs recapturing.
8. `export` writes **one HTML**; `quit` closes the browser. Export periodically: captures are in memory until export, and quit/crash does not auto-save. No resume/import feature yet.
9. Open the HTML locally in current Chromium or Firefox, inspect every page and the coverage panel, and review privacy before sharing.

> **Live actions are real.** The recorder does not automatically click, configure, install packages, apply, delete, reboot, or reset anything. Any action *you* click while recording can change the live router. Use an isolated disposable CHR, never a production router.

## What “interactive” means

- Actual captured page elements, not a hand-drawn WebFig lookalike, form the main viewer.
- A click works if its outcome was captured after exactly one observed control click from that state. Multiple clicks between captures do **not** invent a link. Noninteractive clicks also break the edge, so recapture a baseline if needed.
- Menus, nested tabs, rows, dialogs, and pagination can all be explored when captured. The page list, search, back, next-step, and coverage controls also work offline.
- Unrecorded controls explain that no outcome was saved. They do not call a router or fabricate configuration behavior. Form fields are read-only.
- Original RouterOS scripts, handlers, URLs, forms, session data, and active embeds are removed. A sandboxed frame plus restrictive CSP disables script execution, requests, submissions and active content in captured pages. The viewer uses only its own hash-authorized local script.
- All states are gzip-embedded in the HTML. No CDN, iframe pointed at a live router, local server, adjacent asset directory, or Internet connection is needed. Modern browser `DecompressionStream` support is required.

## Coverage: no false “all menus” claim

RouterOS version, packages, hardware, privileges, empty tables, and configuration affect available menus. A finite walkthrough cannot discover every possible dialog or feature state automatically.

Pass your own exact required page paths to check the intended scope:

```json
{
  "routerOSVersion": "enter the actual version you verify",
  "maxStates": 250,
  "requiredPaths": [
    "WebFig / Home",
    "IP / Firewall / Filter Rules",
    "System / Resources"
  ],
  "redactSelectors": ["#your-verified-sensitive-region"]
}
```

```sh
node bin/webfig-archive.mjs --url http://127.0.0.1:8080/webfig/ \
  --config /private/path/lab-config.json --strict \
  --output captures/routeros.html
```

The manifest is a checklist **you supply**, not a hardcoded “complete WebFig map.” `--strict` refuses export until each path has a captured state, but it does not certify all controls or unseen menus. An empty manifest cannot pass strict mode. The HTML always reports unrecorded observed controls and missing required paths. Paths are operator-assigned; mislabelling them can invalidate the checklist. See [capture protocol](docs/capture-protocol.md).

## Privacy and visual fidelity limits

- Form values are omitted by default. Add `--include-form-values` only for a sanitized lab where students need nonsecret recorded settings. Password/hidden/secret-labelled fields are still redacted, including common sensitive table columns.
- Use `redactSelectors` to remove whole sensitive page regions. Invalid selectors abort capture. Use `--redact-file /private/path/secrets` for one literal secret per line; this file is read into memory only. Never put it in this repository. Literal replacement applies to captured HTML, labels, paths and notes, but is not a general encoded-secret detector.
- Automatic redaction **cannot guarantee** every RouterOS secret is found. Plain text, unusual labels, encoded text, raster images, CSS-generated content, IPs, usernames, serial numbers, and operator-supplied metadata can still identify a lab. Visually review and audit the final HTML. Don't capture a screen displaying QR codes or other image-encoded credentials.
- Same-origin raster images already loaded by the browser are embedded with size limits. No additional asset fetches are made. Missing images are omitted. Custom fonts, canvas, SVG, shadow DOM and subframes are not currently preserved. Unsupported embedded components generate warnings. Computed styles do not fully preserve media queries or scroll positions; use the recorded desktop viewport for best fidelity.
- Only the main browser tab is captured. Popups are closed, downloads rejected, third-party origins blocked. A WebFig version relying on other origins will need a reviewed adapter; it is not silently allowed.
- Initial login/password change and QEMU console screens are intentionally outside this first WebFig tool. Do not claim they were captured. Vendor branding/assets remain MikroTik's; this is not an official MikroTik product. Share captures only where permitted.
- Archives are written with private file permissions (0600) and private newly-created parent directories (0700 on POSIX). Browser memory and the final HTML can still contain lab data. Defaults cap at 250 states (configurable up to 1000) and 128 MiB uncompressed export. Keep captures and VM disks out of Git.

## Development / tests

```sh
npm ci
npx playwright install --with-deps chromium
npm run check
npm test
# Or use an existing Chromium:
CHROMIUM_PATH=/path/to/chromium npm test
```

Tests capture a local **test-only fixture**, export it, open the generated HTML using `file://` in a fresh offline browser context, click nested recorded states, verify privacy canaries are absent, ensure unrecorded actions do not execute, and check no HTTP(S) requests are attempted. Also tested: missing manifests, strict export, pause boundaries, multiple-click rejection, redaction failures, form value controls, and state limits. CI installs Chromium and runs the same checks.
