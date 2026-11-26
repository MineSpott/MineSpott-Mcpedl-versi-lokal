# Golden HUB — Final project starter

Golden HUB is a Minecraft Bedrock community platform with a light/off-white and soft-gold visual identity. The frontend is split into individual HTML pages, CSS, and JavaScript modules. The included Node/Express backend provides real username/password authentication, roles, one-time invite codes, private upload staging, and Owner approval before content publication.

## Requirements
- Node.js 20+
- A server with persistent disk storage (the JSON database and uploaded files are stored locally).

## Run locally
1. Copy `.env.example` to `.env` (or set the environment variables in your terminal/hosting provider).
2. Set a **new strong Owner password** in `OWNER_PASSWORD`; use `MineSpott` as `OWNER_USERNAME` if desired. Never put the password in frontend files or commit `.env`.
3. Set a long random `SESSION_SECRET` (at least 32 characters in production).
4. Install and run:
   ```bash
   npm install
   npm start
   ```
5. Open `http://localhost:3000`.

The Owner account is seeded once on first startup. If no Owner exists and `OWNER_PASSWORD` is missing, the server will warn and will not create the Owner account.

## Roles and approval
- Visitor: browse and download published content.
- Creator: submit content and view own submissions.
- Admin: reserved role for moderation expansion; cannot approve accounts, generate invites, or access Owner routes.
- Owner: full control. The Owner can approve/reject Creator registrations, generate one-time invite codes, change Creator/Admin roles, and approve/reject content submissions.
- Public registration enters `pending` state. A valid unused invite code activates the Creator account immediately. Invite codes are random, single-use, and expire after 30 days by default.
- Uploads are stored privately until the Owner approves them. Only then are the thumbnail, media, and content package moved to public storage.

## Upload rules
- Thumbnail: PNG/JPG/WebP, max 5 MB (client-side check; server has a 100 MB global file limit).
- Main package: `.mcaddon`, `.mcpack`, `.mcworld`, `.mcstructure`, `.mcfunction`, `.js`, or `.zip`.
- Description media: up to 8 image/video files; accepted images PNG/JPG/WebP and videos MP4/WebM.
- Do not upload files you do not own or have permission to distribute. Review files before approving them.

## Important deployment notes
- This project requires a Node.js host with persistent writable storage. GitHub Pages alone cannot run the backend, authenticate users, store uploads, or enforce roles.
- The included session store uses Express's default in-memory store for local development. For a public production deployment, configure a persistent session store (for example Redis or a database-backed session store), HTTPS, backups, and an external object-storage service for uploads.
- JSON-file storage is suitable as a small single-instance starter, not a high-traffic multi-instance database. Migrate to PostgreSQL or another managed database before scaling.
- Keep `storage/`, `.env`, and private pending uploads out of public static hosting and source control.
- OAuth buttons for Google and Discord are intentionally not included. Login is username/password only.
- Sample/demo content is not inserted as real published downloads. The public catalogue populates from Owner-approved uploads.

## Pages
- `index.html`: homepage, featured/latest/popular/updated sections, sidebar.
- `category.html`: category browsing, search, sorting.
- `detail.html`: content detail, creator attribution, media gallery, download.
- `profile.html`: Creator profile and published content.
- `login.html`, `register.html`: username/password auth and optional invite code.
- `upload.html`, `dashboard.html`: Creator submission form and dashboard.
- `owner.html`: Owner approvals, role management, invite generation, activity log.
- `about.html`: Golden HUB introduction (opened from the logo/footer).
