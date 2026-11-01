# ShopLink Backend

The backend for **ShopLink**, a small internet shop whose customers come from TikTok, Instagram and Telegram.
It is an API only (the website lives in a separate project), built with **NestJS**, **Prisma** and **TypeScript** on PostgreSQL.
Any number of projects (website, Telegram bot, mobile app) can use it over HTTP.

## Quick start

1. Install PostgreSQL.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, e.g.
   `postgresql://postgres:YOUR_PASSWORD@localhost:5432/shoplink`.
   If PostgreSQL runs from a data folder on this PC, also set `PGDATA` to that folder:
   `npm run dev` then starts it for you whenever it is down.
3. Run:

```bash
npm install
npm run dev      # starts PostgreSQL if needed, applies migrations, runs the API with auto-reload
npm run seed     # optional: adds 4 sample products
```

- Swagger (try every endpoint): http://localhost:4000/docs (the port is `PORT` in `.env`)
- Admin account in development: `admin@shoplink.com` / `admin12345`

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start PostgreSQL if needed, apply migrations, run the API in watch mode |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled API |
| `npm test` | End-to-end tests against a temporary Postgres schema (your data is never touched) |
| `npm run db:migrate` | Apply migrations (what `dev` does first) |
| `npm run db:new-migration -- --name add_x` | After editing `prisma/schema.prisma`: create a new migration |
| `npm run db:studio` | Browse the data in Prisma Studio |
| `npm run seed` | Add sample products to an empty catalog |
| `npm run typecheck` | TypeScript check without building |

## Project layout

```
prisma/schema.prisma        database models (Prisma)
prisma/migrations/          SQL migrations
src/main.ts                 entry point
src/app.ts                  Nest app setup: Swagger, helmet, CORS, validation, error format
src/auth/                   register, login, Telegram login, JWT guards, /me
src/products/               product catalog
src/orders/                 orders, stock reservation, status workflow
src/common/                 validation rules, error format, serializers, Swagger response types
src/database/               Prisma service, PostgreSQL auto-start
scripts/                    db-up (migrations) and seed
test/                       end-to-end tests (node:test)
```

## Features

- **Customers** register with an email or phone number and record where they came from
  (`source`: `tiktok`, `instagram`, `telegram`, `other`) along with their social username.
- **Telegram login:** the Login Widget (for a website) and Mini Apps (a shop that opens inside Telegram).
  Set `TELEGRAM_BOT_TOKEN` to turn it on.
- **TikTok and Instagram login** (OAuth). Set the `TIKTOK_*` / `INSTAGRAM_*` values in `.env` to turn them on
  (see "Log in with TikTok / Instagram" below).
- **Products:** name, description, price, rating, stock (how many are left), sizes, colors and an image URL.
  You can search, filter, sort and page through them. Only admins can change products.
- **Orders:** the customer picks a size and color for each item. Stock is reserved when the order is placed and
  returned if the order is cancelled. Each order keeps the price and name the product had when it was ordered.
  Status flow: `new → confirmed → shipped → delivered`, and an order can be cancelled while `new` or `confirmed`.
- **Errors** always look like `{ "message": "Validation failed", "errors": ["email must be a valid email"] }`.
- **Security:** passwords are hashed with bcrypt, logins use JWT, login attempts are rate-limited,
  Helmet and CORS are enabled, every input is validated, and all SQL is parameterized.

## API

| Method | Path | Who | Description |
|---|---|---|---|
| POST | /api/auth/register | anyone | Register (email or phone + password) |
| POST | /api/auth/login | anyone | Log in with `login` (email or phone) + `password` |
| POST | /api/auth/telegram | anyone | Log in with the Telegram Login Widget |
| POST | /api/auth/telegram-webapp | anyone | Log in from a Telegram Mini App (`initData`) |
| GET | /api/auth/tiktok/url | anyone | Where to send the user to log in with TikTok |
| POST | /api/auth/tiktok | anyone | Log in with TikTok (`code` from the redirect) |
| GET | /api/auth/instagram/url | anyone | Where to send the user to log in with Instagram |
| POST | /api/auth/instagram | anyone | Log in with Instagram (`code` from the redirect) |
| GET / PATCH | /api/auth/me | user | View or update my profile |
| PUT / DELETE | /api/auth/me/avatar | user | Upload / remove my profile picture (form field `image`) |
| GET | /api/users/stats | admin | How many people registered and logged in (today / 7 / 30 days, per day) |
| GET | /api/users | admin | All users with last login, login count and order count (search, filter, sort) |
| GET | /api/users/logins | admin | Login history, newest first |
| GET | /api/users/logins/{id} | admin | One login record |
| GET | /api/users/{id} | admin | One user with their last 20 logins |
| GET | /api/products | anyone | List products (filters: `search`, `minPrice`, `maxPrice`, `minRating`, `size`, `color`, `inStock`, `sellerId`, `sort`, `page`, `limit`) |
| GET | /api/products/mine | user | The products I sell |
| GET | /api/products/{id} | anyone | Get one product |
| POST | /api/products | user | Sell a product (you become its seller) |
| PATCH | /api/products/{id} | seller or admin | Update a product |
| DELETE | /api/products/{id} | seller or admin | Delete a product |
| PUT / DELETE | /api/products/{id}/image | seller or admin | Upload / remove the product picture (form field `image`) |
| GET | /api/wishlist | user | My wishlist |
| GET | /api/wishlist/{id} | user | One wishlist item |
| POST | /api/wishlist | user | Add a product (`productId`); adding it twice is fine |
| DELETE | /api/wishlist/{id} | user | Remove by wishlist item id |
| DELETE | /api/wishlist/product/{productId} | user | Remove by product id |
| DELETE | /api/wishlist | user | Empty my wishlist |
| GET | /api/cart | user | My cart with totals |
| GET | /api/cart/{id} | user | One cart item |
| POST | /api/cart | user | Add (`productId`, `quantity`, `size`, `color`); same product/size/color adds up |
| PATCH | /api/cart/{id} | user | Change quantity |
| DELETE | /api/cart/{id} | user | Remove a cart item |
| DELETE | /api/cart | user | Empty my cart |
| POST | /api/cart/checkout | user | Order everything in the cart (`address`, optional `phone`, `customerName`, `comment`) |
| POST | /api/orders | user | Place an order |
| GET | /api/orders | user | My own orders (also for admins) |
| GET | /api/orders/all | admin | Everyone's orders (`userId`, `status` filters) |
| GET | /api/orders/number/{orderNumber} | user | Find my order by its number, e.g. `SL-7K3F9QX2` (admins: any) |
| GET | /api/orders/sales | user | Orders for my products (only my items, `total` for my items) |
| GET | /api/orders/sales/{id} | user | One of my sales |
| GET | /api/orders/{id} | user | Get one order |
| POST | /api/orders/{id}/cancel | user | Cancel my order while it is `new` |
| PATCH | /api/orders/{id}/status | admin | Change an order's status |

Send the token as `Authorization: Bearer <token>`. Swagger at http://localhost:4000/docs documents every endpoint and lets you try them (the raw spec is `/openapi.json`).

### Example product

```json
{
  "name": "Oversize Hoodie",
  "description": "Warm cotton hoodie",
  "price": 249000,
  "rating": 4.7,
  "stock": 25,
  "sizes": ["S", "M", "L", "XL"],
  "colors": ["black", "beige"],
  "imageUrl": "https://example.com/hoodie.jpg"
}
```

## Pictures

Upload as `multipart/form-data` with the file in the field `image` (JPEG, PNG, WebP or GIF, up to 5 MB; the
file's real type is checked). Files are saved in `UPLOAD_DIR` (default `uploads/`) and served at `/api/uploads/...`.
The old file is deleted when a picture is replaced or removed.

Without a picture, `imageUrl` / `avatarUrl` point to a default: a gray "No image" picture for products and a
colored circle with the user's initials for users. `hasImage` / `hasAvatar` say whether it's a real picture.
The URLs start with `/api/`, so they also work through the shop's `/api` proxy.

## Users and login stats

Every successful register and login (password, Telegram, TikTok, Instagram) is saved in the `logins` table, and each
user keeps `lastLoginAt` and `loginCount`. Admins see it in Swagger under **Users (admin)**: log in as admin, click
**Authorize**, then call `GET /api/users/stats`. "Today" uses `STATS_TIME_ZONE` (default `Asia/Tashkent`).
Logins before this feature was added weren't recorded, so older users start at 0.

## Log in with TikTok / Instagram

1. Create the app with the provider and register a **redirect URI**, a page on your website such as
   `https://shoplink.uz/auth/tiktok`:
   - **TikTok:** https://developers.tiktok.com, add *Login Kit* (Web) with the scopes `user.info.basic` and
     `user.info.profile` (the second one gives the username). Put the client key and secret in
     `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` and the redirect URI in `TIKTOK_REDIRECT_URI`.
   - **Instagram:** https://developers.facebook.com, create an app with *Instagram API with Instagram Login*.
     Put the Instagram app ID and secret in `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` and the redirect URI in
     `INSTAGRAM_REDIRECT_URI`. **Only professional (Business or Creator) Instagram accounts can log in.**
     Instagram no longer offers login for personal accounts.
2. On the website: make a random `state`, remember it (e.g. in `sessionStorage`), call
   `GET /api/auth/tiktok/url?state=...` and send the user to the `url` it returns.
3. The provider sends the user back to the redirect page with `?code=...&state=...`. Check that `state` matches,
   then `POST /api/auth/tiktok` with `{ "code": "..." }`. You get the same `{ token, user }` as a normal login.
   The first login creates the user, with `source` set to `tiktok` / `instagram` and their username saved.

Instagram works the same way with `/api/auth/instagram/url` and `POST /api/auth/instagram`.

## Deploying

1. Copy `.env.example` to `.env`.
2. Set `NODE_ENV=production`, a long random `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
   The server refuses to start in production without `JWT_SECRET`.
3. If you host behind a proxy (Render, Railway, Nginx and similar), set `TRUST_PROXY=1`.
4. Set `CORS_ORIGIN` to your frontend's address, for example `https://shoplink.uz`.
5. Create a PostgreSQL database on your host (Render, Railway, Neon, Supabase...) and put its URL in `DATABASE_URL`.
6. Build with `npm run build`, apply migrations with `npx prisma migrate deploy`, then run `npm start`.

Requires Node.js 20.19 or newer.
# shoplink
# backend_shoplink
