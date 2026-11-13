import { NextResponse, type NextRequest } from "next/server";

// Fast redirect for signed-out visitors. The API still validates the session on every request.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("tq_sid")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
