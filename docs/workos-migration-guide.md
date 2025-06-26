# Migrating from WorkOS to BetterAuth

This guide will help you migrate your authentication system from WorkOS to BetterAuth using the WorkOS Management API.

## Prerequisites

1. Install the required dependencies:
```bash
npm install better-auth @better-auth/cli @workos-inc/node
# or
yarn add better-auth @better-auth/cli @workos-inc/node
# or
pnpm add better-auth @better-auth/cli @workos-inc/node
```

2. Make sure you have your WorkOS API credentials:
```env
WORKOS_API_KEY=sk_xxxxx
WORKOS_CLIENT_ID=client_xxxxx
DATABASE_URL=your_database_url
```

## Step 1: Configure BetterAuth

Create or update your auth configuration file (e.g., `src/lib/auth.ts`):

```typescript
import { betterAuth } from "better-auth";
import { admin, twoFactor, phoneNumber, username } from "better-auth/plugins";

export const auth = betterAuth({
  database: {
    url: process.env.DATABASE_URL
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    // Configure your social providers here
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    // Add other providers as needed
  },
  // Add any plugins you need
  plugins: [
    admin(),
    twoFactor(),
    phoneNumber(),
    username()
  ],
});
```

## Step 2: Prepare Database Migration

1. Create the migration script directory:
```bash
mkdir -p scripts
```

2. Copy the migration script from this repository to `scripts/migrate-workos.ts`.

3. Update the database schema:
```bash
npx @better-auth/cli migrate
```

## Step 3: Run the Migration

The migration script uses the WorkOS Management API to:

1. Fetch users with pagination (100 users per page)
2. For each user:
   - Get detailed user profile
   - Get authentication factors (password hashes, 2FA)
   - Get OAuth connections
   - Get active sessions
   - Migrate all data to BetterAuth

Run the migration:
```bash
npx tsx scripts/migrate-workos.ts
# or
bun scripts/migrate-workos.ts
```

The script will migrate:
- User profiles (name, email, avatar, etc.)
- Password hashes from email authentication
- Two-factor authentication settings
- OAuth provider connections
- Active sessions
- User roles and permissions
- Phone numbers and usernames (if plugins enabled)

## Step 4: Update Your Application Code

### Authentication API Changes

Replace WorkOS authentication calls with BetterAuth equivalents:

```typescript
// Before (WorkOS)
const { user } = await workos.userManagement.authenticateWithCode({
  code,
  clientId: process.env.WORKOS_CLIENT_ID,
});

// After (BetterAuth)
const { user } = await auth.signIn.email({
  email,
  password,
});
```

### Social Authentication

```typescript
// Before (WorkOS)
const authorizationUrl = workos.userManagement.getAuthorizationUrl({
  provider: 'github',
  redirectUri: 'http://localhost:3000/callback',
  clientId: process.env.WORKOS_CLIENT_ID,
});

// After (BetterAuth)
const { url } = await auth.signIn.social({
  provider: "github",
  redirectUrl: "http://localhost:3000/callback"
});
```

### Session Management

```typescript
// Before (WorkOS)
const session = workos.userManagement.loadSealedSession({
  sessionData: req.cookies['wos-session'],
  cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
});

// After (BetterAuth)
const session = await auth.api.getSession({
  headers: request.headers
});
```

### Middleware Updates

Update your authentication middleware:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  if (sessionCookie && ["/login", "/signup"].includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!sessionCookie && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard", "/login", "/signup"]
};
```

## Step 5: Testing

Before deploying to production:

1. Test the migration in a staging environment
2. Verify user authentication flows
3. Check social login functionality
4. Confirm 2FA still works if enabled
5. Validate admin access and permissions
6. Test session management and token refresh

## Step 6: Cleanup

After confirming everything works:

1. Remove WorkOS dependencies:
```bash
npm remove @workos-inc/node
# or
yarn remove @workos-inc/node
# or
pnpm remove @workos-inc/node
```

2. Update environment variables:
- Remove WorkOS-specific variables (WORKOS_API_KEY, WORKOS_CLIENT_ID)
- Add BetterAuth configuration variables

## Troubleshooting

### Common Issues

1. **Rate Limiting**: The migration script uses pagination to handle rate limits when fetching users from WorkOS. If you encounter rate limiting issues, you may need to adjust the `limit` value in the script.

2. **Password Migration**: WorkOS uses bcrypt for password hashing, which is compatible with BetterAuth. The migration script preserves the password hashes.

3. **Session Issues**: The script migrates active sessions, but users might need to re-authenticate after migration.

4. **OAuth Connections**: Make sure all your OAuth providers are properly configured in BetterAuth before running the migration.

### Getting Help

If you encounter any issues:

1. Check the [BetterAuth documentation](https://docs.better-auth.com)
2. Join the [BetterAuth Discord community](https://discord.gg/better-auth)
3. Open an issue on [GitHub](https://github.com/better-auth/better-auth)

## Additional Resources

- [BetterAuth Documentation](https://docs.better-auth.com)
- [API Reference](https://docs.better-auth.com/api)
- [Plugin System](https://docs.better-auth.com/plugins)
- [Database Adapters](https://docs.better-auth.com/adapters) 