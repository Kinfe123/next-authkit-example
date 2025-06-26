import { WorkOS } from "@workos-inc/node";
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

interface WorkOSOAuthConnection {
  id: string;
  type: string;
  state: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  profile: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    scope?: string;
  };
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

async function migrateOrganizations(ctx: any) {
  let totalOrgs = 0;
  let migratedOrgs = 0;
  let failedOrgs = 0;
  const orgMap = new Map<string, string>(); // WorkOS org ID -> BetterAuth org ID

  let hasMoreOrgs = true;
  let before: string | undefined;
  const limit = 100;

  while (hasMoreOrgs) {
    try {
      const response = await workos.organizations.listOrganizations({
        limit,
        before,
      }) as any;
      const orgs = response.data;
      console.log(`Fetched ${orgs.length} organizations`);
      before = response.listMetadata?.before || undefined;
      hasMoreOrgs = orgs.length === limit;
      totalOrgs += orgs.length;

      for (const org of orgs) {
        try {
          console.log(`\nProcessing organization: ${org.name}`);

          const createdOrg = await ctx.adapter.create({
            model: "organization",
            data: {
              id: org.id,
              name: org.name,
              slug: org.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
              createdAt: safeDateConversion(org.createdAt),
              updatedAt: safeDateConversion(org.updatedAt)
            },
            forceAllowId: true
          });

          orgMap.set(org.id, createdOrg.id);
          migratedOrgs++;
          console.log(`Successfully migrated organization: ${org.name}`);
        } catch (error) {
          console.error(`Failed to migrate organization ${org.name}:`, error);
          failedOrgs++;
        }
      }
    } catch (error) {
      console.error("Failed to fetch organizations:", error);
      break;
    }
  }

  return orgMap;
}

async function migrateFromWorkOS() {
  const ctx = await auth.$context;
  let totalUsers = 0;
  let migratedUsers = 0;
  let failedUsers = 0;

  // First migrate organizations
  console.log("Starting organization migration...");
  const orgMap = await migrateOrganizations(ctx);
  console.log("Organization migration completed.");

  let hasMoreUsers = true;
  let before: string | undefined;
  const limit = 100;

  while (hasMoreUsers) {
    try {
      const response = await workos.userManagement.listUsers({
        limit,
        before,
      }) as any;
      
      const workosUsers = response.data;
      console.log(workosUsers);
      console.log(`Fetched ${workosUsers.length} users`);

      before = response.listMetadata?.before || undefined;
      hasMoreUsers = workosUsers.length === limit;
      totalUsers += workosUsers.length;

      for (const workosUser of workosUsers) {
        try {
          console.log(`\nProcessing user: ${workosUser.email}`);

          const authFactorsResponse = await workos.userManagement.listAuthFactors({
            userId: workosUser.id,
          }) as any;
          
          const authFactors = authFactorsResponse.data;
          console.log(`Found ${authFactors.length} auth factors`);

          // Create user in BetterAuth
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
              twoFactorEnabled: authFactors.some((f: { type: string }) => f.type === "totp"),
              username: workosUser.email.split("@")[0],
              phoneNumber: authFactors.find((f: { type: string; sms_configuration?: { phoneNumber: string } }) => 
                f.type === "sms")?.sms_configuration?.phoneNumber,
              phoneNumberVerified: !!authFactors.find((f: { type: string }) => f.type === "sms")
            },
            forceAllowId: true
          });

          // Create credential account for email/password users
          const emailFactor = authFactors.find((f: { type: string; email_configuration?: any }) => 
            f.type === "email" && f.email_configuration);
          if (emailFactor) {
            await ctx.adapter.create({
              model: "account",
              data: {
                userId: createdUser.id,
                type: "credentials",
                provider: "credentials",
                providerAccountId: workosUser.id,
                password: emailFactor.email_configuration.hashedPassword,
                createdAt: safeDateConversion(emailFactor.createdAt),
                updatedAt: safeDateConversion(emailFactor.updatedAt)
              },
              forceAllowId: true
            });
            console.log('Created credentials account');
          }

          // Create OAuth provider accounts
          try {
            const connection = await workos.sso.getConnection(workosUser.id);
            console.log(connection);
            if (connection) {
              const provider = connection.type.toLowerCase();
              await ctx.adapter.create({
                model: "account",
                data: {
                  userId: createdUser.id,
                  type: "oauth",
                  provider,
                  providerAccountId: connection.id,
                  createdAt: safeDateConversion(connection.createdAt),
                  updatedAt: safeDateConversion(connection.updatedAt)
                },
                forceAllowId: true
              });
              console.log(`Created ${provider} OAuth account`);
            }
          } catch (error) {
            console.warn(`No OAuth connection found for user ${workosUser.email}`);
          }

          // Create organization memberships
          try {
            
            const membershipsResponse = await workos.userManagement.listOrganizationMemberships({
              userId: workosUser.id
            }) as any;

            console.log('Organization memberships:', membershipsResponse);

            if (membershipsResponse.data) {
              for (const membership of membershipsResponse.data) {
                const orgId = orgMap.get(membership.organizationId);
                if (orgId) {
                  // Get organization details
                  const org = await workos.organizations.getOrganization(membership.organizationId) as any;
                  
                  await ctx.adapter.create({
                    model: "member",
                    data: {
                      userId: createdUser.id,
                      organizationId: orgId,
                      role: membership.role.slug || "member",
                      createdAt: safeDateConversion(membership.createdAt),
                      updatedAt: safeDateConversion(membership.updatedAt)
                    },
                    forceAllowId: true
                  });
                  console.log(`Added user to organization ${org.name} with role ${membership.role || "member"}`);
                }
              }
            }
          } catch (error) {
            console.warn(`Failed to migrate organization memberships for user ${workosUser.email}:`, error);
          }

          // Handle 2FA settings
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

migrateFromWorkOS().catch(console.error); 