import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
    '/',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/webhooks(.*)'
]);

import { NextResponse } from 'next/server';

export default clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
        const authObject = await auth();

        if (!authObject.userId) {
            if (req.nextUrl.pathname.startsWith('/api/')) {
                return new NextResponse('Unauthorized', { status: 401 });
            }
            return NextResponse.redirect(new URL('/sign-in', req.url));
        }
    }
});

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
};
