# inventory-diff sync server

Mojolicious::Lite + Redis server for syncing IITC inventory-diff snapshots across devices.

## How it works

- Clients POST their local snapshots to `POST /snapshots/:key`
- `:key` is a 64-char hex SHA-256 of `nickname+secret` — never sent in plaintext
- Server merges client snapshots with its own Redis store, returns the full merged set
- Snapshots older than 30 days are pruned automatically on every sync
- The Redis key itself expires after 30 days of no activity

## API

### `POST /snapshots/:key`

**Request:** JSON array of snapshot objects

```json
[
  { "timestamp": 1700000000000, "items": { "EMP_BURSTER 1": 42 }, "keys": {} },
  { "timestamp": 1699000000000, "deleted": true }
]
```

> **Note:** Item names use Niantic's native internal naming (`EMP_BURSTER`, `EMITTER_A`, `RES_SHIELD`, etc.).
> Translation to human-readable labels (e.g. "XMP Burster L1") is done in the plugin's presentation layer, not here.

**Response:** merged JSON array, sorted oldest → newest, trimmed to `INVDIFF_MAX_SNAPSHOTS`

- Snapshots with `deleted: true` are removed from the server store
- Snapshots older than 30 days are dropped

## Configuration

All config via environment variables:

| Variable               | Default                        | Description                          |
|------------------------|--------------------------------|--------------------------------------|
| `INVDIFF_PORT`         | `3000`                         | Port to listen on                    |
| `INVDIFF_REDIS_URL`    | `redis://redis:6379`           | Redis connection URL                 |
| `INVDIFF_CORS_ORIGIN`  | `https://intel.ingress.com`    | Allowed CORS origin                  |
| `INVDIFF_MAX_SNAPSHOTS`| `100`                          | Max snapshots retained per user      |
| `INVDIFF_TLS_CERT`     | *(empty)*                      | Path to TLS certificate file         |
| `INVDIFF_TLS_KEY`      | *(empty)*                      | Path to TLS private key file         |

## Deploy with Docker Compose

### Plain HTTP

```bash
cd server
docker compose up -d
```

Server listens on port 3000.

### With TLS (Let's Encrypt)

Create a `.env` file in `server/`:

```env
INVDIFF_PORT=3443
INVDIFF_TLS_CERT=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
INVDIFF_TLS_KEY=/etc/letsencrypt/live/yourdomain.com/privkey.pem
INVDIFF_CORS_ORIGIN=https://intel.ingress.com
```

Then:

```bash
docker compose up -d
```

The container mounts `/etc/letsencrypt` read-only, so the cert paths above work as-is on a standard certbot setup.

### Rebuild after code changes

```bash
docker compose up -d --build
```

## Data persistence

Redis data is stored in `server/localstorage/redis/` (bind mount). Safe to back up or inspect directly.

## Dependencies

Built into the Docker image (`perl:5.38-slim`):

- `Mojolicious`
- `Mojo::Redis`
- `IO::Socket::SSL` (required for TLS)
