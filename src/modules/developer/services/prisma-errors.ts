/**
 * Structural Prisma error detection, deliberately NOT `instanceof`.
 *
 * `instanceof Prisma.PrismaClientKnownRequestError` looks correct and fails
 * silently here. The runtime error is thrown by the Prisma client nested
 * inside `@kannan19302/database`
 * (`node_modules/@kannan19302/database/node_modules/@prisma/client`), while
 * `Prisma` imported in api code resolves to api's own top-level
 * `@prisma/client`. Two copies, two class identities, so the prototype check
 * is always false — and the `catch` block that was supposed to turn a unique
 * violation into a 409 instead re-threw and produced a 500.
 *
 * Observed exactly that: publishing a duplicate release version returned
 * `500 INTERNAL_ERROR` while the log showed a textbook
 * `PrismaClientKnownRequestError { code: "P2002" }`. Matching on the shape —
 * which is stable public API and identical across both copies — is what
 * actually works.
 */

/** A Prisma "known request error" with the given code, whichever client
 * instance threw it. */
export function isPrismaError(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === code &&
    (err as { name?: unknown }).name === "PrismaClientKnownRequestError"
  );
}

/** P2002 — unique constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return isPrismaError(err, "P2002");
}
