import { describe, it, expect, beforeEach, vi as jest } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { SearchService } from "../search.service";

describe("SearchService", () => {
  let service: SearchService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    eventEmitter = { emit: jest.fn() } as any;
    service = new SearchService(eventEmitter);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("indexContent", () => {
    it("should upsert search index entry", async () => {
      const mockUpsert = jest
        .spyOn(prisma.searchIndex, "upsert")
        .mockResolvedValue({
          id: "1",
          tenantId: "t1",
          entityType: "customer",
          entityId: "c1",
          title: "Test Customer",
          content: "test content",
          keywords: [],
          module: "crm",
          metadata: {},
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const result = await service.indexContent("t1", "customer", "c1", {
        title: "Test Customer",
        content: "test content",
        module: "crm",
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_entityType_entityId: {
              tenantId: "t1",
              entityType: "customer",
              entityId: "c1",
            },
          },
          create: expect.objectContaining({ title: "Test Customer" }),
        }),
      );
      expect(result.title).toBe("Test Customer");
    });
  });

  describe("saveSearch", () => {
    it("should save a search query", async () => {
      const mockUpsert = jest
        .spyOn(prisma.savedSearch, "upsert")
        .mockResolvedValue({
          id: "1",
          tenantId: "t1",
          userId: "u1",
          name: "My Search",
          query: "test query",
          filters: {},
          scope: "ALL",
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const result = await service.saveSearch("t1", "u1", {
        name: "My Search",
        query: "test query",
      });

      expect(mockUpsert).toHaveBeenCalled();
      expect(result.name).toBe("My Search");
    });
  });

  describe("getSavedSearches", () => {
    it("should return saved searches for user", async () => {
      const mockFind = jest
        .spyOn(prisma.savedSearch, "findMany")
        .mockResolvedValue([
          {
            id: "1",
            tenantId: "t1",
            userId: "u1",
            name: "S1",
            query: "q1",
            filters: {},
            scope: "ALL",
            isDefault: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

      const result = await service.getSavedSearches("t1", "u1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("S1");
    });
  });

  describe("logSearchQuery", () => {
    it("should create a search query log", async () => {
      const mockCreate = jest
        .spyOn(prisma.searchQueryLog, "create")
        .mockResolvedValue({
          id: "1",
          tenantId: "t1",
          userId: "u1",
          query: "test",
          filters: {},
          resultCount: 5,
          executionMs: 10,
          entityTypes: [],
          createdAt: new Date(),
        });

      const result = await service.logSearchQuery("t1", "u1", {
        query: "test",
        resultCount: 5,
        executionMs: 10,
      });
      expect(mockCreate).toHaveBeenCalled();
      expect(result.query).toBe("test");
    });
  });

  describe("fulltextSearch", () => {
    it("should search indexed content", async () => {
      const mockFind = jest
        .spyOn(prisma.searchIndex, "findMany")
        .mockResolvedValue([
          {
            id: "1",
            tenantId: "t1",
            entityType: "customer",
            entityId: "c1",
            title: "Acme Corp",
            content: "Acme Corp content",
            keywords: [],
            module: "crm",
            metadata: {},
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
      jest.spyOn(prisma.searchIndex, "count").mockResolvedValue(1);

      const result = await service.fulltextSearch("t1", "Acme");
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("E39/G-6: excludes permission-gated entity types the user cannot read from both results and the count", async () => {
      jest.spyOn(idpPrisma.userRole, "findMany").mockResolvedValue([
        {
          id: "ur-1",
          userId: "u1",
          roleId: "r1",
          role: { id: "r1", permissions: JSON.stringify(["crm.contact.read"]) },
        },
      ] as any);
      const findManySpy = jest
        .spyOn(prisma.searchIndex, "findMany")
        .mockResolvedValue([]);
      const countSpy = jest.spyOn(prisma.searchIndex, "count").mockResolvedValue(0);

      // User holds crm.contact.read but NOT hr.employee.read.
      await service.fulltextSearch("t1", "salary", {}, "u1");

      const whereArg = findManySpy.mock.calls[0]?.[0]?.where;
      expect(whereArg.entityType).toEqual({ notIn: ["lead", "product", "employee"] });
      expect(countSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: { notIn: ["lead", "product", "employee"] },
          }),
        }),
      );
    });

    it("E39/G-6: refuses an explicit request for a gated entityType the user cannot read, without leaking a count", async () => {
      jest.spyOn(idpPrisma.userRole, "findMany").mockResolvedValue([
        {
          id: "ur-1",
          userId: "u1",
          roleId: "r1",
          role: { id: "r1", permissions: JSON.stringify([]) },
        },
      ] as any);
      const findManySpy = jest.spyOn(prisma.searchIndex, "findMany");
      const countSpy = jest.spyOn(prisma.searchIndex, "count");

      const result = await service.fulltextSearch(
        "t1",
        "smith",
        { entityType: "employee" },
        "u1",
      );

      expect(result).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
      expect(findManySpy).not.toHaveBeenCalled();
      expect(countSpy).not.toHaveBeenCalled();
    });
  });
});
