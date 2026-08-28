import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SaasController } from "../saas.controller";

describe("SaasController legacy Stripe webhook", () => {
  const controller = (billingService = { processStripeWebhook: vi.fn() }) =>
    new SaasController({} as any, {} as any, billingService as any);

  it("refuses a missing signature or raw request body", async () => {
    await expect(controller().stripeWebhook({ rawBody: Buffer.from("{}") } as any)).rejects.toThrow(BadRequestException);
    await expect(controller().stripeWebhook({} as any, "signature")).rejects.toThrow(BadRequestException);
  });

  it("delegates the exact raw payload and signature to the fail-closed billing verifier", async () => {
    const billingService = { processStripeWebhook: vi.fn().mockResolvedValue({ received: true }) };
    const result = await controller(billingService).stripeWebhook(
      { rawBody: Buffer.from('{"id":"evt_1"}') } as any,
      "signature",
    );

    expect(billingService.processStripeWebhook).toHaveBeenCalledWith('{"id":"evt_1"}', "signature");
    expect(result).toEqual({ received: true });
  });
});
