// lib/playbook-data/work.ts — situations at work and in business. Format: see PlaybookDef in lib/decision-playbooks.ts.
//   slot = [key, label, question, tap-answers | null, flags]   flags: r required · m pick several · s sensitive
import type { PlaybookDef } from '@/lib/decision-playbooks'

export const WORK_PLAYBOOKS: PlaybookDef[] = [
  // ── leaving a job ───────────────────────────────────────────────────────────
  { id: 'career_exit.freelance', label: 'Leaving to work for yourself',
    slots: [
      ['clients', 'Clients so far', 'Do you already have paying clients or leads?', ['Paying clients', 'A few leads', 'None yet'], 'r'],
      ['income_gap', 'Income to replace', 'Roughly what monthly income would you need to replace?', null, 'rs'],
      ['pricing', 'Your rate', 'Do you know what you would charge?', ['Yes', 'Roughly', 'No idea']],
    ],
    aliases: ['quit job to freelance', 'leave my job and freelance', 'go freelance', 'become a consultant', 'go independent', 'freelance full time',
      'leave corporate to freelance', 'start consulting', 'work for myself', 'become self employed', 'quit and consult', 'go solo as a freelancer'] },
  { id: 'career_exit.sabbatical', label: 'Taking a career break',
    slots: [
      ['purpose', 'What the break is for', 'What would the break be for?', ['Rest and recovery', 'Travel', 'A project or learning', 'Working out what is next'], 'rm'],
      ['length', 'How long', 'How long are you thinking of?', ['1–3 months', '3–6 months', '6–12 months', 'A year or more'], 'r'],
      ['return_path', 'Coming back', 'Could you return to your field or employer afterwards?', ['Yes, likely', 'Maybe', 'Probably not']],
    ],
    aliases: ['take a sabbatical', '=sabbatical', 'career break', 'gap year from work', 'take a year off work', 'extended leave', 'time off to travel',
      'long break from work', 'unpaid leave', 'mini retirement', 'step away from work for a while', 'pause my career'] },
  { id: 'career_exit.toxic_job', label: 'Leaving a job that is wearing you down',
    slots: [
      ['problem', 'What is wrong', 'What is making the job hard to stay in?', ['My manager', 'The culture', 'The workload', 'Pay or growth'], 'rm'],
      ['tried', 'What you have tried', 'Have you tried to fix it?', ['Spoke to my manager', 'Spoke to HR', 'Asked for a transfer', 'Not yet'], 'rm'],
    ],
    aliases: ['toxic workplace', 'hate my job', 'bad boss', 'quit because of my manager', 'burnt out at work', 'leave a toxic job', 'unhappy at work',
      'dread going to work', 'workplace bullying', 'hostile work environment', 'job is making me miserable', 'stressed at work'] },

  // ── job offers ──────────────────────────────────────────────────────────────
  { id: 'job_offer.startup_vs_corporate', label: 'Startup or established company',
    slots: [
      ['startup_stage', 'Startup stage', 'How far along is the startup?', ['Pre-seed or seed', 'Series A or B', 'Later stage'], 'r'],
      ['equity', 'Pay and equity', 'How does the pay compare, and how much would equity realistically matter?', null, 'rs'],
      ['cushion', 'Financial cushion', 'If the startup folded in a year, could you cope?', ['Easily', 'With difficulty', 'Not really'], 'rs'],
    ],
    aliases: ['startup vs corporate', 'startup or big company', 'join a startup', 'join startup or stay', 'leave big tech for a startup', 'offer from a startup',
      'startup equity offer', 'big tech offer vs startup', 'corporate or startup', 'early stage startup job', 'join an early stage company'] },
  { id: 'job_offer.negotiate', label: 'Negotiating an offer',
    slots: [
      ['gap', 'Gap to your target', 'How far is the offer from what you hoped for?', ['Close', 'Moderately short', 'Far short'], 'r'],
      ['leverage', 'Your leverage', 'Do you have another offer or a strong current job?', ['Another offer', 'A good current job', 'Neither'], 'r'],
    ],
    aliases: ['negotiate an offer', 'counter offer', 'negotiate salary', 'ask for more money', 'offer is too low', 'lowball offer', 'negotiate the package',
      'push back on an offer', 'negotiate my compensation', 'salary negotiation'] },
  { id: 'job_offer.competing_offers', label: 'Choosing between job offers',
    slots: [
      ['difference', 'What separates them', 'What is the biggest difference between the two?', ['Pay', 'Role and growth', 'Company and stability', 'Location or hours'], 'rm'],
      ['pull', 'What pulls you', 'Which one pulls you more, even slightly?', ['The first offer', 'The second offer', 'Neither yet'], 'r'],
    ],
    aliases: ['two job offers', 'competing offers', 'multiple offers', 'choose between offers', 'which offer to accept', 'several offers', 'pick between jobs',
      'two companies offered me', 'decide between two jobs', 'which job to take', 'offer a or offer b'] },

  // ── moves inside a career ───────────────────────────────────────────────────
  { id: 'career_move.ask_raise', label: 'Asking for a raise or promotion',
    slots: [
      ['basis', 'Your case', 'What is your case for more pay or a bigger role?', ['Strong results', 'Bigger scope', 'Market pay is higher', 'Cost of living'], 'rm'],
      ['last_raise', 'Last increase', 'When did you last get a raise or promotion?', ['Within 6 months', '6–18 months ago', 'Over 18 months', 'Never'], 'r'],
      ['if_no', 'If they say no', 'What would you do if they say no?', ['Stay as I am', 'Look elsewhere', 'Ask for other perks']],
    ],
    aliases: ['ask for a raise', 'ask for a promotion', 'request a salary increase', 'negotiate a raise', 'deserve a raise', 'salary hike request', 'ask my boss for more pay',
      'appraisal negotiation', 'pay rise', 'ask for a pay increase', 'ask for a title change'] },
  { id: 'career_move.accept_promotion', label: 'A promotion or bigger role on offer',
    slots: [
      ['change', 'What changes', 'What would the new role change?', ['More pay', 'More responsibility', 'Managing people', 'A different location'], 'rm'],
      ['wanting', 'Do you want it', 'Is this a role you want, or one you think you should take?', ['I want it', 'Mixed', 'Mostly pressure'], 'r'],
    ],
    aliases: ['accept a promotion', 'promotion offer', 'take the promotion', 'turn down a promotion', 'offered a promotion', 'new role at my company', 'step up to a manager role',
      'internal role change', 'offered a bigger role', 'decline a promotion'] },
  { id: 'career_move.switch_field', label: 'Changing careers',
    slots: [
      ['target', 'New field', 'Which field are you thinking of moving into?', null, 'r'],
      ['transferable', 'What carries over', 'How much of your current experience carries over?', ['A lot', 'Some', 'Almost none'], 'r'],
      ['pay_cut', 'Pay impact', 'Would you take a pay cut at first?', ['No', 'A small one', 'A big one'], 'rs'],
    ],
    aliases: ['switch careers', 'career change', 'change career', 'change industry', 'move into tech', 'move to a new field', 'pivot careers', 'transition to product management',
      'start over in a new field', 'career switch at thirty', 'retrain for a new career', 'leave my field'] },
  { id: 'career_move.management_vs_ic', label: 'Management or specialist track',
    slots: [
      ['draw', 'What draws you', 'What draws you to the new track?', ['Influence', 'Pay', 'Interest in people', 'Interest in the craft'], 'rm'],
      ['experience', 'Experience so far', 'Have you led people before?', ['Yes', 'Informally', 'Never'], 'r'],
    ],
    aliases: ['management or individual contributor', 'become a manager', 'manager vs ic', 'go into management', 'stay technical', 'people manager or senior engineer',
      'ic track', 'move into leadership', 'manager or specialist', 'lead a team or stay hands on'] },
  { id: 'career_move.change_team', label: 'Moving teams inside your company',
    slots: [
      ['reason', 'Why move', 'Why move teams?', ['Better work', 'Better manager', 'Growth', 'Pressure'], 'rm'],
      ['standing', 'How it would land', 'How would your current manager take it?', ['Supportive', 'Neutral', 'Upset'], 'r'],
    ],
    aliases: ['switch teams', 'internal transfer', 'change teams', 'move to another team', 'transfer to another department', 'internal move', 'rotate to a new team',
      'move to a different department', 'ask for a transfer'] },
  { id: 'career_move.side_project', label: 'Starting something on the side',
    slots: [
      ['time', 'Time you have', 'How many hours a week could you give it?', ['Under 5', '5–10', '10–20', '20+'], 'r'],
      ['goal', 'What it is for', 'What do you want it to become?', ['A hobby', 'Extra income', 'A future business', 'Learning'], 'r'],
    ],
    aliases: ['start a side project', 'side hustle', 'start a side business', 'work on a side gig', '=moonlight', 'side income', 'build something on weekends',
      'start a blog', 'start a youtube channel', 'side project alongside my job', 'start a newsletter'] },

  // ── people decisions as a manager ──────────────────────────────────────────
  { id: 'team.fire', label: 'Letting someone go',
    slots: [
      ['record', 'Their record', 'What does their record look like?', ['Declining', 'Consistently weak', 'Fine until recently', 'A conduct issue'], 'rs'],
      ['documented', 'Feedback given', 'Have they had clear feedback and a chance to improve?', ['Yes, documented', 'Verbally', 'Not yet'], 'r'],
      ['rules', 'Rules and legal', 'Do you know what your policy or local rules require?', ['Yes', 'Partly', 'No']],
    ],
    aliases: ['fire an employee', 'fire my manager', 'let someone go', 'terminate an employee', 'fire an underperformer', 'dismiss an employee', 'fire a friend',
      'fire a cofounder', 'fire a team member', 'put on a pip', 'performance improvement plan', 'let go of an employee', 'fire my assistant', 'terminate my head of sales'] },
  { id: 'team.hire', label: 'Hiring',
    slots: [
      ['role_need', 'The role', 'Is the need for this role clear?', ['Clear', 'Fuzzy', 'Urgent but vague'], 'r'],
      ['budget', 'Budget', 'Is the budget approved?', ['Yes', 'Partly', 'No'], 'r'],
      ['candidate', 'Candidates', 'Do you already have someone in mind?', ['Yes', 'A few', 'No']],
    ],
    aliases: ['hire an engineer', 'hire a developer', 'hire a designer', 'hire a cto', 'first hire', 'hire a manager', 'hire a salesperson', 'hire an assistant', 'hire or outsource',
      'hire junior or senior', 'hire full time or contractor', 'hire a head of sales', 'build a team', 'hire an intern', 'which candidate to hire', 'choose between candidates'] },
  { id: 'team.promote', label: 'Promoting someone',
    slots: [
      ['readiness', 'Their readiness', 'Are they already doing parts of the next role?', ['Yes', 'Some of it', 'Not yet'], 'r'],
      ['ripple', 'Effect on the team', 'Who else might expect this or be affected?', ['Peers who want it', 'Nobody', 'Their own manager'], 'rm'],
    ],
    aliases: ['promote an employee', 'who to promote', 'promote my best engineer', 'promote a team lead', 'promote or hire externally', 'give someone a raise', 'promote to manager',
      'internal promotion', 'promote someone on my team'] },
  { id: 'team.restructure', label: 'Restructuring or layoffs',
    slots: [
      ['why_restructure', 'Why now', 'What is driving the change?', ['Cost', 'A strategy shift', 'Performance', 'Merger or growth'], 'rm'],
      ['scale', 'How many people', 'How many people would be affected?', ['A few', 'A whole team', 'Most of the company'], 'r'],
    ],
    aliases: ['lay off employees', '=layoffs', 'restructure the team', 'reorganize the team', '=reorg', 'cut headcount', 'downsize the team', 'close a department', 'merge two teams',
      'change team structure', 'hiring freeze', 'reduce team size'] },
  { id: 'team.conflict', label: 'A conflict on the team',
    slots: [
      ['who', 'Who is involved', 'Who is in conflict?', ['Two team members', 'Me and a report', 'Me and my boss', 'Two teams'], 'r'],
      ['impact', 'Impact', 'How much is it affecting the work?', ['A little', 'Noticeably', 'Severely'], 'r'],
      ['tried', 'What you have tried', 'What have you tried so far?', ['Talked to each side', 'Mediation', 'Escalated', 'Nothing yet'], 'rm'],
    ],
    aliases: ['team conflict', 'two employees fighting', 'difficult employee', 'toxic team member', 'conflict with my boss', 'disagree with my manager', 'difficult boss',
      'address a performance issue', 'underperforming employee', 'difficult conversation at work', 'mediate between employees'] },

  // ── product and technical calls ─────────────────────────────────────────────
  { id: 'product.build_vs_buy', label: 'Build it or buy it',
    slots: [
      ['core', 'Is it core', 'Is this core to what makes your product different?', ['Yes', 'Somewhat', 'No'], 'r'],
      ['capacity', 'Team capacity', 'Do you have the people and time to build it?', ['Yes', 'Stretched', 'No'], 'r'],
      ['lockin', 'Switching later', 'How hard would it be to switch later?', ['Easy', 'Moderate', 'Very hard']],
    ],
    aliases: ['build vs buy', 'build or buy', 'build in house or use a vendor', 'buy a tool or build', 'use a third party service', 'saas or custom build', 'outsource development',
      'build it ourselves', 'vendor selection', 'which vendor to choose', 'choose a crm', 'choose a tool'] },
  { id: 'product.ship_or_delay', label: 'Ship now or wait',
    slots: [
      ['quality', 'State of it', 'How ready is it?', ['Solid', 'Mostly there', 'Rough'], 'r'],
      ['cost_delay', 'Cost of waiting', 'What does waiting cost?', ['Not much', 'A deadline', 'Competitors', 'Revenue'], 'rm'],
      ['rollback', 'Can you undo it', 'Could you roll it back if it goes wrong?', ['Easily', 'With effort', 'No'], 'r'],
    ],
    aliases: ['ship now or wait', 'launch now or later', 'delay the launch', 'ship the feature', 'release this week', 'push the release', 'go live now', 'soft launch or full launch',
      'ship an mvp', 'launch with bugs', 'beta or full release', 'move the launch date'] },
  { id: 'product.pricing', label: 'A pricing decision',
    slots: [
      ['why_price', 'Why change it', 'What is prompting the pricing change?', ['Costs rose', 'Value is higher', 'Competitors', 'Low conversion'], 'rm'],
      ['customers', 'Existing customers', 'How would existing customers be treated?', ['Keep their price', 'Same change', 'Not decided'], 'r'],
    ],
    aliases: ['raise prices', 'change pricing', 'pricing model', 'freemium or paid', 'usage based pricing', 'subscription or one time', 'add a free plan', 'lower our price', 'discount strategy',
      'price increase', 'annual plan pricing', 'how much to charge'] },
  { id: 'product.tech_migration', label: 'A technical migration or rewrite',
    slots: [
      ['pain', 'The pain', 'What problem would the change solve?', ['Speed', 'Cost', 'Maintenance', 'Hiring'], 'rm'],
      ['risk', 'What could break', 'What breaks if it goes wrong?', ['Little', 'Some customers', 'The core product'], 'r'],
      ['effort', 'Effort', 'How long would it take?', ['Weeks', 'Months', 'A year or more'], 'r'],
    ],
    aliases: ['rewrite the app', 'migrate to aws', 'migrate to kubernetes', 'change tech stack', 'move to microservices', 'rewrite in go', 'switch databases', 'upgrade the framework',
      'adopt typescript', 'refactor or rewrite', 'move to the cloud', 'replace legacy system', 'choose a programming language', 'choose a framework'] },
  { id: 'product.prioritize', label: 'Deciding what to build next',
    slots: [
      ['goal', 'The one goal', 'What is the one goal this quarter?', ['Growth', 'Retention', 'Revenue', 'Quality'], 'r'],
      ['evidence', 'Evidence', 'What evidence do you have for each option?', ['Data', 'Customer requests', 'Gut instinct'], 'rm'],
    ],
    aliases: ['prioritize the roadmap', 'which feature first', 'what to build next', 'roadmap priorities', 'feature prioritization', 'say no to a feature', 'cut scope', 'choose between features',
      'quarterly priorities', 'backlog prioritization', 'kill a feature', 'sunset a feature', 'open source our code'] },

  // ── business ────────────────────────────────────────────────────────────────
  { id: 'business.start', label: 'Starting a business',
    slots: [
      ['idea_stage', 'Where the idea is', 'How far along is the idea?', ['Just a thought', 'Researched it', 'Tested with customers', 'Already earning'], 'r'],
      ['funding', 'Funding the first year', 'How would you fund the first year?', ['Savings', 'Investors', 'Revenue', 'Not worked out'], 'rm'],
      ['commitment', 'Full-time or not', 'Would you do this full-time from day one?', ['Yes', 'Alongside my job'], 'r'],
    ],
    aliases: ['start a business', 'start my own business', 'start a startup', 'launch a company', 'start a company', 'open a business', 'start a venture', 'become an entrepreneur',
      'start an agency', 'open a restaurant', 'open a cafe', 'open a shop', 'open a store', 'start an online business', 'start an ecommerce store', 'quit my job to start a business'] },
  { id: 'business.raise_funding', label: 'Raising money for the business',
    slots: [
      ['stage', 'Stage', 'Where is the company right now?', ['Idea', 'Early revenue', 'Growing fast'], 'r'],
      ['dilution', 'What you would give up', 'How much of the company would you be giving up?', ['Under 10%', '10–25%', 'Over 25%', 'Not set'], 'r'],
      ['without', 'Without investors', 'Could revenue or a loan carry you instead?', ['Yes', 'Slowly', 'No']],
    ],
    aliases: ['raise funding', 'raise vc money', 'take investor money', 'bootstrap or raise', 'raise a seed round', 'raise a series a', 'accept a term sheet', 'angel investment',
      'vc or bootstrap', 'dilute equity', 'take outside funding', 'try crowdfunding'] },
  { id: 'business.sell', label: 'Selling the business',
    slots: [
      ['offer', 'The offer', 'Is there a real offer, or are you exploring?', ['A real offer', 'Early conversations', 'Just exploring'], 'r'],
      ['reason', 'Why sell', 'Why consider selling?', ['I am tired', 'Good price', 'Need cash', 'Growth needs more than I have'], 'rm'],
      ['after', 'After the sale', 'What would you do afterwards?', ['Stay on', 'Start something new', 'Rest']],
    ],
    aliases: ['sell my business', 'sell my company', 'sell my startup', 'acquisition offer', 'get acquired', 'exit my business', 'accept an acquisition', 'buyout offer', 'sell my shop', 'sell my practice'] },
  { id: 'business.shut_down', label: 'Closing the business',
    slots: [
      ['numbers', 'How long it can last', 'How long can the business keep going at its current pace?', ['Under 3 months', '3–6 months', '6–12 months', 'Indefinitely'], 'rs'],
      ['obligations', 'What you owe', 'Are there debts, staff or contracts that would be affected?', ['Staff', 'Debts', 'Customers', 'None'], 'rm'],
    ],
    aliases: ['shut down my business', 'close my startup', 'wind down the company', 'shut down the company', 'close my shop', 'give up on my startup', 'stop the business',
      'close the business', 'fold the company', 'dissolve the company'] },
  { id: 'business.pivot', label: 'Changing direction',
    slots: [
      ['signal', 'What is not working', 'What is telling you the current direction is not working?', ['Low sales', 'Customers leave', 'The market changed', 'I lost interest'], 'rm'],
      ['new_idea', 'The new direction', 'How much evidence is there for the new direction?', ['Strong', 'Some', 'Just a hunch'], 'r'],
    ],
    aliases: ['pivot my startup', 'pivot the business', 'change business model', 'change direction', 'switch target market', 'shift to b2b', 'move upmarket', 'change our product',
      'new business direction', 'double down or pivot'] },
  { id: 'business.cofounder', label: 'A problem with a co-founder or partner',
    slots: [
      ['issue', 'The issue', 'What is the disagreement about?', ['Equity', 'Workload', 'Direction', 'Trust'], 'rm'],
      ['paper', 'What is on paper', 'Do you have a founder agreement?', ['Yes', 'Informal', 'No'], 'r'],
    ],
    aliases: ['cofounder dispute', 'co founder conflict', 'cofounder wants to leave', 'buy out a co founder', 'split equity', 'partner wants out', 'business partner fight',
      'remove a cofounder', 'founder breakup', 'cofounder not working out'] },
  { id: 'business.expand', label: 'Growing or expanding',
    slots: [
      ['how', 'What kind of growth', 'What kind of growth is it?', ['A new city', 'A new product', 'New customers', 'Online'], 'r'],
      ['capital', 'Money needed', 'Do you have the money to do this?', ['Yes', 'Partly', 'No'], 'rs'],
      ['proof', 'What you have tested', 'Have you tested it in a small way?', ['Yes', 'A little', 'No']],
    ],
    aliases: ['expand my business', 'open a second branch', 'enter a new market', 'scale the business', 'open another location', 'hire to scale', 'new product line', 'grow to a new city',
      'franchise my business', 'open a second store'] },
]
