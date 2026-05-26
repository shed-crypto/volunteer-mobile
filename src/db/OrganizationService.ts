/**
 * OrganizationService.ts
 * ----------------------
 * Сервіс для керування офлайн-кешем організацій.
 * Використовується SyncService для збереження даних з сервера
 * та екранами для читання локальних даних.
 */
import { database, collections, safeWrite } from './index';
import { OrganizationModel } from './models/OrganizationModel';
import { OrganizationMemberModel } from './models/OrganizationMemberModel';
import { OrganizationHubModel } from './models/OrganizationHubModel';
import { OrganizationJoinRequestModel } from './models/OrganizationJoinRequestModel';
import { Q } from '@nozbe/watermelondb';
import type { Organization, OrganizationMember, Hub, OrganizationJoinRequest } from '../types';

class OrganizationServiceClass {
  /**
   * Зберегти масив організацій та пов'язані дані в локальну БД.
   * Виконує batch-операцію: видаляє старі записи, створює нові.
   */
  async saveAll(
    orgs: Organization[],
    members: OrganizationMember[],
    hubs: Hub[],
    joinRequests: OrganizationJoinRequest[],
  ): Promise<void> {
    const now = Date.now();

    await safeWrite(async () => {
      const preparedOperations: any[] = [];

      // 1. Видалити всі старі записи
      const oldOrgs = await collections.organizations.query().fetch();
      for (const o of oldOrgs) {
        preparedOperations.push(o.prepareMarkAsDeleted());
      }

      const oldMembers = await collections.organizationMembers.query().fetch();
      for (const m of oldMembers) {
        preparedOperations.push(m.prepareMarkAsDeleted());
      }

      const oldHubs = await collections.organizationHubs.query().fetch();
      for (const h of oldHubs) {
        preparedOperations.push(h.prepareMarkAsDeleted());
      }

      const oldJoinReqs = await collections.organizationJoinRequests.query().fetch();
      for (const jr of oldJoinReqs) {
        preparedOperations.push(jr.prepareMarkAsDeleted());
      }

      // 2. Створити нові записи
      for (const org of orgs) {
        preparedOperations.push(
          collections.organizations.prepareCreate((r: any) => {
            r.serverId = org.id;
            r.name = org.name;
            r.description = org.description ?? null;
            r.logoUrl = org.logoUrl ?? null;
            r.parentOrgId = org.parentOrgId ?? null;
            r.isPublic = org.isPublic;
            r.tagsRaw = JSON.stringify(org.tags ?? []);
            r.isSynced = true;
            r.lastSyncedAt = now;
          }),
        );
      }

      for (const member of members) {
        preparedOperations.push(
          collections.organizationMembers.prepareCreate((r: any) => {
            r.serverId = member.id;
            r.organizationId = member.organizationId;
            r.userId = member.userId;
            r.userName = member.user?.fullName ?? null;
            r.orgRole = member.orgRole;
            r.isDeputy = member.isDeputy ?? false;
            r.isActive = member.isActive;
            r.joinedAt = new Date(member.joinedAt).getTime();
            r.isSynced = true;
            r.lastSyncedAt = now;
          }),
        );
      }

      for (const hub of hubs) {
        preparedOperations.push(
          collections.organizationHubs.prepareCreate((r: any) => {
            r.serverId = hub.id;
            r.organizationId = hub.organizationId;
            r.name = hub.name;
            r.description = hub.description ?? null;
            r.address = hub.address ?? null;
            r.latitude = hub.latitude ?? null;
            r.longitude = hub.longitude ?? null;
            r.mediaUrl = hub.mediaUrl ?? null;
            r.isPublic = hub.isPublic;
            r.isSynced = true;
            r.lastSyncedAt = now;
          }),
        );
      }

      for (const jr of joinRequests) {
        preparedOperations.push(
          collections.organizationJoinRequests.prepareCreate((r: any) => {
            r.serverId = jr.id;
            r.organizationId = jr.organizationId;
            r.userId = jr.userId;
            r.userName = jr.user?.fullName ?? null;
            r.message = jr.message ?? null;
            r.status = jr.status;
            r.reviewedBy = jr.reviewedBy ?? null;
            r.reviewComment = jr.reviewComment ?? null;
            r.reviewedAt = jr.reviewedAt ? new Date(jr.reviewedAt).getTime() : null;
            r.isSynced = true;
            r.lastSyncedAt = now;
          }),
        );
      }

      await database.batch(preparedOperations);
    });

    OrganizationServiceClass.log(`Saved ${orgs.length} orgs, ${members.length} members, ${hubs.length} hubs, ${joinRequests.length} join requests`);
  }

  /**
   * Отримати всі локальні організації.
   */
  async getMyLocal(): Promise<OrganizationModel[]> {
    const orgs = await collections.organizations
      .query()
      .fetch();

    return orgs as unknown as OrganizationModel[];
  }

  /**
   * Отримати учасників для конкретної організації.
   */
  async getMembersForOrg(orgServerId: string): Promise<OrganizationMemberModel[]> {
    const members = await collections.organizationMembers
      .query(
        Q.where('organization_id', orgServerId),
      )
      .fetch();

    return members as unknown as OrganizationMemberModel[];
  }

  /**
   * Отримати хаби для конкретної організації.
   */
  async getHubsForOrg(orgServerId: string): Promise<OrganizationHubModel[]> {
    const hubs = await collections.organizationHubs
      .query(
        Q.where('organization_id', orgServerId),
      )
      .fetch();

    return hubs as unknown as OrganizationHubModel[];
  }

  private static log(message: string) {
    if (__DEV__) {
      console.log(`[OrganizationService] ${message}`);
    }
  }
}

export const OrganizationService = new OrganizationServiceClass();