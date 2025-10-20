declare const process: any;
declare const Buffer: any;
declare const __dirname: string;

declare function require(id: string): any;
declare namespace require {
  const cache: Record<string, any>;
  function resolve(id: string): string;
}

declare module "node:test" {
  type TestFn = (t: any) => any;
  function test(name: string, fn: TestFn): Promise<void>;
  namespace test {
    const skip: (name: string, fn: TestFn) => Promise<void>;
    const only: (name: string, fn: TestFn) => Promise<void>;
  }
  export = test;
}

declare module "node:assert/strict" {
  const assert: {
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
  };
  export = assert;
}

declare module "node:module" {
  const Module: any;
  export = Module;
}

declare module "node:path" {
  const path: any;
  export = path;
}

declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs" {
  const fs: any;
  export = fs;
}

declare module "next/server" {
  export type NextRequest = any;
  export const NextResponse: any;
}

declare module "js-yaml" {
  export function load(input: string, options?: any): any;
  export function dump(input: any, options?: any): string;
  const yaml: {
    load: typeof load;
    dump: typeof dump;
  };
  export default yaml;
}

declare module "micromatch" {
  function micromatch(list: string[], patterns: string[] | string, options?: any): string[];
  export = micromatch;
}
