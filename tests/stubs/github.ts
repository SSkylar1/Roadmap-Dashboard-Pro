let lastCall: {
  owner: string;
  repo: string;
  path: string;
  branch?: string | null;
  token?: string;
} | null = null;

let mockResponse: unknown = null;
let mockResponseConfigured = false;
let mockError: Error | null = null;

let lastTreeCall: {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
} | null = null;

let mockTreeResponse: string[] | null = [];
let mockTreeError: Error | null = null;

let putCalls: Array<{
  owner: string;
  repo: string;
  path: string;
  content: string;
  branch: string;
  message: string;
  tokenOrOptions?: unknown;
  maybeOptions?: unknown;
}> = [];

let mockPutError: Error | null = null;

export function __setMockResponse(response: unknown) {
  mockResponse = response;
  mockResponseConfigured = true;
}

export function __setMockError(error: Error | null) {
  mockError = error;
}

export function __resetMockGithub() {
  lastCall = null;
  mockResponse = null;
  mockResponseConfigured = false;
  mockError = null;
  lastTreeCall = null;
  mockTreeResponse = [];
  mockTreeError = null;
  putCalls = [];
  mockPutError = null;
}

export function __getLastCall() {
  return lastCall;
}

export function __getLastTreeCall() {
  return lastTreeCall;
}

export function __setMockTreeResponse(response: string[] | null) {
  mockTreeResponse = response;
}

export function __setMockTreeError(error: Error | null) {
  mockTreeError = error;
}

export function __getPutCalls() {
  return putCalls.slice();
}

export function __setMockPutError(error: Error | null) {
  mockPutError = error;
}

export async function getFileRaw(
  owner: string,
  repo: string,
  path: string,
  branch?: string,
  token?: string,
) {
  lastCall = { owner, repo, path, branch: branch ?? null, token };
  if (mockError) {
    const err = mockError;
    mockError = null;
    throw err;
  }
  if (!mockResponseConfigured) {
    throw new Error("No mock response configured for getFileRaw");
  }
  if (typeof mockResponse === "function") {
    return (mockResponse as Function)({ owner, repo, path, branch, token });
  }
  if (Array.isArray(mockResponse)) {
    if (mockResponse.length === 0) {
      throw new Error("No mock response configured for getFileRaw");
    }
    return mockResponse.shift();
  }
  if (
    mockResponse &&
    typeof mockResponse === "object" &&
    !(mockResponse instanceof String) &&
    !(mockResponse instanceof Buffer)
  ) {
    const record = mockResponse as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, path)) {
      return record[path as keyof typeof record];
    }
    if (Object.prototype.hasOwnProperty.call(record, "default")) {
      return record.default;
    }
    if (Object.prototype.hasOwnProperty.call(record, "__default")) {
      return (record as Record<string, unknown>)["__default"];
    }
    return null;
  }
  return mockResponse;
}

export async function listRepoTreePaths(
  owner: string,
  repo: string,
  ref = "HEAD",
  token?: string,
) {
  lastTreeCall = { owner, repo, ref, token };
  if (mockTreeError) {
    const err = mockTreeError;
    mockTreeError = null;
    throw err;
  }
  if (mockTreeResponse === null) {
    throw new Error("No mock response configured for listRepoTreePaths");
  }
  return mockTreeResponse;
}

export async function putFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  branch: string,
  message: string,
  tokenOrOptions?: unknown,
  maybeOptions?: unknown,
) {
  putCalls.push({ owner, repo, path, content, branch, message, tokenOrOptions, maybeOptions });
  if (mockPutError) {
    const err = mockPutError;
    mockPutError = null;
    throw err;
  }
  return { path, branch, sha: "mock-sha" };
}
