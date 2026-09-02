import { Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  buildPaginationValues,
  buildOrderBy,
  paginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../common/utils/pagination.util";

export interface EmployeeFilters extends PaginationParams {
  status?: string;
  departmentId?: string;
}

export interface DepartmentFilters extends PaginationParams {
  isActive?: boolean;
}

export interface LeaveRequestFilters extends PaginationParams {
  status?: string;
  employeeId?: string;
}

/**
 * Domain Repository for Human Resources & Workforce Operations.
 */
@Injectable()
export class HrRepository {
  // ─── Employees ─────────────────────────────────────────────────────────

  async findEmployees(
    tenantId: string,
    params: EmployeeFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.departmentId) where.departmentId = params.departmentId;
    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: "insensitive" } },
        { lastName: { contains: params.search, mode: "insensitive" } },
        { email: { contains: params.search, mode: "insensitive" } },
        { employeeNumber: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, code: true } },
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.employee.count({ where }),
    ]);

    return paginatedResult(employees, total, params);
  }

  async findEmployeeById(tenantId: string, id: string): Promise<any | null> {
    return prisma.employee.findFirst({
      where: { id, tenantId },
      include: {
        department: true,
      },
    });
  }

  async createEmployee(tenantId: string, data: any): Promise<any> {
    return prisma.employee.create({
      data: {
        ...data,
        tenantId,
      },
    });
  }

  // ─── Departments ───────────────────────────────────────────────────────

  async findDepartments(
    tenantId: string,
    params: DepartmentFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { code: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [departments, total] = await Promise.all([
      prisma.department.findMany({
        where,
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.department.count({ where }),
    ]);

    return paginatedResult(departments, total, params);
  }

  // ─── Leave Requests ────────────────────────────────────────────────────

  async findLeaveRequests(
    tenantId: string,
    params: LeaveRequestFilters = {},
  ): Promise<PaginatedResult<any>> {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.employeeId) where.employeeId = params.employeeId;

    const { skip, take } = buildPaginationValues(params);
    const orderBy = buildOrderBy(params.sort);

    const [leaveRequests, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          policy: true,
        },
        skip,
        take,
        orderBy: orderBy as any,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    return paginatedResult(leaveRequests, total, params);
  }
}
