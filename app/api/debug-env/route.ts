// app/api/debug-env/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    has_GH_APP_ID: !!process.env.GH_APP_ID || !!process.env.GH_CLIENT_ID,
    has_GH_APP_INSTALLATION_ID: !!process.env.GH_APP_INSTALLATION_ID,
    has_GH_APP_PRIVATE_KEY: !!process.env.GH_APP_PRIVATE_KEY,
    has_GITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
    // optional: show prefix sanity
    node_env: process.env.NODE_ENV,
  });
}