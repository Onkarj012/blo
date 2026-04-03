# Convex Migration Setup Instructions

## Completed Work

The following components have been set up for the Convex migration:

### Backend (Convex)
- ✅ Schema defined (`convex/schema.ts`) with tables:
  - `voters` - Main voter records with indexes
  - `importBatches` - Import tracking
  - `statusEvents` - Audit log for status changes
  - `appUsers` - Authentication
- ✅ Queries created:
  - `voters.getVoters` - List voters with filtering
  - `voters.getVoterById` - Get single voter
  - `voters.getVoterByEpicNumber` - Lookup by EPIC
  - `voters.getVoterByFingerprint` - Lookup by fingerprint
  - `clusters.getClustersSummary` - Progress tracking
  - `clusters.getMapClusters` - Map markers
  - `clusters.getAreaClusters` - Filter options
  - `import.getBatches` - Import history
  - `import.getBatchById` - Single batch
  - `users.getUserByUsername` - Auth lookup
  - `users.getUserById` - User details
- ✅ Mutations created:
  - `voters.updateStatus` - Update voter status with audit log
  - `voters.upsertVoter` - Single voter import
  - `voters.batchUpsertVoters` - Batch import (250 rows)
  - `import.createBatch` - Create import record
  - `import.updateBatchStats` - Update import stats
  - `users.createUser` - Create user
  - `users.updateUser` - Update user
  - `users.deleteUser` - Delete user

### API Routes (Next.js)
- ✅ Authentication routes:
  - `POST /api/auth/login` - Cookie-based login
  - `POST /api/auth/logout` - Clear session
  - `GET /api/auth/me` - Get current user
- ✅ Voter routes:
  - `GET /api/voters/nearby` - List voters with filters
  - `PATCH /api/voters/[id]/status` - Update status
- ✅ Cluster routes:
  - `GET /api/clusters/summary` - Progress cards
  - `GET /api/map-clusters` - Map markers
- ✅ Import route:
  - `POST /api/import-csv` - CSV import (admin only)

### Shared Utilities
- ✅ Authentication helpers (`src/lib/auth.ts`):
  - Password hashing with bcrypt
  - JWT session tokens
  - Cookie serialization
- ✅ Middleware (`src/lib/middleware.ts`):
  - `requireAuth` - Route protection
  - `requireAdmin` - Admin-only routes
- ✅ Normalization (`src/lib/normalize.ts`):
  - `buildDisplayAddress` - Clean addresses
  - `detectAreaCluster` - Extract area/society
  - `determineAddressQuality` - actionable/vague/missing
  - `buildRowFingerprint` - Identity matching
  - `buildSearchText` - Full-text search
  - `calculateGeocodeConfidence` - Confidence scoring

### Scripts
- ✅ `scripts/setup-admin.ts` - Create initial admin user
- ✅ `scripts/migrate-to-convex.ts` - Migrate SQLite data

## Next Steps

### 1. Start Convex Dev Server

```bash
npx convex dev
```

This will:
- Create a Convex deployment
- Generate the `convex/_generated/` directory with types
- Write `CONVEX_URL` to `.env.local`
- Watch for changes

Keep this running in a terminal while you work.

### 2. Configure Environment Variables

Copy the example file and set your JWT secret:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and set a strong `JWT_SECRET` (min 32 characters).

### 3. Create Admin User

Once `npx convex dev` is running:

```bash
npx tsx scripts/setup-admin.ts
```

Default credentials (change after first login):
- Username: `admin`
- Password: `changeme123`

### 4. Migrate Existing Data (Optional)

If you want to migrate existing SQLite data:

```bash
npx tsx scripts/migrate-to-convex.ts
```

### 5. Start Next.js Dev Server

```bash
npm run dev
```

### 6. Verify Setup

Visit http://localhost:3000 and test:
1. Login with admin credentials
2. Navigate to /upload to import CSV
3. Navigate to main page to see voters

## File Structure

```
convex/
  schema.ts              # Database schema
  voters.ts              # Voter queries/mutations
  clusters.ts            # Cluster queries
  import.ts              # Import mutations
  users.ts               # User management
  _generated/            # Auto-generated (run npx convex dev)

src/
  lib/
    auth.ts              # Password & session helpers
    middleware.ts        # Route protection
    convex-server.ts     # Server-side Convex client
    normalize.ts         # Address & data normalization
  app/
    api/
      auth/
        login/route.ts
        logout/route.ts
        me/route.ts
      voters/
        nearby/route.ts
        [id]/status/route.ts
      clusters/summary/route.ts
      map-clusters/route.ts
      import-csv/route.ts
    ConvexClientProvider.tsx  # React provider

scripts/
  setup-admin.ts         # Create admin user
  migrate-to-convex.ts   # SQLite → Convex migration
```

## Remaining Work (To Do)

### UI Components
- [ ] Update `field-shell.tsx` with new filters and locality progress cards
- [ ] Update `voter-card.tsx` with quick actions and optimistic updates
- [ ] Create map tab component with cluster markers
- [ ] Update upload page with admin-only protection and batch summaries
- [ ] Create login page

### Testing
- [ ] Unit tests for address normalization and rowFingerprint
- [ ] Integration tests for import and status workflows
- [ ] API contract tests

### Cleanup
- [ ] Remove SQLite dependencies after verification
- [ ] Archive old db.ts and import-cleaned-csv.ts

## Architecture Notes

### Authentication Flow
1. Browser POSTs credentials to `/api/auth/login`
2. Server validates against Convex `appUsers` table
3. Server creates JWT and sets HTTP-only cookie
4. Subsequent requests include cookie automatically
5. Middleware validates JWT and attaches user to request
6. Routes use `requireAuth`/`requireAdmin` wrappers

### Import Flow
1. Admin uploads CSV to `/api/import-csv`
2. Server parses CSV with `csv-parse`
3. Server normalizes each row with shared helpers
4. Server geocodes addresses (static map + optional Nominatim)
5. Server sends batches of 250 to Convex
6. Convex upserts by `epicNumber` then `rowFingerprint`
7. Status is preserved on existing voters

### Query Flow
1. Browser requests `/api/voters/nearby` with filters
2. Server queries Convex with filter params
3. Convex returns voters, counts, and clusterCounts
4. Server returns JSON to browser
5. UI shows locality progress cards and voter list

## Troubleshooting

### "Cannot find module './_generated/server'"
Run `npx convex dev` to generate the types.

### "CONVEX_URL environment variable is not set"
Run `npx convex dev` first, or copy the URL from `.env.local`.

### JWT errors
Make sure `JWT_SECRET` is set in `.env.local` and is at least 32 characters.

### Import fails with "batch too large"
The batch size is set to 250 rows. If you hit limits, reduce `BATCH_SIZE` in the import route.
