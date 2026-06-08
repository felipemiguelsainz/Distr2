import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;

  // Public routes that don't require auth — skip auth check entirely
  const publicRoutes = ['/login', '/auth/callback'];
  if (publicRoutes.some((r) => pathname.startsWith(r))) {
    return supabaseResponse;
  }

  // getClaims() verifies the JWT signature locally against the project's
  // published public keys (no network round-trip to the Auth server, unlike
  // getUser()), and still refreshes the session cookie via the setAll handler.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // Redirect unauthenticated users to login
  if (error || !claims) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  const userId = claims.sub;

  // Profile lookup only when path-based role check is needed.
  // Most dashboard pages re-check role server-side anyway; middleware
  // only fast-rejects the obviously wrong combos.
  const needsRoleCheck =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/dashboard/total');

  if (needsRoleCheck) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('rol')
      .eq('id', userId)
      .single();
    const rol = profile?.rol;

    // /admin/metas-ccc es compartido admin+supervisor; el resto de /admin es admin-only.
    const isMetasCcc =
      pathname === '/admin/metas-ccc' || pathname.startsWith('/admin/metas-ccc/');

    if (pathname.startsWith('/admin')) {
      if (isMetasCcc) {
        if (rol !== 'admin' && rol !== 'supervisor') {
          const url = request.nextUrl.clone();
          url.pathname = '/';
          return NextResponse.redirect(url);
        }
      } else if (rol !== 'admin') {
        // Supervisor que cae en una tab admin-only → a su panel de metas.
        const url = request.nextUrl.clone();
        url.pathname = rol === 'supervisor' ? '/admin/metas-ccc' : '/';
        return NextResponse.redirect(url);
      }
    }
    if (pathname.startsWith('/dashboard/total') && rol !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
