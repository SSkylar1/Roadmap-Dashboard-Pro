declare module "jsonwebtoken" {
  type Algorithm =
    | "RS256"
    | "RS384"
    | "RS512"
    | "HS256"
    | "HS384"
    | "HS512"
    | "ES256"
    | "ES384"
    | "ES512"
    | "PS256"
    | "PS384"
    | "PS512"
    | "none";

  interface SignOptions {
    algorithm?: Algorithm;
    expiresIn?: string | number;
    audience?: string | string[];
    issuer?: string;
    subject?: string;
    jwtid?: string;
    noTimestamp?: boolean;
    header?: Record<string, unknown>;
    keyid?: string;
    mutatePayload?: boolean;
  }

  export function sign(
    payload: string | Buffer | object,
    secretOrPrivateKey: string | Buffer,
    options?: SignOptions
  ): string;

  const jwt: {
    sign: typeof sign;
  };

  export default jwt;
}
