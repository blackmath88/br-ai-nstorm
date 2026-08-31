import type { ProblemSpace } from '../types/domain'

export const problems: ProblemSpace[] = [
  {
    id: 'campus-ai',
    title: 'How could universities jointly run an open AI service?',
    shortTitle: 'Shared university AI service',
    description: 'A cross-institutional problem spanning governance, product ownership, infrastructure, funding, trust and adoption.',
    stateSummary: '3 approaches · 2 tensions · 4 open questions',
    updated: [
      { title: 'Ownership became central', detail: 'Three contributions now point to product ownership as the unresolved bottleneck.' },
      { title: 'Technical feasibility looks less uncertain', detail: 'New evidence shifts attention from infrastructure toward operating model.' },
      { title: 'Funding split into two questions', detail: 'Build funding and long-term service funding are now separate branches.' }
    ],
    mine: [
      { contribution: '“Maybe service ownership matters more than tooling.”', impact: 'connected to 4 contributions · now part of the ownership branch' },
      { contribution: '“Could several universities co-own the product?”', impact: 'triggered 2 responses · still unresolved' },
      { contribution: '“Open source alone does not solve operations.”', impact: 'supported by another contributor’s evidence' }
    ],
    thinkNext: [
      'What would a minimal shared Product Owner model actually require?',
      'The group has lots of governance thinking but little evidence on recurring operating cost.',
      'One approach assumes institutions want a shared service. That assumption has not been tested.'
    ],
    timeline: [
      { date: '2026-08-18', title: 'Problem opened', detail: 'Shared university AI service framed as a cross-institutional possibility.', kind: 'problem' },
      { date: '2026-08-22', title: 'Open source branch emerged', detail: 'Several people proposed a shared OSS foundation.', kind: 'approach' },
      { date: '2026-08-26', title: 'Ownership challenge surfaced', detail: 'Discussion shifted from tooling toward product and service ownership.', kind: 'question' },
      { date: '2026-08-29', title: 'Product + service synthesis', detail: 'A combined product/service model now connects ownership and operations.', kind: 'synthesis' }
    ],
    nodes: [
      { id:'p', kind:'problem', label:'Shared AI service', detail:'Can universities jointly create and sustain an open AI service?', status:'root problem', author:'Shared space', createdAt:'2026-08-18', weight:30 },
      { id:'q1', kind:'question', label:'Who owns it?', detail:'What does shared product ownership actually mean across institutions?', status:'open', author:'Kai', createdAt:'2026-08-26', weight:22 },
      { id:'q2', kind:'question', label:'Who operates it?', detail:'Who carries service responsibility after the build?', status:'open', author:'Lea', createdAt:'2026-08-26', weight:19 },
      { id:'a1', kind:'approach', label:'Shared service', detail:'One shared service across several institutions.', status:'emerging', author:'Achim', createdAt:'2026-08-22', weight:24 },
      { id:'a2', kind:'approach', label:'Local instances', detail:'Each institution operates its own compatible instance.', status:'viable', author:'Mara', createdAt:'2026-08-23', weight:19 },
      { id:'a3', kind:'approach', label:'OSS + federation', detail:'Shared open source core with federated operation.', status:'speculative', author:'Jonas', createdAt:'2026-08-24', weight:20 },
      { id:'e1', kind:'evidence', label:'Infra feasible', detail:'Existing technical work suggests the infrastructure is feasible.', status:'supported', author:'Lea', createdAt:'2026-08-27', weight:15 },
      { id:'e2', kind:'evidence', label:'Overlapping needs', detail:'Several institutions describe similar governance and AI-service needs.', status:'supported', author:'Achim', createdAt:'2026-08-27', weight:16 },
      { id:'as1', kind:'assumption', label:'Institutions want shared ops', detail:'The shared-service model assumes institutions want operational coupling.', status:'untested', author:'AI synthesis', createdAt:'2026-08-28', weight:15 },
      { id:'c1', kind:'contradiction', label:'OSS ≠ service ownership', detail:'Open sourcing a codebase does not establish durable product or service ownership.', status:'tension', author:'Achim', createdAt:'2026-08-28', weight:15 },
      { id:'q3', kind:'question', label:'Recurring funding?', detail:'How would long-term operating cost be financed?', status:'open', author:'Mara', createdAt:'2026-08-29', weight:17 },
      { id:'s1', kind:'synthesis', label:'Product + service model', detail:'Emerging synthesis: shared product ownership plus an explicit service model.', status:'emerging synthesis', author:'Group', createdAt:'2026-08-29', weight:25 }
    ],
    relations: [
      {source:'p',target:'q1',kind:'opens'},{source:'p',target:'q2',kind:'opens'},
      {source:'p',target:'a1',kind:'relates'},{source:'p',target:'a2',kind:'relates'},{source:'p',target:'a3',kind:'relates'},
      {source:'e1',target:'a1',kind:'supports'},{source:'e2',target:'a1',kind:'supports'},
      {source:'q1',target:'s1',kind:'supports'},{source:'q2',target:'s1',kind:'supports'},
      {source:'c1',target:'a3',kind:'contradicts'},{source:'as1',target:'a1',kind:'supports'},
      {source:'q3',target:'s1',kind:'opens'},{source:'a1',target:'s1',kind:'supports'}
    ]
  },
  {
    id: 'basel-heat',
    title: 'How could Basel reduce heat stress within a 15-minute-city model?',
    shortTitle: 'Basel heat stress',
    description: 'A city-scale problem combining mobility, shade, green space, vulnerable populations, public realm, routing and live urban data.',
    stateSummary: '4 intervention areas · 3 evidence gaps',
    updated: [
      { title: 'Shade became infrastructure', detail: 'Several contributions now treat shade as a connected network property.' },
      { title: 'Routing emerged as an intervention', detail: 'A new branch asks whether routes should optimize heat exposure, not just travel time.' },
      { title: 'Vulnerability data is missing', detail: 'Intervention ideas are ahead of evidence about who is most affected where.' }
    ],
    mine: [
      { contribution: '“What if cool routes are a routing layer?”', impact: 'became a new intervention branch' },
      { contribution: '“Transit stops are heat nodes too.”', impact: 'linked to shade + vulnerable-user contributions' }
    ],
    thinkNext: [
      'What would a “cool-route score” actually combine?',
      'What changes at 10:00 versus 16:00?',
      'Could City2Graph expose where shade, walking, transit and vulnerability intersect?'
    ],
    timeline: [
      { date:'2026-08-10',title:'Problem opened',detail:'Heat stress framed as a 15-minute-city challenge.',kind:'problem' },
      { date:'2026-08-14',title:'Shade-network idea',detail:'Shade moved from individual trees to connected pedestrian infrastructure.',kind:'approach' },
      { date:'2026-08-21',title:'Routing branch',detail:'Cool-route scoring introduced as a possible city-service layer.',kind:'approach' },
      { date:'2026-08-28',title:'Evidence gap',detail:'Group recognized weak temporal and vulnerability data.',kind:'question' }
    ],
    nodes: [
      {id:'p',kind:'problem',label:'Heat stress',detail:'Reduce heat exposure while preserving everyday accessibility.',status:'root problem',author:'Shared space',createdAt:'2026-08-10',weight:30},
      {id:'q1',kind:'question',label:'Where is exposure worst?',detail:'Where do heat, walking and waiting time intersect?',status:'open',author:'Nina',createdAt:'2026-08-11',weight:21},
      {id:'a1',kind:'approach',label:'Cool routes',detail:'Route by thermal comfort as well as travel time.',status:'emerging',author:'Achim',createdAt:'2026-08-21',weight:24},
      {id:'a2',kind:'approach',label:'Shade network',detail:'Treat shade as connected public infrastructure.',status:'strong',author:'Luca',createdAt:'2026-08-14',weight:23},
      {id:'a3',kind:'approach',label:'Cool transit stops',detail:'Target transit waiting locations with cooling interventions.',status:'emerging',author:'Achim',createdAt:'2026-08-22',weight:19},
      {id:'a4',kind:'approach',label:'Pocket cooling',detail:'Small high-impact cooling interventions at activity nodes.',status:'speculative',author:'Mira',createdAt:'2026-08-17',weight:17},
      {id:'e1',kind:'evidence',label:'Tree canopy gaps',detail:'Some walking corridors appear weakly shaded.',status:'needs spatial proof',author:'Mira',createdAt:'2026-08-24',weight:15},
      {id:'e2',kind:'evidence',label:'Walking exposure',detail:'Heat burden likely compounds with walking time.',status:'plausible',author:'AI synthesis',createdAt:'2026-08-26',weight:14},
      {id:'as1',kind:'assumption',label:'Shortest ≠ coolest',detail:'Fastest paths are not always lowest-exposure paths.',status:'testable',author:'Achim',createdAt:'2026-08-21',weight:15},
      {id:'q2',kind:'question',label:'Who is vulnerable?',detail:'Which populations are most affected and where?',status:'evidence gap',author:'Nina',createdAt:'2026-08-25',weight:18},
      {id:'q3',kind:'question',label:'What changes by hour?',detail:'How should the model incorporate time-of-day heat conditions?',status:'open',author:'Luca',createdAt:'2026-08-28',weight:17},
      {id:'c1',kind:'contradiction',label:'Green space ≠ route access',detail:'Nearby green space does not automatically improve the route someone can actually take.',status:'tension',author:'Mira',createdAt:'2026-08-27',weight:14}
    ],
    relations: [
      {source:'p',target:'q1',kind:'opens'},{source:'p',target:'a1',kind:'relates'},{source:'p',target:'a2',kind:'relates'},
      {source:'p',target:'a3',kind:'relates'},{source:'p',target:'a4',kind:'relates'},{source:'as1',target:'a1',kind:'supports'},
      {source:'e2',target:'a1',kind:'supports'},{source:'e1',target:'a2',kind:'supports'},{source:'c1',target:'a2',kind:'contradicts'},
      {source:'q2',target:'a3',kind:'opens'},{source:'q3',target:'a1',kind:'opens'},{source:'a2',target:'a1',kind:'supports'}
    ]
  },
  {
    id: 'research-onboarding',
    title: 'How might a university cut new-researcher onboarding time in half?',
    shortTitle: 'Researcher onboarding',
    description: 'A people-and-process problem: fragmented information, local practices, IT access, role clarity, tacit knowledge and institutional complexity.',
    stateSummary: '2 strong causes · 5 candidate interventions',
    updated: [
      { title: 'Tacit knowledge became visible', detail: 'Multiple people independently described “who to ask” as more important than formal documentation.' },
      { title: 'Access delay separated from learning delay', detail: 'The problem now has two causal branches instead of one onboarding bucket.' },
      { title: 'Buddy model challenged', detail: 'Evidence suggests buddy quality varies too much to make it the only intervention.' }
    ],
    mine: [
      { contribution:'“The real interface is often another human.”', impact:'connected to tacit knowledge + expert routing' },
      { contribution:'“Could AI route people to the right person, not just the right page?”', impact:'now a candidate intervention' }
    ],
    thinkNext: [
      'What information should never be answered by AI and should instead route to a responsible person?',
      'The access-delay branch lacks timestamps. What could be measured automatically?',
      'Is the assumption that documentation already exists actually true?'
    ],
    timeline: [
      {date:'2026-08-05',title:'Problem opened',detail:'Onboarding delay framed as a cross-functional challenge.',kind:'problem'},
      {date:'2026-08-09',title:'Access-delay branch',detail:'IT provisioning separated from learning and orientation.',kind:'question'},
      {date:'2026-08-18',title:'Expert-routing idea',detail:'Tacit “who knows?” problem became an intervention target.',kind:'approach'},
      {date:'2026-08-27',title:'Buddy-model challenge',detail:'Variation in buddy quality surfaced as a contradiction.',kind:'contradiction'}
    ],
    nodes: [
      {id:'p',kind:'problem',label:'Researcher onboarding',detail:'Reduce time-to-productivity for new researchers.',status:'too slow',author:'Shared space',createdAt:'2026-08-05',weight:30},
      {id:'q1',kind:'question',label:'Where is time lost?',detail:'Which delays are process, access, navigation or tacit knowledge?',status:'open',author:'Sofia',createdAt:'2026-08-06',weight:21},
      {id:'a1',kind:'approach',label:'Expert routing',detail:'Route people to a human expert when tacit knowledge matters.',status:'promising',author:'Achim',createdAt:'2026-08-18',weight:24},
      {id:'a2',kind:'approach',label:'Access automation',detail:'Automate or pre-stage technical access.',status:'strong',author:'IT',createdAt:'2026-08-10',weight:22},
      {id:'a3',kind:'approach',label:'Living onboarding map',detail:'Expose current pathways, responsible people and local practices.',status:'emerging',author:'Sofia',createdAt:'2026-08-20',weight:19},
      {id:'a4',kind:'approach',label:'Buddy system',detail:'Assign a local guide to each new researcher.',status:'mixed evidence',author:'HR',createdAt:'2026-08-08',weight:17},
      {id:'e1',kind:'evidence',label:'Access takes days',detail:'Some technical access requests regularly take multiple days.',status:'supported',author:'IT',createdAt:'2026-08-11',weight:15},
      {id:'e2',kind:'evidence',label:'Tacit “who knows?” gap',detail:'New researchers often need the right person more than another document.',status:'supported',author:'Achim',createdAt:'2026-08-18',weight:17},
      {id:'c1',kind:'contradiction',label:'Buddy quality varies',detail:'Buddy systems depend strongly on local capacity and individual quality.',status:'challenge',author:'Sofia',createdAt:'2026-08-27',weight:15},
      {id:'as1',kind:'assumption',label:'Docs already exist',detail:'The onboarding-map idea assumes the underlying information exists.',status:'untested',author:'AI synthesis',createdAt:'2026-08-26',weight:14},
      {id:'q2',kind:'question',label:'What must stay human?',detail:'Which onboarding interactions should route to people rather than AI?',status:'open',author:'HR',createdAt:'2026-08-28',weight:17}
    ],
    relations: [
      {source:'p',target:'q1',kind:'opens'},{source:'p',target:'a1',kind:'relates'},{source:'p',target:'a2',kind:'relates'},
      {source:'p',target:'a3',kind:'relates'},{source:'p',target:'a4',kind:'relates'},{source:'e1',target:'a2',kind:'supports'},
      {source:'e2',target:'a1',kind:'supports'},{source:'c1',target:'a4',kind:'contradicts'},{source:'as1',target:'a3',kind:'supports'},
      {source:'q2',target:'a1',kind:'opens'}
    ]
  }
]
