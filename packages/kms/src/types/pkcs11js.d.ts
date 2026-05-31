// Minimal ambient declaration for pkcs11js.
// Full types are available from @types/pkcs11js if the package is installed.
// This stub allows TypeScript compilation without pkcs11js being present.
declare module 'pkcs11js' {
  class PKCS11 {
    load(library: string): void;
    C_Initialize(): void;
    C_Finalize(): void;
    C_GetSlotList(tokenPresent: boolean): number[];
    C_OpenSession(slotID: number, flags: number): unknown;
    C_CloseSession(session: unknown): void;
    C_Login(session: unknown, userType: number, pin: string): void;
    C_Logout(session: unknown): void;
    C_FindObjectsInit(session: unknown, template: unknown[]): void;
    C_FindObjects(session: unknown, maxCount: number): unknown[];
    C_FindObjectsFinal(session: unknown): void;
    C_GetAttributeValue(session: unknown, object: unknown, template: unknown[]): unknown[];
    C_SignInit(session: unknown, mechanism: unknown, key: unknown): void;
    C_Sign(session: unknown, data: Buffer): Buffer;
  }
  export { PKCS11 };
}
