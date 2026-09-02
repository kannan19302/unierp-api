import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface StudentFilters extends PaginationParams {
  status?: string;
}

export interface CourseFilters extends PaginationParams {
  status?: string;
}

/**
 * Domain Repository for Education & Academic Systems.
 */
@Injectable()
export class EducationRepository {
  async findStudents(
    tenantId: string,
    params: StudentFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: "insensitive" } },
        { lastName: { contains: params.search, mode: "insensitive" } },
        { enrollmentNumber: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [students, total] = await Promise.all([
      prisma.educationStudent.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.educationStudent.count({ where }),
    ]);

    return paginatedResult(students, total, params);
  }

  async findCourses(
    tenantId: string,
    params: CourseFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { code: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [courses, total] = await Promise.all([
      prisma.educationCourse.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.educationCourse.count({ where }),
    ]);

    return paginatedResult(courses, total, params);
  }
}
