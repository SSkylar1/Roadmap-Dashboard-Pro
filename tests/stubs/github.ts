let lastCall: {
  owner: string;
  repo: string;
  path: string;
  branch?: string | null;
  token?: string;
} | null = null;

let mockResponse: string | null = null;
let mockError: Error | null = null;

let lastTreeCall: {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
} | null = null;

let mockTreeResponse: string[] | null = [];
let mockTreeError: Error | null = null;

export function __setMockResponse(response: string | null) {
  mockResponse = response;
}

export function __setMockError(error: Error | null) {
  mockError = error;
}

export function __resetMockGithub() {
  lastCall = null;
  mockResponse = null;
  mockError = null;
  lastTreeCall = null;
  mockTreeResponse = [];
  mockTreeError = null;
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
  if (mockResponse === null) {
    throw new Error("No mock response configured for getFileRaw");
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
