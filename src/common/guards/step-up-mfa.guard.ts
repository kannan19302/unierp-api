/**
 * M32 — "step-up MFA is unskippable on a destructive plan": a route
 * marked `@RequireStepUpMfa()` refuses with 403 unless the request
 * carries a valid, unexpired, unused `x-step-up-mfa-token`. There is no
 * bypass header, no role that skips this, and the guard fails CLOSED —
 * any error or missing data refuses, never defaults to allow.
 */
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { STEP_UP_MFA_KEY } from "../decorators/step-up-mfa.decorator";
import { StepUpMfaService } from "../services/step-up-mfa.service";

@Injectable()
export class StepUpMfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUpMfa: StepUpMfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(STEP_UP_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;
    if (!user) {
      throw new ForbiddenException("Unauthenticated");
    }
    const actorId = user.userId ?? user.sub;
    const token = request.headers["x-step-up-mfa-token"] as string | undefined;

    const verified = await this.stepUpMfa.consumeToken(actorId, token);
    if (!verified) {
      throw new ForbiddenException(
        "This is a destructive plan and requires step-up MFA — no valid, unused verification token was presented",
      );
    }
    return true;
  }
}
