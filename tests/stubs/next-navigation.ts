export function usePathname(): string {
  return "/";
}

export function useRouter(): Record<string, unknown> {
  return {
    push() {},
    replace() {},
    refresh() {},
    back() {},
    forward() {},
    prefetch() {},
  };
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}
