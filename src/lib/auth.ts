import { betterAuth } from "better-auth";
import { admin, twoFactor, username } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma"

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    emailAndPassword: {
        enabled: true,
    },
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        },
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }
    },
    logger: {
      disabled: true,
      level: "info",
      log: (level, message, ...args) => {
          console.log(`[${level}] ${message}`, ...args);
        }
    },
    plugins: [
        admin(),
        twoFactor(),
    ],
});