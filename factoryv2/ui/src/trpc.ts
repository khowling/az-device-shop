

// @filename: client.ts
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import { type AppRouter, type ZodError } from '../../server/src/index';

const trpc = createTRPCReact<AppRouter>();

export {
    ZodError,
    AppRouter,
    trpc
}
// https://trpc.io/docs/react#2-create-trpc-hooks
// a set of strongly-typed React hooks from "AppRouter" type signature





