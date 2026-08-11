/**
 * J04 — the reusable, generic form of the mechanism
 * rbac-regression-sweep.spec.ts proved by hand for 5 controllers: real
 * `Reflector` reading real `@Permissions(...)` metadata off a real
 * controller class's prototype, enforced by a real `RbacGuard`. Any
 * spec file can call `expectPermissionEnforced()` for ANY controller
 * class + handler name pair without re-deriving this wiring — the
 * "every endpoint has a permission test" exit criterion is met one
 * call site at a time, using the SAME proven mechanism, never a
 * reimplementation per controller.
 */
import { Reflector } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import { RbacGuard } from "./rbac.guard";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";

function buildContext(user: unknown, handler: () => unknown, controllerClass: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  } as any;
}

/**
 * Asserts a handler carries the expected fine-grained permission in
 * its REAL reflected metadata (not a permission string invented by the
 * test), then asserts RbacGuard REFUSES a caller without it (throwing
 * ForbiddenException — the "403, not 404/500" the exit criterion
 * names) and ALLOWS a caller who holds it.
 */
export async function expectPermissionEnforced(
  controllerClass: any,
  handlerName: string,
  expectedPermission: string,
): Promise<void> {
  const handler = controllerClass.prototype[handlerName];
  if (typeof handler !== "function") {
    throw new Error(`${controllerClass.name}.${handlerName} is not a real method on the controller prototype`);
  }

  const metadata = Reflect.getMetadata(PERMISSIONS_KEY, handler);
  expect(metadata, `${controllerClass.name}.${handlerName} carries no @Permissions metadata`).toBeDefined();
  expect(metadata).toContain(expectedPermission);

  const guard = new RbacGuard(new Reflector());

  await expect(
    guard.canActivate(buildContext({ userId: "u-unauthorized", permissions: [] }, handler, controllerClass)),
  ).rejects.toThrow(ForbiddenException);

  await expect(
    guard.canActivate(buildContext({ userId: "u-authorized", permissions: [expectedPermission] }, handler, controllerClass)),
  ).resolves.toBe(true);
}
