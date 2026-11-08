// lib/playbook-data/index.ts — the whole library. Add a situation to the matching file; the tests check it.
import type { PlaybookDef } from '@/lib/decision-playbooks'
import { WORK_PLAYBOOKS } from './work'
import { MONEY_HOME_PLAYBOOKS } from './money-home'
import { PEOPLE_PLAYBOOKS } from './people'
import { EVERYDAY_PLAYBOOKS } from './everyday'

export const PLAYBOOK_DEFS: PlaybookDef[] = [
  ...WORK_PLAYBOOKS, ...MONEY_HOME_PLAYBOOKS, ...PEOPLE_PLAYBOOKS, ...EVERYDAY_PLAYBOOKS,
]
