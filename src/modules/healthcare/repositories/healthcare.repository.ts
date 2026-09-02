import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface PatientFilters extends PaginationParams {
  gender?: string;
}

/**
 * Domain Repository for Healthcare & Clinical Operations.
 */
@Injectable()
export class HealthcareRepository {
  async findPatients(
    tenantId: string,
    params: PatientFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.gender) where.gender = params.gender;
    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: "insensitive" } },
        { lastName: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [patients, total] = await Promise.all([
      prisma.healthcarePatient.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.healthcarePatient.count({ where }),
    ]);

    return paginatedResult(patients, total, params);
  }

  async findPatientById(tenantId: string, id: string): Promise<any | null> {
    return prisma.healthcarePatient.findFirst({
      where: { id, tenantId },
      include: {
        appointments: { take: 5 },
      },
    });
  }

  async createPatient(tenantId: string, data: any): Promise<any> {
    return prisma.healthcarePatient.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }
}
