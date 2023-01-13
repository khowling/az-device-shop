

// @filename: client.ts
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '../../../server/trcpRouter';
 
// https://trpc.io/docs/react#2-create-trpc-hooks
// a set of strongly-typed React hooks from "AppRouter" type signature

export const trpc = createTRPCReact<AppRouter>();



