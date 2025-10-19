let lastCall: {
  owner: string;
  repo: string;
  path: string;
  branch?: string | null;
  token?: string;
} | null = null;

let mockResponse: string | null = null;
let mockError: Error | null = null;

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
}

export function __getLastCall() {
  return lastCall;
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
