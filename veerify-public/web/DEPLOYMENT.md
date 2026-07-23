# Veerify Public Site — Deployment Guide

Landing page + six Play-Store-mandated legal pages for `veerifyapp.com`. The existing admin dashboard at `/admin` is untouched.

## Files in this bundle

```
├── package.json                       # Vite + React + Router
├── vite.config.js                     # Build config, dev proxy to :5000
├── index.html                         # Vite entry HTML
├── nginx.conf                         # Production nginx routing
└── src/
    ├── main.jsx                       # ReactDOM entry
    ├── App.jsx                        # Router + route table
    └── pages/
        ├── LandingPage.jsx            # /
        ├── PrivacyPolicy.jsx          # /privacy-policy
        ├── TermsAndConditions.jsx     # /terms-and-conditions
        ├── RefundCancellationPolicy.jsx  # /refund-cancellation-policy
        ├── ChildSafety.jsx            # /child-safety
        ├── AccountDeletion.jsx        # /account-deletion
        ├── Contact.jsx                # /contact
        ├── VeerifyHeader.jsx          # Shared header
        └── VeerifyFooter.jsx          # Shared footer with legal links
```

## Local dev

```bash
mkdir veerify-public && cd veerify-public
# Copy every file above into this folder (index.html + package.json at root;
# everything else under src/pages/ except main.jsx which is src/main.jsx).

npm install
npm run dev
```

Then open:
- `http://localhost:5173/` — landing page
- `http://localhost:5173/privacy-policy` — legal
- `http://localhost:5173/terms-and-conditions` — legal
- (etc.)

The dev server proxies `/api/*` to your local backend on `:5000`, so a preview of the site can still hit real endpoints if needed.

## Production build

```bash
npm run build
# Output → dist/
```

## Deploying to the VPS

### Step 1 — Upload the built bundle

```bash
# Locally
scp -r dist/* user@server:/tmp/veerify-public-dist/

# On the server
sudo mkdir -p /var/www/veerify-public/dist
sudo cp -r /tmp/veerify-public-dist/* /var/www/veerify-public/dist/
sudo chown -R www-data:www-data /var/www/veerify-public
```

### Step 2 — Confirm the admin build location

The nginx config expects the existing admin dashboard at:
```
/var/www/veerify-admin/dist
```

If yours lives elsewhere, edit the `alias` line inside the `location /admin { ... }` block of `nginx.conf`. Common alternatives:
- `/var/www/admin/dist`
- `/home/deploy/veerify-admin/build`

### Step 3 — Install the nginx config

```bash
sudo cp nginx.conf /etc/nginx/sites-available/veerifyapp.com
sudo ln -sfn /etc/nginx/sites-available/veerifyapp.com \
             /etc/nginx/sites-enabled/veerifyapp.com

# Dry-run: catches typos before touching production traffic
sudo nginx -t

# Apply
sudo systemctl reload nginx
```

### Step 4 — Verify

Open in an **incognito tab** (avoids cached admin sessions):

- `https://veerifyapp.com/` → landing page loads
- `https://veerifyapp.com/privacy-policy` → legal page loads
- Refresh on `/privacy-policy` → still loads (no 404)
- `https://veerifyapp.com/admin` → existing admin loads (unchanged)
- `https://veerifyapp.com/admin/login` → admin login loads
- Refresh on `/admin/dashboard` after signing in → dashboard reloads (no 404)
- `curl https://veerifyapp.com/api/plans` → backend responds

## Routing summary

| URL | Served by | try_files fallback |
|---|---|---|
| `/` | Landing bundle | `/index.html` |
| `/privacy-policy` | Landing bundle | `/index.html` |
| `/terms-and-conditions` | Landing bundle | `/index.html` |
| `/refund-cancellation-policy` | Landing bundle | `/index.html` |
| `/child-safety` | Landing bundle | `/index.html` |
| `/account-deletion` | Landing bundle | `/index.html` |
| `/contact` | Landing bundle | `/index.html` |
| `/admin` | Admin bundle (unchanged) | `/admin/index.html` |
| `/admin/*` | Admin bundle (unchanged) | `/admin/index.html` |
| `/api/*` | Express backend on `:5000` | — |
| `/uploads/*` | Express backend on `:5000` | — |

## Refresh handling — why it works

Both SPAs use their own `try_files` rule inside their `location` block:

- **Landing**: `try_files $uri $uri/ /index.html;` — any non-file path falls back to the landing bundle's `index.html`, which loads React Router, which resolves the URL against the route table in `App.jsx`.
- **Admin**: `try_files $uri $uri/ /admin/index.html;` — same idea, scoped to the admin build.

That's what makes `F5 on /privacy-policy` and `F5 on /admin/dashboard` work identically to a direct navigation — no more 404s.

## Nothing you need to touch on the backend

The Express backend on `:5000` continues to serve `/api/*` and `/uploads/*` exactly as before. Nginx is the reverse proxy in front of everything.

## Play Store review checklist

Once deployed:
- Open each of the six legal URLs in an incognito tab. Every page loads without login.
- Verify the footer links on the landing page. All six should be clickable and go to the right pages.
- Fill in the **Data Safety** form on Google Play using the URL `https://veerifyapp.com/privacy-policy`.
- Fill in the **Account Deletion URL** field with `https://veerifyapp.com/account-deletion`.

## Content updates

Every page has a `LAST_UPDATED` constant at the top. When you update copy, bump the date — it propagates to the "Last updated" line in both the page body and the footer strip.

For material changes to Privacy Policy or Terms, the copy already commits us to a 7-day in-app + email notice period before the change takes effect.
