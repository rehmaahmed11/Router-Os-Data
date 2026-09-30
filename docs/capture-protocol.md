# Real RouterOS capture acceptance protocol

This protocol is for the **later real-CHR capture stage**, not a claim that a router has already been captured. No VM disk or generated archive belongs in this PR.

## Before recording

- Obtain a supported, official CHR image and confirm its license terms/version. Use a disposable x86-64 QEMU VM with isolated networking and loopback-only management forwarding on the capture workstation. Do not bridge it into a production LAN.
- Complete first login and password change privately. Disable password-manager/autofill extensions; do not record credentials or console transcripts.
- Confirm your account can view all intended menus. Record the actual version in config and relevant installed packages in a nonsecret captured note.
- Review the sidebar for this exact version. Build `requiredPaths` from observed menu items, not a copied generic list. This tool does not install QEMU/CHR, bootstrap credentials, or assert that all sidebar items exist.

## Depth-first operator walkthrough

1. Arm and capture the initial visible page.
2. Expand one sidebar group and capture the expansion as a separate state.
3. Open a submenu and capture it. Visit each visible tab with a capture after each click.
4. For tables, decide which representative rows are in scope; open one row, capture every details tab, close and capture. Capture pagination where relevant. Empty tables do not demonstrate row-detail coverage.
5. Open add/edit dialogs only when safe on the disposable lab. Do not blindly click Apply/Delete/Reset. Capture dialogs, their subtabs and cancel/close outcomes. If a configuration change is part of the lesson, make it deliberately, explain its effect and capture the resulting state. Offline students cannot execute it.
6. Return through the recorded controls, capturing each step. Explore the next branch. Duplicate visual pages with distinct paths/notes are allowed; each capture is a separate state, not a deduplicated universal navigation model.
7. Add newly revealed paths to the manifest for the next run if needed. Hidden controls are not part of the observed-control inventory until visible at capture time.
8. Pause for every private entry. Resuming requires a new baseline; navigation across a pause is intentionally not linked.

## Quality gates before sharing

- Export with `--strict` for your reviewed manifest. Review all unrecorded controls. Mark exclusions explicitly in the lesson notes; do not label the archive “all RouterOS setups” unless its narrowly defined scope has actually been reviewed.
- In a fresh disconnected browser, open the HTML from disk and test each captured sidebar path, tab, detail pane, close/back action and pagination state. Confirm missing actions explain that they are unavailable.
- Review every visible state for private values, image-encoded credentials and identifying metadata. Redaction is defense in depth, not a security guarantee. Delete and recapture unsafe states. Do not rely on hiding them with CSS.
- Inspect developer-tools network activity while replaying. The archive must not contact the lab router or any external service.
- Compare each archive page with the actual browser at the recorded viewport. Report unsupported graphics, fonts, scroll position, clipped content, missing assets and version-specific behavior. A warning-free snapshot is not proof of perfect visual fidelity.
- Keep the RouterOS validation result separate from fixture test results. This tool's present tests establish mechanics, not vendor compatibility or exhaustive coverage.
