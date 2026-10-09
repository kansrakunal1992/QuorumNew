// app/q/page.tsx
// -- Phase 3 (retention work): a short, bookmarkable "bring me a decision" door --
// /q opens the home screen with the chat input focused (ChatIntake reads ?q=1).
// Meant for the home-screen icon, a bookmark, or a link in a weekly email --
// somewhere the person lands because they have something on their mind right now.

import { redirect } from 'next/navigation'

export default function QuickEntry() {
  redirect('/?q=1')
}
