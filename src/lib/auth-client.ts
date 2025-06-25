import { createAuthClient } from "better-auth/react";
import { adminClient, anonymousClient, jwtClient, phoneNumberClient, organizationClient, inferAdditionalFields } from "better-auth/client/plugins";
import { auth } from "./auth";
export const authClient = createAuthClient({
  baseURL: 'http://localhost:3001',
  fetchOptions: {
    credentials: "include",
    onSuccess: (ctx) => {
      console.log("IT WORKS!!!!")
      console.log("onSuccess", ctx)
    },
    onRequest: (ctx) => {
      console.log("onRequest", ctx)
    },
    onResponse: (ctx) => {
      console.log("onResponse", ctx)
    },
    onError: (ctx) => {
      console.log("onError", ctx)
    }
  },

  plugins: [inferAdditionalFields<typeof auth>() , jwtClient(), adminClient(), phoneNumberClient(), anonymousClient(), organizationClient()],
});
export const { useSession } = authClient
