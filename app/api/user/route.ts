import { auth } from "@clerk/nextjs/server";

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  
  if (!userId) {
    return Response.json({ userId: null }, { status: 401 });
  }

  return Response.json({ userId });
}
