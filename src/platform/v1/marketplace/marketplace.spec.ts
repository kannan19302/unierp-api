import { Test, TestingModule } from '@nestjs/testing';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { ControlPlaneAuditService } from '../control-plane-audit.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Marketplace Operations & Partner Ecosystem (PCC-17)', () => {
  let controller: MarketplaceController;
  let service: MarketplaceService;

  const mockAuditService = {
    record: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MarketplaceService(mockAuditService as any);
    controller = new MarketplaceController(service);
  });

  describe('EC-17.1: Submission Review Pipeline', () => {
    it('lists submissions and supports filtering by stage', async () => {
      const allSubmissions = await controller.listSubmissions();
      expect(allSubmissions.length).toBeGreaterThanOrEqual(3);

      const securityReviewSubs = await controller.listSubmissions('SECURITY_REVIEW');
      expect(securityReviewSubs.every((s) => s.stage === 'SECURITY_REVIEW')).toBe(true);
    });

    it('retrieves submission details or throws NotFoundException', async () => {
      const sub = await controller.getSubmission('sub-crm-pro');
      expect(sub.name).toContain('HubSpot');
      expect(sub.checklist).toBeDefined();

      await expect(controller.getSubmission('non-existent-sub')).rejects.toThrow(NotFoundException);
    });

    it('assigns a reviewer to a submission with audit record', async () => {
      const updated = await controller.assignReviewer('sub-iot-fleet', {
        reviewerId: 'rev-lead-01',
        reviewerName: 'Marcus Reviewer',
        actorId: 'admin-user-01',
      });

      expect(updated.assignedReviewer).toEqual({
        id: 'rev-lead-01',
        name: 'Marcus Reviewer',
      });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'marketplace.submission.assign_reviewer',
          targetId: 'sub-iot-fleet',
        })
      );
    });

    it('transitions submission stage and updates review checklist', async () => {
      const transitioned = await controller.updateSubmissionStage('sub-iot-fleet', {
        stage: 'SECURITY_REVIEW',
        checklist: {
          securitySastPassed: true,
          securityNoCriticalCve: true,
        },
        feedbackNotes: 'Initial SAST scan completed cleanly without critical vulnerabilities.',
        actorId: 'admin-user-01',
      });

      expect(transitioned.stage).toBe('SECURITY_REVIEW');
      expect(transitioned.checklist.securitySastPassed).toBe(true);
      expect(transitioned.checklist.securityNoCriticalCve).toBe(true);
      expect(transitioned.feedbackNotes).toContain('Initial SAST scan completed');

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'marketplace.submission.stage_transition',
          targetId: 'sub-iot-fleet',
        })
      );
    });

    it('approves a submission and marks it as APPROVED', async () => {
      const res = await controller.approveExtension('sub-stripe-tax', { actorId: 'admin-user-01' });

      expect(res.success).toBe(true);
      expect(res.submission?.stage).toBe('APPROVED');
      expect(res.submission?.approvedAt).toBeDefined();

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'marketplace.extension.approve',
          targetId: 'sub-stripe-tax',
        })
      );
    });

    it('rejects a submission with reason and marks it as REJECTED', async () => {
      const res = await controller.rejectExtension('sub-iot-fleet', {
        reason: 'Failed cold start latency test (>1500ms). Bundle must be compressed.',
        actorId: 'admin-user-01',
      });

      expect(res.success).toBe(true);
      expect(res.submission?.stage).toBe('REJECTED');
      expect(res.submission?.feedbackNotes).toContain('Failed cold start latency test');

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'marketplace.extension.reject',
          targetId: 'sub-iot-fleet',
        })
      );
    });
  });

  describe('EC-17.2: Version Management & Staged Rollouts', () => {
    it('lists versions for an extension with changelog diffs', async () => {
      const versions = await controller.listVersions('hubspot-advanced-crm');

      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions.some((v) => v.version === '2.1.0')).toBe(true);
      expect(versions[0].changelogDiff).toBeDefined();
    });

    it('updates staged rollout percentage with bounds checking', async () => {
      const updated = await controller.updateRolloutPercentage(
        'hubspot-advanced-crm',
        '2.1.0',
        { percentage: 50, actorId: 'admin-user-01' }
      );

      expect(updated.rolloutPercentage).toBe(50);

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'marketplace.version.rollout_adjust',
          targetId: 'hubspot-advanced-crm:2.1.0',
        })
      );

      // Invalid percentage bounds
      await expect(
        controller.updateRolloutPercentage('hubspot-advanced-crm', '2.1.0', { percentage: 150 })
      ).rejects.toThrow(BadRequestException);
    });

    it('rolls back to previous stable version and de-activates newer versions', async () => {
      const res = await controller.rollbackVersion('hubspot-advanced-crm', {
        targetVersion: '2.0.0',
        reason: 'Critical memory spike discovered in v2.1.0 batch quotes worker',
        actorId: 'admin-user-01',
      });

      expect(res.success).toBe(true);
      expect(res.activeVersion).toBe('2.0.0');

      const versions = await controller.listVersions('hubspot-advanced-crm');
      const v200 = versions.find((v) => v.version === '2.0.0');
      const v210 = versions.find((v) => v.version === '2.1.0');

      expect(v200?.status).toBe('ACTIVE');
      expect(v200?.rolloutPercentage).toBe(100);
      expect(v210?.status).toBe('ROLLED_BACK');
      expect(v210?.rolloutPercentage).toBe(0);

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'marketplace.version.rollback',
          targetId: 'hubspot-advanced-crm',
        })
      );
    });

    it('executes emergency revocation across tenants', async () => {
      const res = await controller.emergencyRevokeExtension('hubspot-advanced-crm', {
        reason: 'Zero-day vulnerability discovered in upstream package dependency',
        actorId: 'admin-user-01',
      });

      expect(res.appSlug).toBe('hubspot-advanced-crm');
      expect(res.revokedAt).toBeDefined();
    });
  });
});
