# Hotel Ordering System

Harbor House is a responsive in-room dining site with a guest menu, saved orders, private order tracking, and an authenticated hotel staff dashboard. It runs locally without a package install or an external database service.

## Run locally

Requirements: Node.js 22.13 or later. Node 24 is recommended. The built-in `node:sqlite` module stores data in `data/hotel.sqlite`.

In PowerShell or a terminal opened in this folder:

```powershell
node server.js
```

You can also run `npm.cmd start` on Windows if PowerShell's script policy blocks `npm`. Open [http://localhost:3000](http://localhost:3000). Set `PORT` to change the port.

Local staff login:

- Email: `admin@harborhouse.test`
- Password: `RoomService2026!`

These are demo credentials for local development. To create the first admin account with your own credentials, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the very first start. In PowerShell:

```powershell
$env:ADMIN_EMAIL = "staff@yourhotel.com"
$env:ADMIN_PASSWORD = "Use-a-long-unique-password"
node server.js
```

The first admin password is salted and hashed with Node's `scrypt`; it is not stored in plaintext in the database. Changing the environment variables later does not replace an existing admin account. The database can be reset for local development by stopping the server and removing `data/hotel.sqlite`.

## Database and persistence

The app uses SQLite because PHP and MySQL are not installed in this development environment. `database/schema.sql` defines the relational tables and constraints; `database/seed.sql` contains the ten sample dishes. The server automatically creates the schema and inserts the sample menu on first run. Orders, item snapshots, payment records, and status history are committed together. Menu changes and uploaded images persist across restarts.

The database tables are `admins`, `menu_items`, `orders`, `order_items`, `payment_records`, and `order_status_history`. Prices are stored as whole Philippine pesos. Only delivered orders count toward revenue. Guests receive a random, private tracking token when an order is saved; the server stores only its hash, and the browser keeps the token with that guest's local order history.

## Payments and photos

Cash to room and cash at the hotel counter are recorded as pending payments for staff to settle. GCash is available as a payment selection, but this project does not collect or verify GCash payments. Completing that integration requires a hotel merchant account, payment-provider API credentials, a verified callback/webhook, and provider-specific reconciliation; until configured, staff must verify payment outside the site before marking it as paid.

Sample food photography, web fonts, and the menu QR library load from external CDNs. Internet access is needed for those remote assets. The QR code points to the current site address with the menu route selected; to scan it from a phone during local development, open the app using the computer's LAN IP address instead of `localhost`. Staff can upload JPG, PNG, or WebP menu photos (maximum 3 MB); uploaded files are stored under `public/uploads`.

## Deployment notes

The in-memory staff sessions expire after eight hours and are invalidated when the Node process restarts. Use HTTPS in production; the session cookie is marked `Secure` when `NODE_ENV=production`. Production startup refuses to use the demo credentials and requires both `ADMIN_EMAIL` and `ADMIN_PASSWORD` to initialize an admin on a new database. Keep `data/` and uploaded menu photos on persistent storage, back them up, and do not expose the SQLite file publicly. The included HTTP server is intended for a college project and local deployment; production use should put it behind a maintained HTTPS reverse proxy with operational backups and monitoring.