# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private reporting instead:

**Security** tab → **Report a vulnerability** (https://github.com/JorGois/MapMyRideGPS/security/advisories/new).

Please include the steps to reproduce, the browser and OS, and what an attacker could achieve. You should get a reply within 7 days. This is a hobby project, so fixes are best effort.

## Supported versions

Only the latest version on `main` (the one deployed to GitHub Pages) is supported.

## Scope and design

- **In scope:**
  - the web app in `app/`;
  - the Cloudflare Worker in `cloudflare/`;
  - the GitHub Actions workflows.
- **Out of scope:**
  - iGPSPORT's own servers, firmware and map files;
  - problems that need someone to already control your computer or browser.
- **How it's built:**
  - **No backend and no accounts.** The app is static files. Your files and the folder access you grant stay in your browser.
  - **Folder access** uses the browser's File System Access permission prompts. The app can only touch folders you choose.
  - **Content-Security-Policy:** production builds set one that allows scripts only from the app itself.
  - **Download proxy:** the worker forwards only GET/HEAD requests for map ZIP paths on one iGPSPORT storage host, only for allowed origins, and doesn't follow redirects.
  - **CI:**
    - third-party GitHub Actions are pinned to commit SHAs;
    - workflows run with least-privilege permissions;
    - Dependabot and CodeQL are enabled;
    - `npm audit` runs on every deploy.
