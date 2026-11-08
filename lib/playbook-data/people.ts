// lib/playbook-data/people.ts — relationships, family, health and education.
// Sensitive answers are flagged "s" so the card offers "Prefer not to say". Health situations only gather context for the
// Council; none of them gives medical advice.
import type { PlaybookDef } from '@/lib/decision-playbooks'

export const PEOPLE_PLAYBOOKS: PlaybookDef[] = [
  // ── relationships ───────────────────────────────────────────────────────────
  { id: 'relationship.breakup', label: 'Whether to end a relationship',
    slots: [
      ['length', 'How long together', 'How long have you been together?', ['Under a year', '1–3 years', '3–7 years', 'Over 7 years'], 'r'],
      ['core_issue', 'The core problem', 'What is the main thing that makes you doubt it?', ['Different life goals', 'Trust', 'Communication', 'Drifting apart'], 'rm'],
      ['tried', 'What you have tried', 'Have you tried working on it together?', ['Talked openly', 'Counselling', 'Time apart', 'Not yet'], 'rm'],
    ],
    aliases: ['break up', '=breakup', 'end the relationship', 'leave my boyfriend', 'leave my girlfriend', 'end things', 'relationship ending', 'stay or leave a relationship',
      'unhappy in my relationship', 'fall out of love', 'leave my partner', 'break up with my girlfriend'] },
  { id: 'relationship.propose', label: 'Marriage and commitment',
    slots: [
      ['time_together', 'Time together', 'How long have you been together?', ['Under 2 years', '2–4 years', 'Over 4 years'], 'r'],
      ['aligned', 'Life goals', 'Are you aligned on big things like kids, money and where to live?', ['Yes', 'Mostly', 'Not yet discussed'], 'rs'],
      ['families', 'Families', 'How would both families take it?', ['Supportive', 'Mixed', 'Opposed'], 's'],
    ],
    aliases: ['=propose', 'propose to my girlfriend', 'ask her to marry me', 'get engaged', 'should we get married', 'marry my boyfriend', 'ready for marriage', 'marry or wait',
      'wedding timing', 'tie the knot', 'arranged marriage', 'accept a marriage proposal'] },
  { id: 'relationship.divorce', label: 'Whether to end a marriage',
    slots: [
      ['years', 'Length of marriage', 'How long have you been married?', ['Under 3 years', '3–10 years', 'Over 10 years'], 'r'],
      ['kids', 'Children', 'Are there children involved?', ['Yes', 'No', 'Planning to'], 'rs'],
      ['tried', 'What you have tried', 'What have you tried so far?', ['Counselling', 'A separation', 'Open talks', 'Nothing yet'], 'rm'],
    ],
    aliases: ['get a divorce', '=divorce', 'divorce my husband', 'divorce my wife', 'separate from my spouse', 'legal separation', 'marriage not working', 'end my marriage',
      'stay married', 'trial separation', 'marriage counselling or divorce'] },
  { id: 'relationship.move_in', label: 'Moving in together',
    slots: [
      ['time_together', 'Time together', 'How long have you been together?', ['Under a year', '1–2 years', 'Over 2 years'], 'r'],
      ['costs', 'Money and space', 'How would rent and household costs be split?', ['Equally', 'By income', 'Not discussed'], 'r'],
      ['reason', 'Why now', 'What is behind moving in?', ['Wanting to be closer', 'Saving money', 'A lease ending', 'Pressure'], 'rm'],
    ],
    aliases: ['move in together', 'live together', 'move in with my partner', 'move in with my boyfriend', 'move in with my girlfriend', '=cohabit', 'share an apartment with my partner',
      'living together before marriage', 'move in with my fiance'] },
  { id: 'relationship.friendship', label: 'A strained friendship',
    slots: [
      ['what_happened', 'What happened', 'What has strained the friendship?', ['A specific incident', 'Drifting apart', 'One-sided effort', 'Different values'], 'rm'],
      ['closeness', 'How close', 'How close are you, or were you?', ['Very close', 'Close', 'Casual'], 'r'],
      ['spoken', 'Have you talked', 'Have you raised it with them?', ['Yes', 'I tried', 'Not yet'], 'r'],
    ],
    aliases: ['end a friendship', 'friend conflict', 'friend keeps cancelling', 'drifting apart from a friend', 'cut off a friend', 'confront a friend', 'toxic friend', 'lose a friend',
      'fell out with a friend', 'friend betrayed me', 'ghost a friend'] },
  { id: 'relationship.forgive', label: 'Forgiving or reconciling',
    slots: [
      ['what_done', 'What happened', 'What are you weighing forgiving?', null, 'r'],
      ['pattern', 'One-off or pattern', 'Was it a one-off, or has it happened before?', ['One-off', 'Happened before', 'A long pattern'], 'r'],
      ['response', 'Their response', 'Have they acknowledged it?', ['Yes, sincerely', 'Partly', 'No'], 'r'],
    ],
    aliases: ['forgive my brother', 'forgive my father', 'forgive my mother', 'forgive a cheating partner', '=reconcile', 'make up with', 'forgive and move on', 'take back an ex',
      'get back together', 'apologize first', 'give a second chance', 'forgive a friend'] },
  { id: 'relationship.family_boundary', label: 'Setting limits with family',
    slots: [
      ['who', 'Who it involves', 'Who are you setting a limit with?', ['A parent', 'A sibling', 'In-laws', 'Another relative'], 'rs'],
      ['stakes', 'What is at stake', 'What is the main thing at stake?', ['Peace in the family', 'My wellbeing', 'Money', 'My own choices'], 'rm'],
    ],
    aliases: ['set boundaries with my parents', 'in laws interfering', 'cut off family', 'limit contact with family', 'say no to my parents', 'family pressure to marry',
      'stop family interference', 'distance from toxic family', 'parents controlling', 'go no contact'] },
  { id: 'relationship.long_distance', label: 'A long-distance relationship',
    slots: [
      ['end_date', 'A plan to be together', 'Is there a plan for living in the same place?', ['Yes', 'Maybe', 'No'], 'r'],
      ['visits', 'Seeing each other', 'How often do you see each other?', ['Weekly', 'Monthly', 'Rarely'], 'r'],
    ],
    aliases: ['long distance relationship', 'long distance or break up', 'stay long distance', 'move closer to my partner', '=ldr', 'long distance marriage', 'long distance with my girlfriend'] },

  // ── family ──────────────────────────────────────────────────────────────────
  { id: 'family.have_child', label: 'Having a child',
    slots: [
      ['aligned', 'Where you both are', 'Are you and your partner aligned on timing?', ['Yes', 'Mostly', 'No'], 'rs'],
      ['costs', 'Money and time', 'Have you thought through the costs and who would take time off?', ['Yes', 'Partly', 'No'], 'r'],
      ['support', 'Support nearby', 'Would you have help from family nearby?', ['Yes', 'Some', 'No']],
    ],
    aliases: ['have a baby', 'have a child', 'have a second child', 'have kids', 'start a family', 'try for a baby', 'have another baby', 'child free', 'have children or not',
      'when to have kids', 'ready for a baby', 'have a third child', 'plan a baby'] },
  { id: 'family.school', label: 'Choosing a school for your child',
    slots: [
      ['child_age', 'Child age', 'How old is your child?', ['Under 5', '5–10', '11–14', '15+'], 'r'],
      ['priority', 'What matters most', 'What matters most in the school?', ['Academics', 'Wellbeing', 'Cost', 'Distance'], 'rm'],
      ['child_view', 'Their view', 'Does your child have a view?', ['Yes', 'Not asked yet', 'Too young']],
    ],
    aliases: ['which school', 'choose a school', 'change my childs school', 'switch schools', '=homeschool', 'boarding school', 'private or government school', 'ib or cbse', 'school for my daughter',
      'school for my son', 'move my child to a new school', 'international school', 'school admission', 'tutoring or not'] },
  { id: 'family.elder_care', label: 'Caring for an ageing parent',
    slots: [
      ['care_need', 'Care needed', 'What kind of help do they need?', ['Daily help', 'Medical care', 'Company', 'Financial support'], 'rms'],
      ['who_helps', 'Who can help', 'Who else in the family can share this?', ['Siblings', 'My partner', 'Nobody else', 'Paid help'], 'rm'],
      ['their_wish', 'Their wishes', 'What do your parents want?', ['To stay at home', 'To live with us', 'Open to options', 'I have not asked'], 'rs'],
    ],
    aliases: ['care for my parents', 'move my parents in', 'assisted living', 'old age home', 'nursing home', 'look after ageing parents', 'parents live with us', 'hire a caregiver for my parents',
      'elder care', 'move my mother in', 'move my father in', 'parents living alone', 'bring my parents to live with me'] },
  { id: 'family.adopt', label: 'Adopting or fostering',
    slots: [
      ['why', 'What is leading you to it', 'What is leading you to adoption or fostering?', ['Cannot conceive', 'A choice I want to make', 'A family situation'], 'rs'],
      ['steps', 'Where you are in the process', 'Have you looked into the process?', ['Yes', 'A little', 'Not yet'], 'r'],
      ['aligned', 'Alignment', 'Is everyone in the household aligned?', ['Yes', 'Mostly', 'No'], 'rs'],
    ],
    aliases: ['adopt a child', 'adopt a baby', '=adoption', 'foster a child', 'foster care', 'surrogacy or adoption', 'adopt or ivf', 'international adoption', 'become a foster parent'] },
  { id: 'family.childcare', label: 'Childcare and work',
    slots: [
      ['hours', 'Hours needed', 'How many hours of care do you need?', ['Part of the day', 'A full workday', 'Occasionally'], 'r'],
      ['options', 'Options', 'What are you comparing?', ['Daycare', 'A nanny', 'Family help', 'One parent at home'], 'rm'],
    ],
    aliases: ['daycare or nanny', 'hire a nanny', 'stay at home parent', 'quit my job to raise kids', 'go back to work after a baby', 'maternity leave', 'paternity leave', 'childcare options',
      'who will watch the baby', 'leave my job for my kids'] },

  // ── health (context only; never advice) ─────────────────────────────────────
  { id: 'health.surgery', label: 'A surgery or procedure',
    slots: [
      ['advised', 'What you were told', 'What has the doctor or surgeon recommended?', ['Surgery now', 'Surgery later', 'Surgery is optional'], 'rs'],
      ['second', 'Second opinion', 'Have you had a second opinion?', ['Yes', 'Planning to', 'No'], 'rs'],
      ['recovery', 'Recovery', 'Do you know the recovery time and what it would disrupt?', ['Yes', 'Roughly', 'No'], 'rs'],
    ],
    aliases: ['have surgery', 'knee surgery', 'back surgery', 'elective surgery', 'wait on surgery', 'operation or physio', 'surgery or conservative treatment', 'cataract surgery',
      'hernia surgery', 'cosmetic surgery', 'bariatric surgery', 'knee replacement', 'hip replacement', '=lasik'] },
  { id: 'health.medication', label: 'Starting or stopping a medication',
    slots: [
      ['recommended', 'Who advised it', 'Who advised the medication?', ['My doctor', 'A specialist', 'I am considering it myself'], 'rs'],
      ['concern', 'Main concern', 'What worries you about it?', ['Side effects', 'Dependence', 'Cost', 'Taking it long term'], 'rms'],
      ['lifestyle', 'Lifestyle changes first', 'Have you tried lifestyle changes first?', ['Yes', 'Partly', 'No'], 's'],
    ],
    aliases: ['start medication', 'stop medication', '=antidepressants', 'start statins', 'long term medication', 'take insulin', 'hormone therapy', '=ozempic', 'weight loss drugs',
      'stop my meds', 'side effects of medication', 'supplement or medicine', 'start blood pressure medicine'] },
  { id: 'health.fertility', label: 'Fertility treatment',
    slots: [
      ['stage', 'Where you are', 'Where are you in this journey?', ['Just considering', 'Trying for a while', 'Already in treatment'], 'rs'],
      ['partner', 'Alignment', 'Are you and your partner aligned on next steps?', ['Yes', 'Mostly', 'No'], 'rs'],
      ['cost', 'Cost and odds', 'Have you looked at the cost and how often it works for people in your situation?', ['Yes', 'Partly', 'No'], 's'],
    ],
    aliases: ['try ivf', 'ivf or wait', 'freeze my eggs', 'egg freezing', 'fertility treatment', '=iui', 'fertility clinic', 'start trying for a baby', 'struggling to conceive'] },
  { id: 'health.therapy', label: 'Getting support for your mental health',
    slots: [
      ['reason', 'What for', 'What would you want help with?', ['Stress or anxiety', 'Low mood', 'Relationships', 'Something from the past'], 'rms'],
      ['barrier', 'What is holding you back', 'What is making you hesitate?', ['Cost', 'Stigma', 'Time', 'Finding the right person'], 'rm'],
    ],
    aliases: ['start therapy', 'see a therapist', '=counselling', 'go to counselling', 'see a psychiatrist', 'mental health help', 'therapy or medication', 'couples therapy', 'try therapy',
      'online therapy', 'seek help for anxiety', 'talk to someone'] },
  { id: 'health.habit_change', label: 'A big health habit change',
    slots: [
      ['goal', 'What you want to change', 'What are you aiming for?', ['Lose weight', 'Build fitness', 'Sleep better', 'Manage a condition'], 'rms'],
      ['tried', 'What you have tried', 'What have you tried before?', ['Diet', 'Exercise', 'Apps or a trainer', 'Nothing structured'], 'rm'],
    ],
    aliases: ['lose weight', 'quit smoking', 'quit drinking', 'stop drinking alcohol', 'fix my sleep', 'reverse prediabetes', 'lower my blood pressure', 'manage my weight', 'stop vaping',
      'cut down on alcohol'] },

  // ── education ───────────────────────────────────────────────────────────────
  { id: 'education.mba', label: 'Doing an MBA',
    slots: [
      ['goal', 'What it is for', 'What do you want the MBA to do for you?', ['Change career', 'Move up', 'Start a business', 'Move abroad'], 'r'],
      ['funding', 'Cost and funding', 'How would you pay for it?', ['Savings', 'A loan', 'My employer', 'A scholarship'], 'rms'],
      ['without', 'Without it', 'Could you reach the same goal without the degree?', ['Probably', 'Maybe', 'No']],
    ],
    aliases: ['=mba', 'mba or not', 'is an mba worth it', 'executive mba', 'part time mba', 'full time mba', 'iim or isb', 'study mba abroad', 'mba after five years of work', 'one year mba'] },
  { id: 'education.masters_abroad', label: 'Studying abroad',
    slots: [
      ['country', 'Where', 'Which country are you considering?', null, 'r'],
      ['funding', 'Funding', 'How would you fund it?', ['Family savings', 'A loan', 'A scholarship', 'Part-time work'], 'rms'],
      ['work_after', 'After graduating', 'Do you plan to work there afterwards?', ['Yes', 'Maybe', 'No, I would return'], 'r'],
    ],
    aliases: ['study abroad', 'masters abroad', 'ms in usa', 'masters in germany', 'study in canada', 'study in the uk', 'go abroad for studies', 'ms or job', 'higher studies abroad',
      'masters in europe', 'ms in the us worth it'] },
  { id: 'education.phd', label: 'A PhD or research path',
    slots: [
      ['field', 'Field', 'What field would it be in?', null, 'r'],
      ['funded', 'Funding', 'Would it be funded or stipend-backed?', ['Fully funded', 'Partly', 'Self funded'], 'rs'],
      ['after', 'What next', 'What do you want to do afterwards?', ['Academia', 'Industry research', 'Something else'], 'r'],
    ],
    aliases: ['=phd', 'phd or job', '=doctorate', 'pursue a phd', 'phd after masters', 'research career', 'go into academia', 'leave my phd', 'quit my phd', 'drop out of a phd'] },
  { id: 'education.short_course', label: 'A course or certification',
    slots: [
      ['goal', 'What it is for', 'What do you want from it?', ['A new job', 'A promotion', 'A skill I am curious about'], 'r'],
      ['afford', 'Time and money', 'Can you afford the time and the fee?', ['Yes', 'Time is tight', 'Money is tight'], 'rs'],
      ['value', 'Does it count', 'Do the employers you want value this credential?', ['Yes', 'Some do', 'Hard to say']],
    ],
    aliases: ['join a bootcamp', 'coding bootcamp', 'online course', 'learn to code', 'get a certification', 'pmp certification', 'data science course', '=upskill', 'learn a new skill',
      'take a course', 'evening classes', 'language course', 'aws certification', 'cfa or mba'] },
  { id: 'education.choose_college', label: 'Choosing a college or course',
    slots: [
      ['options', 'Shortlist', 'Do you have a shortlist?', ['Yes, two or three', 'Many options', 'None yet'], 'r'],
      ['priority', 'What matters most', 'What matters most in this choice?', ['Reputation', 'Cost', 'Location', 'The course itself'], 'rm'],
      ['whose', 'Whose preference', 'Whose preference is shaping this?', ['Mine', 'My parents', 'Both'], 'rs'],
    ],
    aliases: ['which college', 'choose a college', 'college admission', 'choose a university', 'engineering or medicine', 'which stream', 'after twelfth', 'choose a course', 'choose a major',
      'which degree', 'private or government college'] },
  { id: 'education.leave_study', label: 'Leaving studies for work',
    slots: [
      ['waiting', 'The opportunity', 'Is there a job or business waiting?', ['Yes', 'Maybe', 'No'], 'r'],
      ['stage', 'How far in', 'How far into the degree are you?', ['Just started', 'Halfway', 'Nearly done'], 'r'],
    ],
    aliases: ['drop out of college', 'leave college', 'quit my studies', 'leave my degree for a job', 'study or work', 'college or startup', 'drop out to start a company', 'defer my degree'] },
]
