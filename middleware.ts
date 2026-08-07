import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on every route except static assets, Next internals and /api/ingest/*.
    "/((?!_next|api/ingest|.*\\..*).*)",
    // Always run on /api/*, except /api/ingest/*, which devices call unauthenticated.
    "/api((?!/ingest).*)",
  ],
};
