import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on every route except static assets, Next internals, /api/ingest/*
    // and /api/allocate — both are device-key authenticated, not Clerk.
    "/((?!_next|api/ingest|api/allocate|.*\\..*).*)",
    "/api((?!/ingest|/allocate).*)",
  ],
};
