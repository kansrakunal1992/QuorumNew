// app/api/referral/track/route.ts
// Item #17 — plain referral link attribution. No rewards/incentive
// mechanics yet, per the working decision on this item — this just records
// who referred whom, using a user's own id directly as their referral code
// (?ref=<user_id>), so there's no separate code-generation step.

import { NextResponse }                      from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase'

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(authHeader.slice(7).trim())
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const referredUserId = await resolveUserId(req)
  if (!referredUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { referrerId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const referrerId = (body.referrerId ?? '').trim()
  if (!referrerId) return NextResponse.json({ error: 'referrerId is required' }, { status: 400 })
  if (referrerId === referredUserId) {
    return NextResponse.json({ status: 'ignored_self_referral' })
  }

  const supabase = createServiceClient()

  // Referrer must be a real user — cheap existence check via auth admin API.
  const { data: referrerCheck } = await supabase.auth.admin.getUserById(referrerId)
  if (!referrerCheck?.user) {
    return NextResponse.json({ error: 'Invalid referral link' }, { status: 400 })
  }

  // UNIQUE(referred_user_id) means a user can only ever be attributed once —
  // if they were already referred by someone (including a prior call to
  // this same route), this just no-ops rather than erroring.
  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_user_id', referredUserId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ status: 'already_attributed' })
  }

  const { error } = await supabase.from('referrals').insert({
    referrer_id:      referrerId,
    referred_user_id: referredUserId,
  })
  if (error) {
    console.error('[Referral Track] Insert error:', error)
    return NextResponse.json({ error: 'Failed to record referral' }, { status: 500 })
  }

  return NextResponse.json({ status: 'recorded' }, { status: 201 })
}
