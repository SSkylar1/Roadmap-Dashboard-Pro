let lastOpenSetupCall: any = null;

export function __resetOpenSetupStub() {
  lastOpenSetupCall = null;
}

export function __getLastOpenSetupCall() {
  return lastOpenSetupCall;
}

export async function openSetupPR(args: any) {
  lastOpenSetupCall = args;
  return { html_url: "https://example.com/pr/1", number: 123 };
}
