/**
 * M33 — "unauthorised returns 403." A route marked `@RequireEstateGrant()`
 * reads a `resourceId` from the request (route param `id` by default)
 * and refuses with ForbiddenException unless EstateAbacService finds a
 * matching grant — never falling back to RBAC's own permission check,
 * which is exactly what makes a `platform.*` wildcard unable to satisfy
 * this guard: this guard never asks RBAC anything.
 */
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { ESTATE_GRANT_KEY, type EstateGrantRequirement } from "../decorators/estate-abac.decorator";
import { EstateAbacService } from "../../platform/v1/estate-abac.service";

@Injectable()
export class EstateAbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abac: EstateAbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<EstateGrantRequirement>(ESTATE_GRANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;
    if (!user) {
      throw new ForbiddenException("Unauthenticated");
    }
    const subjectId = user.userId ?? user.sub;
    const resourceId = (request.params as any)[requirement.resourceIdParam ?? "id"];

    const authorized = await this.abac.isAuthorized(subjectId, resourceId, requirement.capability);
    if (!authorized) {
      throw new ForbiddenException(
        `No estate grant authorises "${requirement.capability}" on resource "${resourceId}" for this subject`,
      );
    }
    return true;
  }
}
