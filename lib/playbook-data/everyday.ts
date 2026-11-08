// lib/playbook-data/everyday.ts — small and everyday decisions. All "light": two or three quick questions, and "other
// routes" is optional, so a weekend or a pet does not get the weight of a career change.
import type { PlaybookDef } from '@/lib/decision-playbooks'

export const EVERYDAY_PLAYBOOKS: PlaybookDef[] = [
  { id: 'lifestyle.pet', label: 'Getting a pet', light: true,
    slots: [
      ['time', 'Time at home', 'How much time could you give a pet each day?', ['Little', 'A few hours', 'Most of the day'], 'r'],
      ['home', 'Home and landlord', 'Does your home and lease allow a pet?', ['Yes', 'Needs checking', 'No'], 'r'],
      ['costs', 'Costs', 'Have you thought through vet and daily costs?', ['Yes', 'Partly', 'No']],
    ],
    aliases: ['get a dog', 'get a cat', 'adopt a dog', 'adopt a cat', 'get a puppy', 'get a pet', 'adopt a rescue', 'buy a dog', 'which dog breed', 'rescue or breeder', 'get another pet', 'give up my dog'] },
  { id: 'lifestyle.trip', label: 'A trip or holiday', light: true,
    slots: [
      ['when', 'When', 'When would you go?', ['Within a month', 'In a few months', 'Later this year'], 'r'],
      ['budget', 'Budget', 'What budget do you have?', ['Tight', 'Comfortable', 'Flexible'], 'r'],
      ['with_whom', 'Who with', 'Who would you travel with?', ['Solo', 'A partner', 'Family', 'Friends']],
    ],
    aliases: ['take a trip', 'plan a vacation', 'where to travel', 'solo trip', 'take a holiday', 'weekend trip', 'travel abroad', 'honeymoon destination', 'take a vacation', 'go on holiday',
      'book flights now', 'trip with friends', 'backpacking trip', 'which destination'] },
  { id: 'lifestyle.habit', label: 'Starting or dropping a habit', light: true,
    slots: [
      ['habit', 'The habit', 'What habit are you thinking about?', null, 'r'],
      ['why', 'What for', 'What do you want from it?', ['Health', 'Focus', 'Calm', 'Productivity'], 'rm'],
      ['tried', 'Past tries', 'Have you tried before?', ['Yes, it faded', 'Yes, it stuck', 'Never']],
    ],
    aliases: ['start waking up early', 'wake up at five', 'start meditating', 'start journaling', 'quit social media', 'digital detox', 'reduce screen time', 'start reading more', 'cold showers',
      'morning routine', 'stop procrastinating', 'start a new routine', 'delete instagram'] },
  { id: 'lifestyle.fitness', label: 'Fitness and exercise', light: true,
    slots: [
      ['goal', 'What you are after', 'What do you want from it?', ['Strength', 'Weight', 'Energy', 'Company'], 'rm'],
      ['time', 'Time', 'How many days a week could you realistically train?', ['1–2', '3–4', '5+'], 'r'],
    ],
    aliases: ['join a gym', 'gym or run outside', 'hire a personal trainer', 'yoga or gym', 'start crossfit', 'home gym', 'buy a gym membership', 'join a sports club', 'learn to swim',
      'train for a race', 'start cycling', 'run a marathon', 'home workout or gym'] },
  { id: 'lifestyle.diet', label: 'Changing how you eat', light: true,
    slots: [
      ['reason', 'Why', 'What is behind it?', ['Health', 'Ethics', 'Weight', 'Curiosity'], 'rm'],
      ['household', 'Who it affects', 'Would it affect others you eat with?', ['Just me', 'My household', 'Social meals'], 'r'],
    ],
    aliases: ['go vegan', 'go vegetarian', 'try keto', 'intermittent fasting', 'cut out sugar', 'stop eating meat', 'go gluten free', 'cut carbs', 'meal prep', 'change my diet',
      'quit coffee', 'stop drinking coffee'] },
  { id: 'lifestyle.social', label: 'An invitation or social obligation', light: true,
    slots: [
      ['energy', 'Your energy', 'How are you for energy right now?', ['Plenty', 'Low', 'Drained'], 'r'],
      ['obligation', 'Obligation or want', 'Is it an obligation, or something you want?', ['An obligation', 'I want to', 'Both'], 'r'],
    ],
    aliases: ['go to the wedding', 'attend the party', 'skip the event', 'go to a reunion', 'accept an invitation', 'decline an invite', 'go out tonight', 'host a party', 'say yes to the invite',
      'attend a funeral', 'family function', 'go to a friends wedding'] },
  { id: 'lifestyle.hobby', label: 'Taking up a hobby or skill', light: true,
    slots: [
      ['hobby', 'The hobby', 'What is the hobby or interest?', null, 'r'],
      ['commit', 'Commitment', 'How much money and time would it take?', ['A little', 'A fair bit', 'A lot'], 'r'],
    ],
    aliases: ['learn guitar', 'learn piano', 'pick up a hobby', 'start painting', 'learn a language', 'learn to cook', 'join a club', 'take dance classes', 'learn photography',
      'start a podcast', 'learn chess', 'new hobby'] },
  { id: 'lifestyle.everyday', label: 'An everyday choice', light: true,
    slots: [
      ['options', 'The options', 'What are you choosing between?', null, 'r'],
      ['stakes', 'How much it matters', 'Does this matter much, or do you just want a nudge?', ['Matters a lot', 'Somewhat', 'Just a nudge'], 'r'],
    ],
    aliases: ['what should i eat', 'what to do this weekend', 'what to cook tonight', 'which movie to watch', 'which restaurant', 'what to wear', 'pick a gift', 'what gift to buy', 'where to eat',
      'plan my day', 'which book to read next', 'what to do today'] },
]
