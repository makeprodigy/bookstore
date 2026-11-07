# Bookstore

Private, self hosted PDF reading with Supabase Auth, Storage, and Postgres.

## Local development

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Set these values in `.env.local` from Supabase **Settings → API**:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
```

Use the project root URL only—do not append `/rest/v1`. Never use a Supabase secret or service-role key in this app.

## Deploy to Vercel

1. Push this project to GitHub when you are ready.
2. In Vercel, import the repository. Vercel detects Next.js automatically.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Production, Preview, and Development. Use the same public values as local development.
4. Deploy. Confirm that `/login`, `/library`, a PDF upload, and `/read/[id]` work at the generated URL.
5. Attach a custom domain in Vercel, then repeat the production checks on that domain.

## Supabase Auth URL checklist

In **Authentication → URL Configuration**:

- Set **Site URL** to your production URL, for example `https://bookstore.example.com`.
- Add `http://localhost:3000/**` and `http://127.0.0.1:3000/**` to **Redirect URLs** for local development.
- Add `https://your-project.vercel.app/**` for the production deployment.
- Add `https://*-your-vercel-team.vercel.app/**` if preview deployments need authentication.
- Add your custom production domain, for example `https://bookstore.example.com/**`, after it is connected.

## PWA install check

1. Visit the deployed HTTPS site in Safari on iPad/iPhone.
2. Choose **Share → Add to Home Screen**.
3. Open the installed app and sign in. It should launch standalone with the Bookstore icon.

The app is installable but intentionally does not cache PDFs for offline reading; offline caching remains stretch scope.
