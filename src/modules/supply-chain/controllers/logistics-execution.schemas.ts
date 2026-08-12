import { z } from "zod";

export const createLoadBuildSchema = z.object({
  loadType: z.string().optional(),
  transportMode: z.string().optional(),
  carrierId: z.string().optional(),
  carrierName: z.string().optional(),
  vehicleNumber: z.string().optional(),
  driverName: z.string().optional(),
  driverContact: z.string().optional(),
  originName: z.string().optional(),
  destName: z.string().optional(),
  scheduledPickup: z.string().optional(),
  scheduledDelivery: z.string().optional(),
  totalWeight: z.number().optional(),
  totalVolume: z.number().optional(),
  totalPallets: z.number().int().optional(),
  totalCartons: z.number().int().optional(),
  estimatedCost: z.number().optional(),
  bolNumber: z.string().optional(),
  temperatureReq: z.string().optional(),
  hazmat: z.boolean().optional(),
  notes: z.string().optional(),
  stops: z
    .array(
      z.object({
        stopSequence: z.number().int(),
        stopType: z.string().optional(),
        locationName: z.string().optional(),
        address: z.string().optional(),
        scheduledArrival: z.string().optional(),
        scheduledDeparture: z.string().optional(),
        contactPerson: z.string().optional(),
        contactPhone: z.string().optional(),
      }),
    )
    .optional(),
  items: z
    .array(
      z.object({
        productId: z.string().optional(),
        productSku: z.string().optional(),
        productName: z.string().optional(),
        quantity: z.number().positive(),
        uom: z.string().optional(),
        weight: z.number().optional(),
        volume: z.number().optional(),
        palletCount: z.number().int().optional(),
        cartonCount: z.number().int().optional(),
      }),
    )
    .optional(),
});

export const createAppointmentSchema = z.object({
  appointmentType: z.string(),
  carrierId: z.string().optional(),
  carrierName: z.string().optional(),
  carrierContact: z.string().optional(),
  vehicleNumber: z.string().optional(),
  warehouseId: z.string().optional(),
  dockDoor: z.string().optional(),
  scheduledStart: z.string(),
  scheduledEnd: z.string().optional(),
  poNumbers: z.string().optional(),
  referenceNumber: z.string().optional(),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  totalWeight: z.number().optional(),
  totalPallets: z.number().int().optional(),
  totalCartons: z.number().int().optional(),
  notes: z.string().optional(),
});

export const createPodSchema = z.object({
  shipmentId: z.string().optional(),
  shipmentType: z.string().optional(),
  receivedBy: z.string().optional(),
  signatureName: z.string().optional(),
  damageNotes: z.string().optional(),
  carrierName: z.string().optional(),
  driverName: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().optional(),
  lines: z.array(
    z.object({
      productId: z.string().optional(),
      productSku: z.string().optional(),
      productName: z.string().optional(),
      expectedQty: z.number().positive(),
      deliveredQty: z.number().positive(),
      damagedQty: z.number().optional(),
      rejectedQty: z.number().optional(),
      condition: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
});
