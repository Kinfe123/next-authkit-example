import { Connection, WorkOS } from "@workos-inc/node";
import { auth } from "../src/lib/auth";
import { generateRandomString, symmetricEncrypt } from "better-auth/crypto";

interface WorkOSListResponse<T> {
  data: T[];
  listMetadata: {
    before: string | null;
    after: string | null;
  };
}

interface WorkOSUser {
  object: "user";
  id: string;
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
  createdAt: string;
  updatedAt: string;
  externalId: string | null;
  metadata: Record<string, any>;
}

interface WorkOSAuthFactor {
  object: "authentication_factor";
  id: string;
  type: "totp" | "sms" | "email";
  createdAt: string;
  updatedAt: string;
  totp_configuration?: {
    qr_code: string;
    secret: string;
  };
  sms_configuration?: {
    phoneNumber: string;
  };
  email_configuration?: {
    email: string;
  };
}

interface WorkOSConnection {
  object: "connection";
  id: string;
  organizationId: string;
  connectionType: string;
  name: string;
  state: "active" | "inactive";
  domains: string[];
  createdAt: string;
  updatedAt: string;
}

interface WorkOSSession {
  object: "session";
  id: string;
  userId: string;
  clientId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

if (!process.env.WORKOS_API_KEY || !process.env.WORKOS_CLIENT_ID) {
  throw new Error("Missing required environment variables WORKOS_API_KEY and/or WORKOS_CLIENT_ID");
}

const workos = new WorkOS(process.env.WORKOS_API_KEY);

const safeDateConversion = (date: string | number | null | undefined) => {
  if (!date) return new Date();
  return new Date(date);
};

// Helper function to generate backup codes for 2FA
async function generateBackupCodes(secret: string) {
  const backupCodes = Array.from({ length: 10 })
    .fill(null)
    .map(() => generateRandomString(10, "a-z", "0-9", "A-Z"))
    .map((code) => `${code.slice(0, 5)}-${code.slice(5)}`);

  const encCodes = await symmetricEncrypt({
    data: JSON.stringify(backupCodes),
    key: secret,
  });
  return encCodes;
}

// Main migration function
async function migrateFromWorkOS() {
  const ctx = await auth.$context;
  let totalUsers = 0;
  let migratedUsers = 0;
  let failedUsers = 0;

  let hasMoreUsers = true;
  let before: string | undefined;
  const limit = 100;

  while (hasMoreUsers) {
    try {
      const response = await workos.userManagement.listUsers({
        limit,
        before,
      }) as WorkOSListResponse<WorkOSUser>;

      const workosUsers = response.data;
      console.log(`Fetched ${workosUsers.length} users`);

      before = response.listMetadata.before || undefined;
      hasMoreUsers = workosUsers.length === limit;
      totalUsers += workosUsers.length;

      for (const workosUser of workosUsers) {
        try {
          console.log(`\nProcessing user: ${workosUser.email}`);
          console.log(workosUser);

          const authFactorsResponse = await workos.userManagement.listAuthFactors({
            userId: workosUser.id,
          }) as WorkOSListResponse<WorkOSAuthFactor>;
          
          const authFactors = authFactorsResponse.data;
          console.log(`Found ${authFactors.length} auth factors`);

          const createdUser = await ctx.adapter.create({
            model: "user",
            data: {
              id: workosUser.id,
              email: workosUser.email,
              emailVerified: workosUser.emailVerified,
              name: `${workosUser.firstName || ''} ${workosUser.lastName || ''}`.trim() || workosUser.email,
              image: workosUser.profilePictureUrl,
              createdAt: safeDateConversion(workosUser.createdAt),
              updatedAt: safeDateConversion(workosUser.updatedAt),
              role: "user",
              banned: false,
              twoFactorEnabled: authFactors.some(f => f.type === "totp"),
              username: workosUser.email.split("@")[0],
              phoneNumber: authFactors.find(f => f.type === "sms")?.sms_configuration?.phoneNumber,
              phoneNumberVerified: !!authFactors.find(f => f.type === "sms")
            },
            forceAllowId: true
          });

          for (const factor of authFactors) {
            if (factor.type === "totp" && factor.totp_configuration) {
              await ctx.adapter.create({
                model: "twoFactor",
                data: {
                  userId: createdUser.id,
                  secret: factor.totp_configuration.secret,
                  backupCodes: await generateBackupCodes(factor.totp_configuration.secret)
                },
                forceAllowId: true
              });
              console.log('Migrated 2FA settings');
            }
          }

          migratedUsers++;
          console.log(`Successfully migrated user: ${workosUser.email}`);
        } catch (error) {
          console.error(`Failed to migrate user ${workosUser.email}:`, error);
          failedUsers++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
      break;
    }
  }

  console.log(`
Migration Summary:
- Total Users: ${totalUsers}
- Successfully Migrated: ${migratedUsers}
- Failed: ${failedUsers}
`);
}

// Run the migration
migrateFromWorkOS().catch(console.error); 