import { eq, type SQL } from 'drizzle-orm';

import { mailboxAccounts } from './schema/mailbox-accounts';
import { users } from './schema/users';

export interface AiConsentColumns {
  aiConsentVersion: string | null;
  aiExplanationsConsentAt: Date | null;
  aiExplanationsRevokedAt: Date | null;
  aiConsentScopes: string[] | null;
  aiConsentDeclinedAt: Date | null;
  briefAiConsentAt: Date | null;
  briefAiConsentVersion: string | null;
  briefAiConsentRevokedAt: Date | null;
  briefAiDeclinedAt: Date | null;
}

/** Workers pass their own drizzle generic. This only reads the consent columns. */
interface ConsentReader {
  select(fields: object): {
    from(table: object): {
      innerJoin(
        table: object,
        on: SQL,
      ): {
        where(condition: SQL): {
          limit(count: number): Promise<AiConsentColumns[]>;
        };
      };
    };
  };
}

/** The mailbox owner's consent row. Null when the mailbox has no user. */
export async function loadAiConsentForMailbox(
  db: unknown,
  mailboxAccountId: string,
): Promise<AiConsentColumns | null> {
  const query = db as ConsentReader;
  const [row] = await query
    .select({
      aiConsentVersion: users.aiConsentVersion,
      aiExplanationsConsentAt: users.aiExplanationsConsentAt,
      aiExplanationsRevokedAt: users.aiExplanationsRevokedAt,
      aiConsentScopes: users.aiConsentScopes,
      aiConsentDeclinedAt: users.aiConsentDeclinedAt,
      briefAiConsentAt: users.briefAiConsentAt,
      briefAiConsentVersion: users.briefAiConsentVersion,
      briefAiConsentRevokedAt: users.briefAiConsentRevokedAt,
      briefAiDeclinedAt: users.briefAiDeclinedAt,
    })
    .from(mailboxAccounts)
    .innerJoin(users, eq(users.id, mailboxAccounts.userId))
    .where(eq(mailboxAccounts.id, mailboxAccountId))
    .limit(1);
  return row ?? null;
}
