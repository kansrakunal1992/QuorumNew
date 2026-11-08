// lib/playbook-data/money-home.ts — money, big purchases, housing and moving.
import type { PlaybookDef } from '@/lib/decision-playbooks'

export const MONEY_HOME_PLAYBOOKS: PlaybookDef[] = [
  // ── money ───────────────────────────────────────────────────────────────────
  { id: 'money.lump_sum', label: 'What to do with a sum of money',
    slots: [
      ['amount', 'The amount', 'Roughly how much is it, and where is it now?', null, 'rs'],
      ['horizon', 'When you might need it', 'When might you need this money?', ['Under 2 years', '2–5 years', '5–10 years', '10+ years'], 'r'],
      ['experience', 'Investing so far', 'How much have you invested before?', ['Never', 'A little', 'A fair amount']],
    ],
    aliases: ['invest a lump sum', 'what to do with my bonus', 'invest my savings', 'where to invest', 'invest in mutual funds', 'invest in stocks', 'put money in index funds',
      'invest or save', 'sip or lump sum', 'invest in gold', 'how to invest', 'invest in crypto', 'what to do with my inheritance', 'invest in fixed deposits'] },
  { id: 'money.debt_vs_invest', label: 'Paying off debt or investing',
    slots: [
      ['rate', 'Interest rate', 'Roughly what interest rate are you paying?', ['Under 8%', '8–12%', '12–20%', 'Over 20%'], 'rs'],
      ['buffer', 'Emergency buffer', 'How many months of expenses do you have set aside?', ['None', '1–3 months', '3–6 months', '6+ months'], 'rs'],
    ],
    aliases: ['pay off a loan or invest', 'prepay my home loan', 'pay off a credit card', 'clear debt first', 'repay a loan early', 'prepay a loan or invest', 'emi prepayment',
      'pay off a student loan', 'debt or savings', 'foreclose a loan', 'pay off my car loan'] },
  { id: 'money.take_loan', label: 'Borrowing money',
    slots: [
      ['purpose', 'What it is for', 'What is the loan for?', ['A home', 'Education', 'A business', 'Personal expenses'], 'r'],
      ['repay', 'Repaying it', 'Would the monthly payment fit comfortably?', ['Easily', 'A stretch', 'Not without cutting back'], 'rs'],
    ],
    aliases: ['take a loan', 'personal loan', 'borrow money', 'education loan', 'business loan', 'loan against property', 'consolidate credit card debt', 'apply for a loan',
      'borrow from family', 'take a loan for a car'] },
  { id: 'money.retire_early', label: 'Retiring early',
    slots: [
      ['target', 'Your number', 'Do you have a target amount in mind?', ['Yes', 'Roughly', 'No'], 'rs'],
      ['spending', 'Yearly spending', 'Do you know what you spend in a year?', ['Exactly', 'Roughly', 'No idea'], 'r'],
      ['income_after', 'Income afterwards', 'Would you earn anything after stopping full-time work?', ['Yes, some', 'Maybe', 'No']],
    ],
    aliases: ['retire early', 'early retirement', 'fire number', 'financial independence', 'coast fire', 'stop working at forty five', 'quit working early', 'semi retire',
      'retire at fifty', 'how much to retire'] },
  { id: 'money.lend_family', label: 'Lending or giving money to someone close',
    slots: [
      ['relation', 'Who is asking', 'Who is asking for the money?', ['A sibling', 'A parent', 'A friend', 'Another relative'], 'r'],
      ['can_lose', 'If never repaid', 'Could you afford never to get it back?', ['Yes', 'With difficulty', 'No'], 'rs'],
      ['size', 'How big it is', 'How big is it compared with your savings?', ['Small', 'A noticeable part', 'A large part'], 'rs'],
    ],
    aliases: ['lend money to my brother', 'lend money to a friend', 'loan to family', 'give money to my parents', 'co sign a loan', 'guarantee a loan', 'family asking for money',
      'lend to a relative', 'borrow from a friend', 'lend money to someone'] },
  { id: 'money.insurance', label: 'Insurance cover',
    slots: [
      ['dependents', 'Who relies on you', 'Who would be affected if something happened to you?', ['Only me', 'A partner', 'Kids', 'Parents'], 'rm'],
      ['coverage', 'Cover today', 'What cover do you have today?', ['None', 'Through work only', 'A personal policy'], 'r'],
    ],
    aliases: ['term insurance', 'health insurance', 'life insurance', 'ulip vs term', 'which insurance', 'buy insurance', 'increase my cover', 'insurance policy', 'top up health cover',
      'term plan or ulip'] },

  // ── purchases ───────────────────────────────────────────────────────────────
  { id: 'purchase.car', label: 'Buying a car',
    slots: [
      ['usage', 'How you would use it', 'How will you mainly use the car?', ['Daily commute', 'Family trips', 'Occasional use', 'Business'], 'r'],
      ['budget_fit', 'Price against budget', 'How does the price sit against your budget?', ['Well within', 'Stretching', 'Over'], 'rs'],
      ['fuel', 'Type', 'Are you considering electric, hybrid or petrol or diesel?', ['Electric', 'Hybrid', 'Petrol or diesel', 'Undecided']],
    ],
    aliases: ['buy a car', 'buy a new car', 'used car or new', 'buy an suv', 'buy an electric car', 'buy a tesla', 'lease a car', 'car or bike', 'upgrade my car', 'sell my car',
      'buy a second hand car', 'car loan or cash', 'buy a hatchback', 'buy a sedan', 'is a car worth it'] },
  { id: 'purchase.gadget', label: 'Buying a phone, laptop or gadget',
    slots: [
      ['current', 'What you have now', 'How is your current one doing?', ['Works fine', 'Slow or ageing', 'Broken'], 'r'],
      ['need_vs_want', 'Need or want', 'Is this a need or an upgrade you want?', ['A need', 'A want', 'Both'], 'r'],
    ],
    aliases: ['buy a phone', 'buy a laptop', 'buy a macbook', 'buy an iphone', 'upgrade my phone', 'buy a tablet', 'buy a camera', 'buy a tv', 'buy headphones', 'buy a smartwatch',
      'buy a gaming console', 'switch to android', 'switch to iphone', 'buy a drone'] },
  { id: 'purchase.big_ticket', label: 'A big or luxury purchase',
    slots: [
      ['price_vs', 'Price against income', 'How big is this price compared with your monthly income?', ['Under one month', '1–3 months', 'Over 3 months'], 'rs'],
      ['use', 'How often you would use it', 'How often would you realistically use it?', ['Daily', 'Weekly', 'Rarely'], 'r'],
      ['waiting', 'If you waited', 'Would waiting a few months cost you anything?', ['Nothing', 'A discount ends', 'A real cost']],
    ],
    aliases: ['buy a luxury watch', '=splurge', 'buy a designer bag', 'buy jewellery', 'buy a rolex', 'big purchase', 'treat myself', 'buy gold', 'buy a piano', 'buy a boat',
      'buy a motorcycle', 'buy a diamond ring', 'worth the price', 'expensive purchase'] },
  { id: 'purchase.home_goods', label: 'Furniture or an appliance',
    slots: [
      ['room', 'What it is for', 'What is it for?', ['Living room', 'Bedroom', 'Kitchen', 'Office'], 'r'],
      ['quality', 'Quality or price', 'Would you rather spend more to have it last?', ['Yes', 'Middle ground', 'Cheapest that works'], 'r'],
    ],
    aliases: ['buy a sofa', 'buy a mattress', 'buy furniture', 'buy an air conditioner', 'buy a fridge', 'buy a washing machine', 'buy a standing desk', 'buy a treadmill',
      'buy an appliance', 'replace my mattress', 'buy a bed', 'buy a dining table'] },

  // ── housing ─────────────────────────────────────────────────────────────────
  { id: 'housing.buy', label: 'Buying a home',
    slots: [
      ['property', 'The property', 'Is this a specific property or are you still browsing?', ['A specific one', 'A shortlist', 'Browsing'], 'r'],
      ['price', 'Price and funding', 'Roughly what is the price, and how would you pay: savings, a loan, or both?', null, 'rs'],
      ['affordability', 'Monthly fit', 'If there is a loan, how would the monthly payment sit against your income?', ['Comfortably', 'A stretch', 'Too tight', 'No loan needed'], 'rs'],
      ['horizon', 'How long you would stay', 'How many years do you expect to live there or hold it?', ['Under 3 years', '3–7 years', '7+ years'], 'r'],
      ['area', 'The area', 'How well do you know the area and its resale prospects?', ['Know it well', 'Researched it', 'Not much']],
    ],
    aliases: ['buy a house', 'buy a home', 'buy a flat', 'buy an apartment', 'buy property', 'buy a villa', 'buy a plot', 'buy a condo', 'buy my first home', 'house hunting',
      'ready to move flat', 'under construction flat', 'new flat or resale', 'buy land', 'buy a townhouse', 'home purchase'] },
  { id: 'housing.rent_vs_buy', label: 'Renting or buying',
    slots: [
      ['rent_now', 'Rent today', 'What do you pay in rent now?', null, 'rs'],
      ['price', 'Price you are looking at', 'Roughly what would you pay to buy?', null, 'rs'],
      ['stay', 'How long', 'How long do you expect to stay in this city?', ['Under 3 years', '3–7 years', '7+ years'], 'r'],
    ],
    aliases: ['rent or buy', 'rent vs buy', 'buy or rent', 'keep renting', 'stop renting', 'rent a while longer', 'is renting wasting money', 'own or rent', 'rent versus buying'] },
  { id: 'housing.sell', label: 'Selling a home',
    slots: [
      ['why_sell', 'Why sell', 'Why are you thinking of selling?', ['Need cash', 'Moving', 'Upgrading', 'The market is high'], 'rm'],
      ['next_home', 'Where you would live', 'What would you do for housing afterwards?', ['Buy another', 'Rent', 'Move in with family'], 'r'],
      ['owed', 'What you still owe', 'Is there a loan left on it?', ['None', 'A small one', 'A large one'], 'rs'],
    ],
    aliases: ['sell my house', 'sell my flat', 'sell my apartment', 'sell my home', 'list my house', 'sell property', 'sell inherited property', 'sell my plot', 'downsize my home',
      'sell and move', 'sell ancestral house', 'sell land'] },
  { id: 'housing.renovate', label: 'Renovating or building',
    slots: [
      ['scope', 'What work', 'What would you do?', ['A cosmetic refresh', 'Kitchen or bathroom', 'Structural work', 'A full renovation'], 'r'],
      ['budget', 'Budget', 'Is the budget set?', ['Yes', 'A rough idea', 'No'], 'rs'],
      ['stay', 'How long you will stay', 'Will you stay long enough to benefit?', ['Yes', 'Maybe', 'Planning to sell'], 'r'],
    ],
    aliases: ['renovate my house', 'renovate the kitchen', 'remodel the bathroom', 'home renovation', 'redo the interiors', 'extend my house', 'build a house', 'build an extension',
      'renovate before selling', 'add a floor', 'home makeover'] },
  { id: 'housing.lease', label: 'Your rental or lease',
    slots: [
      ['lease_end', 'Lease end', 'When does the lease end?', ['Within 2 months', '2–6 months', 'Later'], 'r'],
      ['reason', 'What is prompting this', 'What is making you think of moving?', ['A rent hike', 'Space', 'Location', 'Landlord issues'], 'rm'],
    ],
    aliases: ['renew my lease', 'break my lease', 'move out of my apartment', 'rent hike', 'find a new apartment', 'renew the rent agreement', 'shift to a new flat', 'rent a bigger place',
      'sublet my place', 'roommate or live alone', 'live alone'] },

  // ── moving ──────────────────────────────────────────────────────────────────
  { id: 'relocation.abroad', label: 'Moving to another country',
    slots: [
      ['visa', 'Visa and permission', 'Do you have the right to live and work there?', ['Yes', 'In progress', 'Not yet'], 'r'],
      ['pull', 'The pull', 'What is pulling you there?', ['A job', 'Study', 'Quality of life', 'Family or partner'], 'rm'],
      ['cost', 'Cost of living', 'Have you worked out what living there would cost?', ['Yes', 'Roughly', 'No']],
    ],
    aliases: ['move abroad', 'move to canada', 'move to usa', 'move to the uk', 'move to dubai', 'move to germany', 'move to australia', 'move to singapore', '=emigrate',
      'relocate overseas', 'work abroad', 'settle abroad', 'move to europe', '=immigrate', 'move to another country'] },
  { id: 'relocation.domestic', label: 'Moving to another city',
    slots: [
      ['why', 'The reason', 'What is behind the move?', ['A job', 'Cost', 'Lifestyle', 'Family'], 'rm'],
      ['ties', 'What you leave behind', 'What would you miss most?', ['Family', 'Friends', 'My community', 'Familiar routines'], 'rm'],
    ],
    aliases: ['move to another city', 'relocate for work', 'move to bangalore', 'move to mumbai', 'move to delhi', 'change cities', 'move to a new city', 'shift cities',
      'move to the suburbs', 'move out of the city', 'move to a smaller town', 'move states'] },
  { id: 'relocation.move_home', label: 'Moving back home',
    slots: [
      ['reason', 'Why return', 'What is bringing you back?', ['Family', 'Cost', 'Career opportunities', 'Missing home'], 'rm'],
      ['work_back', 'Work back there', 'Would you have work there?', ['Yes, lined up', 'Probably', 'No'], 'r'],
    ],
    aliases: ['move back home', 'return to my hometown', 'move back to india', 'return home after abroad', 'go back to my home country', 'move back in with my parents', '=repatriate',
      'leave abroad and return'] },
  { id: 'relocation.for_partner', label: 'Moving for a partner',
    slots: [
      ['whose', 'Whose move', 'Whose job or plan is driving the move?', ['Mine', 'My partner', 'Both of us'], 'r'],
      ['your_work', 'Your own work', 'What would happen to your own work or study?', ['I can continue', 'I would change it', 'I would pause'], 'r'],
    ],
    aliases: ['move for my partner', 'move for my wife', 'move for my husband', 'follow my partner', 'move for my boyfriend', 'relocate for my spouse', 'long distance or move', 'move for love'] },
]
