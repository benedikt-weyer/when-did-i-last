"use client";

import Image from "next/image";
import { MoonStar, SunMedium } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AUTH_STORAGE_SYNC_EVENT, localStorageAuthPersistence } from "@/lib/auth-storage";

const THEME_STORAGE_KEY = "preset-web-theme";

type Theme = "light" | "dark";

function resolveTheme(): Theme {
  if (globalThis.window === undefined) {
    return "light";
  }

  const storedTheme = globalThis.localStorage.getItem(THEME_STORAGE_KEY);

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function SiteHeader() {
  const [theme, setTheme] = useState<Theme>("light");
  const [isMounted, setIsMounted] = useState(false);
  const [authLabel, setAuthLabel] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const nextTheme = resolveTheme();

    startTransition(() => {
      setTheme(nextTheme);
      setIsMounted(true);
    });
    applyTheme(nextTheme);

    const handleChange = (event: MediaQueryListEvent) => {
      if (globalThis.localStorage.getItem(THEME_STORAGE_KEY)) {
        return;
      }

      const systemTheme = event.matches ? "dark" : "light";

      setTheme(systemTheme);
      applyTheme(systemTheme);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    const syncAuthState = () => {
      const session = localStorageAuthPersistence.readAuthSession();
      const nextLabel =
        session?.currentPrincipal.username ??
        session?.currentPrincipal.email ??
        session?.user.email ??
        null;

      setAuthLabel(nextLabel);
    };

    syncAuthState();
    globalThis.window.addEventListener(AUTH_STORAGE_SYNC_EVENT, syncAuthState);
    globalThis.window.addEventListener("storage", syncAuthState);

    return () => {
      globalThis.window.removeEventListener(AUTH_STORAGE_SYNC_EVENT, syncAuthState);
      globalThis.window.removeEventListener("storage", syncAuthState);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    applyTheme(nextTheme);
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  };

  const handleLogout = () => {
    localStorageAuthPersistence.clearAuthSession();
  };

  const authLinks = authLabel
    ? [
        { href: "/cards", label: "Cards" },
        { href: "/account", label: "Account" },
      ]
    : [
        { href: "/auth?mode=login", label: "Login" },
        { href: "/auth?mode=register", label: "Register" },
      ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/78 backdrop-blur-xl supports-[backdrop-filter]:bg-background/72">
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-10 lg:px-12">
        <Link className="flex items-center gap-3" href="/">
          <Image
            alt="When Did I Last mark"
            className="rounded-2xl"
            height={44}
            src="/wdil-mark.png"
            width={44}
          />
          <p className="text-lg font-semibold tracking-tight text-foreground">When Did I Last</p>
        </Link>

        <nav className="order-3 flex w-full items-center justify-between gap-3 sm:order-2 sm:w-auto sm:flex-1 sm:justify-end">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto rounded-full border border-border/60 bg-card/55 p-1.5 sm:flex-none">
            {authLinks.map((item) => (
              <Link
                key={item.href}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${
                  pathname === item.href.split("?")[0]
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-foreground/76 hover:bg-accent hover:text-accent-foreground'
                }`}
                href={item.href}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {authLabel ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="max-w-48 truncate text-sm font-medium text-foreground/80" title={authLabel}>
                {authLabel}
              </span>
              <Button onClick={handleLogout} size="sm" type="button" variant="outline">
                Logout
              </Button>
            </div>
          ) : null}

          <Button
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="shrink-0"
            onClick={toggleTheme}
            size="sm"
            type="button"
            variant="outline"
          >
            {isMounted && theme === "dark" ? (
              <MoonStar className="size-4" />
            ) : (
              <SunMedium className="size-4" />
            )}
            {theme === "dark" ? "Dark" : "Light"}
          </Button>
        </nav>
      </div>
    </header>
  );
}