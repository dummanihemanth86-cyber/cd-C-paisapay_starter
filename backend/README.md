# Backend startup

The backend command in this folder now starts the current TypeScript API in `../server/`. Run the one-time dependency install, then start it here:

```powershell
cd C:\paisapay_starter\server
npm ci
npm run db:generate
cd ..\backend
npm start
```

`npm start` builds and starts the current API on port 4000 (unless `PORT` is set). Check `http://localhost:4000/health` and `http://localhost:4000/api/v1/docs`. Configure PostgreSQL in `server/.env` as explained in [`../server/README.md`](../server/README.md); without it, the server starts but database readiness and database-backed features remain unavailable.

The former in-memory server, `server.js`, is available only as an explicitly named demo with `npm run demo:start`. It uses port 3000 and is not the backend for the current mobile app.
