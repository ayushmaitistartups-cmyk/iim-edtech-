import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
    '/',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/webhooks(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
        const authObject = await auth();

        if (!authObject.userId) {
            if (req.nextUrl.pathname.startsWith('/api/')) {
                return new NextResponse('Unauthorized', { status: 401 });
            }
            const signInUrl = new URL('/sign-in', req.url);
            signInUrl.searchParams.set(
                'redirect_url',
                `${req.nextUrl.pathname}${req.nextUrl.search}`
            );
            return NextResponse.redirect(signInUrl);
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
