declare module "micromatch" {
  export interface MicromatchOptions {
    dot?: boolean;
    nocase?: boolean;
    nobrace?: boolean;
    noglobstar?: boolean;
    [key: string]: unknown;
  }

  export default function micromatch(
    list: string[] | string,
    patterns: string | string[],
    options?: MicromatchOptions,
  ): string[];
}
