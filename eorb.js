/**
 * Electronic Oil Record Book (e-ORB) — MARPOL Annex I
 * Codes/items from MARPOL Annex I Appendix III (as amended, e.g. MEPC.187(59)).
 * Recording examples aligned with MEPC.1/Circ.736/Rev.2.
 *
 * Flag administrations use the same IMO letter/item codes; differences are
 * language, e-ORB approval / Declaration, and local guidance notes.
 *
 * IMPORTANT: Official replacement of the hard-copy ORB requires flag-approved
 * software under IMO MEPC.312(74) plus a ship-specific Declaration. This module
 * is an operational / training guided log with printable pages — not a claim of
 * Liberian, RMI, Panama (or other) type approval unless separately certified.
 */
(function (global) {
  'use strict';

  const FLAGS = [
    {
      code: 'LR', name: 'Liberia', admin: 'Liberia Maritime Authority (LISCR)',
      language: 'English',
      erbNote: 'Liberian vessels may only use Administration-approved ERBs and must carry a Declaration of MARPOL Electronic Record Book (Marine Notice POL-012).',
      tips: [
        'Weekly C.11 inventory of IOPP Form A/B item 3.1 sludge tanks is expected even on long voyages (record each tank 11.1 / 11.2 / 11.3).',
        'Recording retained quantity in IOPP 3.3 oily bilge water holding tanks is voluntary (MEPC.1/Circ.736) — use Code I if your SMS requires it.',
        'Keep reception-facility receipts with the ORB for C.12.1 / D.15.2 transfers.',
        'Use D (manual start) vs E (automatic mode) carefully — mode of starting, not equipment capability.'
      ]
    },
    {
      code: 'MH', name: 'Marshall Islands', admin: 'Republic of the Marshall Islands Maritime Administrator',
      language: 'English (required)',
      erbNote: 'RMI publishes approved ERB vendors (Marine Notice 7-041-5). Ship must hold ERB Declaration(s) from the registry portal.',
      tips: [
        'ORB Part I entries for IOPP ships shall be in English.',
        'Weekly sludge inventory: C 11.1 tank identity, 11.2 capacity m³, 11.3 retention m³ — repeat for each 3.1 tank.',
        'Follow MI-402A item list and MEPC.1/Circ.736 example wording for PSC consistency.',
        'Incineration of sludge: record under C.12.3 with total time of operation.'
      ]
    },
    {
      code: 'PA', name: 'Panama', admin: 'Panama Maritime Authority (AMP)',
      language: 'English / Spanish (IMO languages prevail as applicable)',
      erbNote: 'Panama authorizes electronic record books under Resolution schemes aligned with MEPC.312(74); use only AMP-authorized manufacturers and keep the vessel license/declaration.',
      tips: [
        'Record operations without delay; each completed operation signed by officer(s) in charge; pages by Master.',
        'Retain ORB for 3 years after the last entry.',
        'Any OWS / 15 ppm equipment failure must be recorded under code F.'
      ]
    },
    {
      code: 'BS', name: 'Bahamas', admin: 'Bahamas Maritime Authority',
      language: 'English',
      erbNote: 'Bahamas follows MARPOL Appendix III item list (see BMA Marine Notice on ORBs). ERB use requires Administration acceptance where applicable.',
      tips: [
        'Transfers TO IOPP 3.1 tanks FROM non-3.1 locations use C.11.4 (with 11.1–11.3).',
        'Transfers between 3.1 tanks use C.12.2.',
        'Manual start of an “automatic” bilge system still uses code D, plus E.18 when placed in manual.'
      ]
    },
    {
      code: 'SG', name: 'Singapore', admin: 'Maritime and Port Authority of Singapore',
      language: 'English',
      erbNote: 'Singapore-flagged ships must meet MARPOL recording standards; electronic books require MPA acceptance where used as official records.',
      tips: ['Prefer clear Lat/Long or port name for ship position.', 'State quantities in m³ (sludge/bilge) or tonnes (bunkers) as required by the item.']
    },
    {
      code: 'CY', name: 'Cyprus', admin: 'Shipping Deputy Ministry — Cyprus',
      language: 'English',
      erbNote: 'Cyprus applies MARPOL Annex I ORB requirements; ERB subject to flag acceptance under IMO guidelines.',
      tips: ['Code I is for additional procedures/remarks — do not use it to replace mandatory codes A–H.']
    },
    {
      code: 'MT', name: 'Malta', admin: 'Transport Malta — Merchant Shipping Directorate',
      language: 'English',
      erbNote: 'Malta-flagged vessels must maintain ORB Part I (and Part II if tanker) per MARPOL; ERB requires Administration approval process.',
      tips: ['Ensure IOPP Supplement tank lists match the tanks selectable in this e-ORB setup.']
    },
    {
      code: 'HK', name: 'Hong Kong, China', admin: 'Hong Kong Marine Department',
      language: 'English / Chinese as applicable',
      erbNote: 'HK ships follow MARPOL ORB form; electronic alternatives need MD acceptance.',
      tips: ['Record accidental/exceptional discharges under G with circumstances and reasons.']
    },
    {
      code: 'GB', name: 'United Kingdom', admin: 'UK MCA / Red Ensign Group',
      language: 'English',
      erbNote: 'UK/REG ships use MARPOL Appendix III; ERB must meet MCA/flag policy and MEPC.312(74) when replacing hard copy.',
      tips: ['Cross-check OWS seal/status remarks under code I when relevant to an operation.']
    },
    {
      code: 'NO', name: 'Norway (NIS)', admin: 'Norwegian Maritime Authority',
      language: 'English / Norwegian as applicable',
      erbNote: 'NIS vessels follow MARPOL; electronic record books require NMA acceptance when used officially.',
      tips: ['Keep printed/export copies available for PSC if the ERB system is offline.']
    }
  ];

  function field(name, label, type, opts) {
    return Object.assign({ name, label, type: type || 'text', required: false }, opts || {});
  }

  /** Part I — Machinery space operations (all ships ≥400 GT / tankers ≥150 GT) */
  const PART_I = [
    {
      code: 'A', title: 'Ballasting or cleaning of oil fuel tanks',
      guide: 'Use when ballasting or cleaning oil fuel tanks. Identify tanks and cleaning/ballasting details.',
      items: [
        { no: '1', label: 'Identity of tank(s) ballasted', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'fuel', required: true })] },
        { no: '2', label: 'Cleaned since last contained oil / previous oil type', fields: [
          field('cleaned', 'Cleaned since last oil?', 'select', { options: ['Yes', 'No'], required: true }),
          field('prevOil', 'Previous oil type (if not cleaned)', 'text')
        ]},
        { no: '3.1', label: 'Cleaning — position & time start/completion', fields: [
          field('cleanPosStart', 'Position at start', 'text'), field('cleanTimeStart', 'Time start', 'time'),
          field('cleanPosEnd', 'Position at completion', 'text'), field('cleanTimeEnd', 'Time end', 'time')
        ]},
        { no: '3.2', label: 'Cleaning method / chemicals', fields: [
          field('cleanMethod', 'Method', 'select', { options: ['Rinsing through', 'Steaming', 'Cleaning with chemicals', 'Other'] }),
          field('chemType', 'Chemical type', 'text'), field('chemQty', 'Chemical quantity (m³)', 'number')
        ]},
        { no: '3.3', label: 'Cleaning water transferred to', fields: [
          field('washToTank', 'Tank receiving cleaning water', 'tank', { tankGroup: 'any' }),
          field('washQty', 'Quantity (m³)', 'number')
        ]},
        { no: '4.1', label: 'Ballasting — position & time', fields: [
          field('balPosStart', 'Position start', 'text'), field('balTimeStart', 'Time start', 'time'),
          field('balPosEnd', 'Position end', 'text'), field('balTimeEnd', 'Time end', 'time')
        ]},
        { no: '4.2', label: 'Ballast quantity if tanks not cleaned (m³)', fields: [field('ballastQty', 'Quantity (m³)', 'number')] }
      ]
    },
    {
      code: 'B', title: 'Discharge of dirty ballast or cleaning water from oil fuel tanks',
      guide: 'Discharge of dirty ballast/cleaning water from fuel oil tanks referred to under (A).',
      items: [
        { no: '5', label: 'Identity of tank(s)', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'fuel', required: true })] },
        { no: '6', label: 'Position at start of discharge', fields: [field('posStart', 'Position', 'text', { required: true })] },
        { no: '7', label: 'Position on completion', fields: [field('posEnd', 'Position', 'text', { required: true })] },
        { no: '8', label: 'Ship’s speed(s) during discharge', fields: [field('speed', 'Speed (kn)', 'text')] },
        { no: '9.1', label: 'Method — through 15 ppm equipment', fields: [field('viaOws', 'Discharged via 15 ppm?', 'select', { options: ['Yes', 'No'] })] },
        { no: '9.2', label: 'Method — to reception facilities', fields: [field('receptionPort', 'Reception facility / port', 'text')] },
        { no: '10', label: 'Quantity discharged (m³)', fields: [field('qty', 'Quantity (m³)', 'number', { required: true })] }
      ]
    },
    {
      code: 'C', title: 'Collection, transfer and disposal of oil residues (sludge)',
      guide: 'C.11 weekly inventory of IOPP 3.1 sludge tanks; C.11.4 for manual collection into 3.1; C.12 for disposal/transfer/incineration.',
      common: true,
      items: [
        { no: '11.1', label: 'Identity of tank(s)', fields: [field('tank', 'Sludge tank (IOPP 3.1)', 'tank', { tankGroup: 'sludge', required: true })] },
        { no: '11.2', label: 'Capacity of tank(s) (m³)', fields: [field('capacity', 'Capacity (m³)', 'number', { required: true })] },
        { no: '11.3', label: 'Total quantity of retention (m³)', fields: [field('retention', 'Retention ROB (m³)', 'number', { required: true })] },
        { no: '11.4', label: 'Quantity collected by manual operation (m³)', fields: [field('manualCollected', 'Manual collection (m³)', 'number')] },
        { no: '12.1', label: 'Disposal to reception facilities', fields: [
          field('qtyDisposed', 'Quantity disposed (m³)', 'number'),
          field('tankEmptied', 'Tank(s) emptied', 'tank', { tankGroup: 'sludge' }),
          field('retained', 'Quantity retained (m³)', 'number'),
          field('receptionPort', 'Port / facility', 'text', { required: true }),
          field('timeStart', 'Pumping start (for capacity check)', 'time'),
          field('timeStop', 'Pumping stop (for capacity check)', 'time')
        ]},
        { no: '12.2', label: 'Transfer to another tank(s)', fields: [
          field('qtyDisposed', 'Quantity transferred (m³)', 'number', { required: true }),
          field('fromTank', 'From tank', 'tank', { tankGroup: 'sludge', required: true }),
          field('toTank', 'To tank', 'tank', { tankGroup: 'any', required: true }),
          field('toTotal', 'Total content of receiving tank (m³)', 'number'),
          field('retained', 'Quantity retained in source (m³)', 'number'),
          field('timeStart', 'Transfer start (for pump capacity check)', 'time'),
          field('timeStop', 'Transfer stop (for pump capacity check)', 'time')
        ]},
        { no: '12.3', label: 'Incinerated', fields: [
          field('qtyDisposed', 'Quantity incinerated (m³)', 'number', { required: true }),
          field('tankEmptied', 'Tank', 'tank', { tankGroup: 'sludge' }),
          field('retained', 'Quantity retained (m³)', 'number'),
          field('incinHours', 'Total time of operation (h)', 'number', { required: true })
        ]},
        { no: '12.4', label: 'Other method', fields: [
          field('qtyDisposed', 'Quantity (m³)', 'number'),
          field('otherMethod', 'Method', 'text', { required: true }),
          field('retained', 'Quantity retained (m³)', 'number')
        ]}
      ]
    },
    {
      code: 'D', title: 'Non-automatic starting — bilge water discharge/transfer/disposal',
      guide: 'Manual start of bilge discharge/transfer/disposal. Include holding-tank identity/capacity/retained when pumping from a holding tank.',
      common: true,
      items: [
        { no: '13', label: 'Quantity discharged/transferred/disposed (m³)', fields: [
          field('qty', 'Quantity (m³)', 'number', { required: true }),
          field('fromTank', 'From holding tank (if applicable)', 'tank', { tankGroup: 'bilge' }),
          field('fromCap', 'Holding tank capacity (m³)', 'number'),
          field('fromRetained', 'Quantity retained in holding tank (m³)', 'number')
        ]},
        { no: '14', label: 'Time of discharge/transfer/disposal (start and stop)', fields: [
          field('timeStart', 'Start time', 'time', { required: true }),
          field('timeStop', 'Stop time', 'time', { required: true })
        ]},
        { no: '15.1', label: 'Through 15 ppm equipment', fields: [
          field('posStart', 'Position at start', 'text', { required: true }),
          field('posEnd', 'Position at end', 'text', { required: true })
        ]},
        { no: '15.2', label: 'To reception facilities', fields: [field('receptionPort', 'Port / facility', 'text', { required: true })] },
        { no: '15.3', label: 'To slop/holding/other tank(s)', fields: [
          field('toTank', 'To tank', 'tank', { tankGroup: 'any', required: true }),
          field('toRetained', 'Quantity retained in tank(s) (m³)', 'number')
        ]}
      ]
    },
    {
      code: 'E', title: 'Automatic starting — bilge water system mode',
      guide: 'Record when the system is placed in automatic overboard mode, automatic transfer mode, or returned to manual.',
      common: true,
      items: [
        { no: '16', label: 'Automatic mode — discharge overboard via 15 ppm', fields: [
          field('timeStart', 'Time', 'time', { required: true }),
          field('position', 'Position', 'text', { required: true }),
          field('fromTank', 'From tank (if applicable)', 'tank', { tankGroup: 'bilge' })
        ]},
        { no: '17', label: 'Automatic mode — transfer to holding tank', fields: [
          field('timeStart', 'Time', 'time', { required: true }),
          field('toTank', 'Holding tank', 'tank', { tankGroup: 'bilge', required: true })
        ]},
        { no: '18', label: 'System put into manual operation', fields: [field('timeStop', 'Time', 'time', { required: true })] }
      ]
    },
    {
      code: 'F', title: 'Condition of the oil filtering equipment',
      guide: 'Covers OWS, oil content meter, alarm and automatic stopping devices.',
      common: true,
      items: [
        { no: '19', label: 'Time of system failure', fields: [field('failTime', 'Failure time', 'time', { required: true })] },
        { no: '20', label: 'Time when system made operational', fields: [field('restoreTime', 'Restored time', 'time')] },
        { no: '21', label: 'Reasons for failure', fields: [field('failReason', 'Reason', 'textarea', { required: true })] }
      ]
    },
    {
      code: 'G', title: 'Accidental or other exceptional discharges of oil',
      guide: 'Mandatory statement of circumstances and reasons for accidental/exceptional discharge.',
      items: [
        { no: '22', label: 'Time of occurrence', fields: [field('time', 'Time', 'time', { required: true })] },
        { no: '23', label: 'Place or position of ship', fields: [field('position', 'Position / place', 'text', { required: true })] },
        { no: '24', label: 'Approximate quantity and type of oil', fields: [
          field('qty', 'Approx. quantity (m³)', 'number', { required: true }),
          field('oilType', 'Type of oil', 'text', { required: true })
        ]},
        { no: '25', label: 'Circumstances, reasons and remarks', fields: [field('remarks', 'Circumstances / reasons', 'textarea', { required: true })] }
      ]
    },
    {
      code: 'H', title: 'Bunkering of fuel or bulk lubricating oil',
      guide: 'Record place, time, type/quantity added and tank identity with total content after bunkering.',
      common: true,
      items: [
        { no: '26.1', label: 'Place of bunkering', fields: [field('place', 'Place / port', 'text', { required: true })] },
        { no: '26.2', label: 'Time of bunkering', fields: [
          field('timeStart', 'Start', 'time', { required: true }),
          field('timeStop', 'Stop', 'time')
        ]},
        { no: '26.3', label: 'Fuel oil bunkered', fields: [
          field('fuelType', 'Fuel type', 'text', { required: true }),
          field('fuelQty', 'Quantity added (t)', 'number', { required: true }),
          field('fuelTank', 'Tank(s)', 'tankMulti', { tankGroup: 'fuel', required: true }),
          field('fuelTotal', 'Total content of tank(s) (t)', 'number')
        ]},
        { no: '26.4', label: 'Lubricating oil bunkered', fields: [
          field('lubeType', 'Lube type', 'text'),
          field('lubeQty', 'Quantity added (t)', 'number'),
          field('lubeTank', 'Tank(s)', 'text'),
          field('lubeTotal', 'Total content of tank(s) (t)', 'number')
        ]}
      ]
    },
    {
      code: 'I', title: 'Additional operational procedures and general remarks',
      guide: 'Only for additional procedures/remarks that do not replace codes A–H.',
      common: true,
      items: [
        { no: 'I', label: 'Remarks', fields: [field('remarks', 'Additional procedures / remarks', 'textarea', { required: true })] }
      ]
    }
  ];

  /** Part II — Cargo/ballast operations (oil tankers) */
  const PART_II = [
    { code: 'A', title: 'Loading of oil cargo', common: true, items: [
      { no: '1', label: 'Place of loading', fields: [field('place', 'Place', 'text', { required: true })] },
      { no: '2', label: 'Type of oil loaded and identity of tank(s)', fields: [
        field('oilType', 'Type of oil', 'text', { required: true }),
        field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo', required: true })
      ]},
      { no: '3', label: 'Total quantity loaded', fields: [
        field('qtyAdded', 'Quantity added (m³ at 15°C)', 'number', { required: true }),
        field('totalContent', 'Total content of tank(s) (m³)', 'number')
      ]}
    ]},
    { code: 'B', title: 'Internal transfer of oil cargo during voyage', items: [
      { no: '4.1', label: 'From tank(s)', fields: [field('fromTank', 'From', 'tankMulti', { tankGroup: 'cargo', required: true })] },
      { no: '4.2', label: 'To tank(s)', fields: [
        field('toTank', 'To', 'tankMulti', { tankGroup: 'cargo', required: true }),
        field('qty', 'Quantity transferred (m³)', 'number', { required: true }),
        field('toTotal', 'Total quantity in receiving tank(s) (m³)', 'number')
      ]},
      { no: '5', label: 'Were tank(s) in 4.1 emptied?', fields: [
        field('emptied', 'Emptied?', 'select', { options: ['Yes', 'No'], required: true }),
        field('retained', 'Quantity retained (m³)', 'number')
      ]}
    ]},
    { code: 'C', title: 'Unloading of oil cargo', common: true, items: [
      { no: '6', label: 'Place of unloading', fields: [field('place', 'Place', 'text', { required: true })] },
      { no: '7', label: 'Identity of tank(s) unloaded', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo', required: true })] },
      { no: '8', label: 'Were tank(s) emptied?', fields: [
        field('emptied', 'Emptied?', 'select', { options: ['Yes', 'No'], required: true }),
        field('retained', 'Quantity retained (m³)', 'number')
      ]}
    ]},
    { code: 'D', title: 'Crude oil washing (COW tankers only)', items: [
      { no: '9', label: 'Port or ship’s position', fields: [field('place', 'Port / position', 'text', { required: true })] },
      { no: '10', label: 'Identity of tank(s) washed', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo', required: true })] },
      { no: '11', label: 'Number of machines in use', fields: [field('machines', 'Machines', 'number')] },
      { no: '12', label: 'Time of start of washing', fields: [field('timeStart', 'Start', 'time')] },
      { no: '13', label: 'Washing pattern employed', fields: [field('pattern', 'Pattern', 'text')] },
      { no: '14', label: 'Washing line pressure', fields: [field('pressure', 'Pressure', 'text')] },
      { no: '15', label: 'Time washing completed/stopped', fields: [field('timeStop', 'Stop', 'time')] },
      { no: '16', label: 'Method of establishing tank(s) dry', fields: [field('dryMethod', 'Method', 'text')] },
      { no: '17', label: 'Remarks', fields: [field('remarks', 'Remarks', 'textarea')] }
    ]},
    { code: 'E', title: 'Ballasting of cargo tanks', items: [
      { no: '18', label: 'Position at start and end of ballasting', fields: [
        field('posStart', 'Position start', 'text'), field('posEnd', 'Position end', 'text')
      ]},
      { no: '19.1', label: 'Identity of tank(s) ballasted', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo', required: true })] },
      { no: '19.2', label: 'Time of start and end', fields: [field('timeStart', 'Start', 'time'), field('timeStop', 'End', 'time')] },
      { no: '19.3', label: 'Quantity of ballast received (m³)', fields: [field('qty', 'Quantity (m³)', 'number', { required: true })] }
    ]},
    { code: 'F', title: 'Ballasting of dedicated clean ballast tanks (CBT)', items: [
      { no: '20', label: 'Identity of tank(s) ballasted', fields: [field('tanks', 'CBT(s)', 'tankMulti', { tankGroup: 'cbt', required: true })] },
      { no: '21', label: 'Position when flushing/port ballast taken', fields: [field('posFlush', 'Position', 'text')] },
      { no: '22', label: 'Position when pumps/lines flushed to slop', fields: [field('posLineFlush', 'Position', 'text')] },
      { no: '23', label: 'Oily water to slop after line flushing', fields: [
        field('slopTank', 'Slop/cargo tank', 'tank', { tankGroup: 'slop' }),
        field('oilyQty', 'Quantity (m³)', 'number')
      ]},
      { no: '24', label: 'Position when additional CBT ballast taken', fields: [field('posAdd', 'Position', 'text')] },
      { no: '25', label: 'Time/position valves closed separating CBT', fields: [
        field('valveTime', 'Time', 'time'), field('valvePos', 'Position', 'text')
      ]},
      { no: '26', label: 'Quantity of clean ballast taken (m³)', fields: [field('qty', 'Quantity (m³)', 'number')] }
    ]},
    { code: 'G', title: 'Cleaning of cargo tanks', items: [
      { no: '27', label: 'Identity of tank(s) cleaned', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo', required: true })] },
      { no: '28', label: 'Port or ship’s position', fields: [field('place', 'Port / position', 'text')] },
      { no: '29', label: 'Duration of cleaning', fields: [field('duration', 'Duration', 'text')] },
      { no: '30', label: 'Method of cleaning', fields: [field('method', 'Method', 'text')] },
      { no: '31.1', label: 'Washings to reception facilities', fields: [
        field('receptionPort', 'Port', 'text'), field('qty', 'Quantity (m³)', 'number')
      ]},
      { no: '31.2', label: 'Washings to slop/cargo tank(s)', fields: [
        field('toTank', 'Tank(s)', 'tank', { tankGroup: 'slop' }),
        field('qty', 'Quantity transferred (m³)', 'number'),
        field('toTotal', 'Total in tank (m³)', 'number')
      ]}
    ]},
    { code: 'H', title: 'Discharge of dirty ballast', items: [
      { no: '32', label: 'Identity of tank(s)', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo', required: true })] },
      { no: '33', label: 'Time & position at start into the sea', fields: [field('timeStart', 'Time', 'time'), field('posStart', 'Position', 'text')] },
      { no: '34', label: 'Time & position on completion into the sea', fields: [field('timeStop', 'Time', 'time'), field('posEnd', 'Position', 'text')] },
      { no: '35', label: 'Quantity discharged into the sea (m³)', fields: [field('seaQty', 'Quantity (m³)', 'number')] },
      { no: '36', label: 'Ship’s speed(s) during discharge', fields: [field('speed', 'Speed (kn)', 'text')] },
      { no: '37', label: 'ODME in operation?', fields: [field('odme', 'ODME operating?', 'select', { options: ['Yes', 'No'] })] },
      { no: '38', label: 'Regular check on effluent/surface?', fields: [field('surfaceCheck', 'Check kept?', 'select', { options: ['Yes', 'No'] })] },
      { no: '39', label: 'Oily water to slop tank(s)', fields: [
        field('slopTank', 'Slop tank(s)', 'tank', { tankGroup: 'slop' }),
        field('slopQty', 'Total quantity (m³)', 'number')
      ]},
      { no: '40', label: 'Discharged to shore reception', fields: [
        field('receptionPort', 'Port', 'text'), field('shoreQty', 'Quantity (m³)', 'number')
      ]}
    ]},
    { code: 'I', title: 'Discharge of water from slop tanks into the sea', items: [
      { no: '41', label: 'Identity of slop tanks', fields: [field('tanks', 'Slop tank(s)', 'tankMulti', { tankGroup: 'slop', required: true })] },
      { no: '42', label: 'Time of settling from last entry of residues', fields: [field('settleResidues', 'Settling time', 'text')] },
      { no: '43', label: 'Time of settling from last discharge', fields: [field('settleDischarge', 'Settling time', 'text')] },
      { no: '44', label: 'Time & position at start of discharge', fields: [field('timeStart', 'Time', 'time'), field('posStart', 'Position', 'text')] },
      { no: '45', label: 'Ullage of total contents at start', fields: [field('ullageTotal', 'Ullage', 'text')] },
      { no: '46', label: 'Ullage of oil/water interface at start', fields: [field('ullageInterface', 'Interface ullage', 'text')] },
      { no: '47', label: 'Bulk quantity discharged & rate', fields: [field('bulkQty', 'Bulk (m³)', 'number'), field('bulkRate', 'Rate (m³/h)', 'number')] },
      { no: '48', label: 'Final quantity discharged & rate', fields: [field('finalQty', 'Final (m³)', 'number'), field('finalRate', 'Rate (m³/h)', 'number')] },
      { no: '49', label: 'Time & position on completion', fields: [field('timeStop', 'Time', 'time'), field('posEnd', 'Position', 'text')] },
      { no: '50', label: 'ODME in operation?', fields: [field('odme', 'ODME operating?', 'select', { options: ['Yes', 'No'] })] },
      { no: '51', label: 'Interface ullage on completion (m)', fields: [field('ullageEnd', 'Ullage (m)', 'number')] },
      { no: '52', label: 'Ship’s speed(s)', fields: [field('speed', 'Speed (kn)', 'text')] },
      { no: '53', label: 'Regular check on effluent/surface?', fields: [field('surfaceCheck', 'Check kept?', 'select', { options: ['Yes', 'No'] })] },
      { no: '54', label: 'Valves closed on completion?', fields: [field('valvesClosed', 'Confirmed closed?', 'select', { options: ['Yes', 'No'] })] }
    ]},
    { code: 'J', title: 'Collection, transfer and disposal of residues/oily mixtures', items: [
      { no: '55', label: 'Identity of tank(s)', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'any', required: true })] },
      { no: '56', label: 'Quantity transferred/disposed (retained)', fields: [
        field('qty', 'Quantity (m³)', 'number', { required: true }),
        field('retained', 'Retained (m³)', 'number')
      ]},
      { no: '57.1', label: 'To reception facilities', fields: [field('receptionPort', 'Port', 'text'), field('qty', 'Quantity (m³)', 'number')] },
      { no: '57.2', label: 'Mixed with cargo', fields: [field('qty', 'Quantity (m³)', 'number')] },
      { no: '57.3', label: 'Transferred to/from other tank(s)', fields: [
        field('toTank', 'Other tank(s)', 'tank', { tankGroup: 'any' }),
        field('qty', 'Quantity (m³)', 'number'),
        field('toTotal', 'Total in tank(s) (m³)', 'number')
      ]},
      { no: '57.4', label: 'Other method', fields: [field('otherMethod', 'Method', 'text'), field('qty', 'Quantity (m³)', 'number')] }
    ]},
    { code: 'K', title: 'Discharge of clean ballast contained in cargo tanks', items: [
      { no: '58', label: 'Position at start', fields: [field('posStart', 'Position', 'text')] },
      { no: '59', label: 'Identity of tank(s) discharged', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo' })] },
      { no: '60', label: 'Tank(s) empty on completion?', fields: [field('emptied', 'Empty?', 'select', { options: ['Yes', 'No'] })] },
      { no: '61', label: 'Position on completion (if different)', fields: [field('posEnd', 'Position', 'text')] },
      { no: '62', label: 'Regular check on effluent/surface?', fields: [field('surfaceCheck', 'Check kept?', 'select', { options: ['Yes', 'No'] })] }
    ]},
    { code: 'L', title: 'Discharge of ballast from dedicated CBTs', items: [
      { no: '63', label: 'Identity of tank(s) discharged', fields: [field('tanks', 'CBT(s)', 'tankMulti', { tankGroup: 'cbt' })] },
      { no: '64', label: 'Time & position at start into sea', fields: [field('timeStart', 'Time', 'time'), field('posStart', 'Position', 'text')] },
      { no: '65', label: 'Time & position on completion into sea', fields: [field('timeStop', 'Time', 'time'), field('posEnd', 'Position', 'text')] },
      { no: '66.1', label: 'Quantity into the sea (m³)', fields: [field('seaQty', 'Quantity (m³)', 'number')] },
      { no: '66.2', label: 'Quantity to reception facility', fields: [field('receptionPort', 'Port', 'text'), field('shoreQty', 'Quantity (m³)', 'number')] },
      { no: '67', label: 'Indication of oil contamination?', fields: [field('contamination', 'Contamination?', 'select', { options: ['Yes', 'No'] })] },
      { no: '68', label: 'Monitored by oil content meter?', fields: [field('ocm', 'OCM?', 'select', { options: ['Yes', 'No'] })] },
      { no: '69', label: 'Time & position valves closed', fields: [field('valveTime', 'Time', 'time'), field('valvePos', 'Position', 'text')] }
    ]},
    { code: 'M', title: 'Condition of oil discharge monitoring and control system', items: [
      { no: '70', label: 'Time of system failure', fields: [field('failTime', 'Failure time', 'time', { required: true })] },
      { no: '71', label: 'Time when system made operational', fields: [field('restoreTime', 'Restored time', 'time')] },
      { no: '72', label: 'Reasons for failure', fields: [field('failReason', 'Reason', 'textarea', { required: true })] }
    ]},
    { code: 'N', title: 'Accidental or other exceptional discharges of oil', items: [
      { no: '73', label: 'Time of occurrence', fields: [field('time', 'Time', 'time', { required: true })] },
      { no: '74', label: 'Port or ship’s position', fields: [field('position', 'Position', 'text', { required: true })] },
      { no: '75', label: 'Approximate quantity and type of oil', fields: [
        field('qty', 'Quantity (m³)', 'number', { required: true }),
        field('oilType', 'Type of oil', 'text', { required: true })
      ]},
      { no: '76', label: 'Circumstances, reasons and remarks', fields: [field('remarks', 'Circumstances', 'textarea', { required: true })] }
    ]},
    { code: 'O', title: 'Additional operational procedures and general remarks', common: true, items: [
      { no: 'O', label: 'Remarks', fields: [field('remarks', 'Remarks', 'textarea', { required: true })] }
    ]},
    { code: 'P', title: 'Specific trades — loading of ballast water', items: [
      { no: '77', label: 'Identity of tank(s) ballasted', fields: [field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo' })] },
      { no: '78', label: 'Position of ship when ballasted', fields: [field('position', 'Position', 'text')] },
      { no: '79', label: 'Total quantity of ballast loaded (m³)', fields: [field('qty', 'Quantity (m³)', 'number')] },
      { no: '80', label: 'Remarks', fields: [field('remarks', 'Remarks', 'textarea')] }
    ]},
    { code: 'Q', title: 'Specific trades — re-allocation of ballast water', items: [
      { no: '81', label: 'Reason for reallocation', fields: [field('remarks', 'Reason', 'textarea', { required: true })] }
    ]},
    { code: 'R', title: 'Specific trades — ballast water discharge to reception facility', items: [
      { no: '82', label: 'Port(s) where discharged', fields: [field('receptionPort', 'Port(s)', 'text', { required: true })] },
      { no: '83', label: 'Name/designation of reception facility', fields: [field('facility', 'Facility', 'text')] },
      { no: '84', label: 'Quantity discharged (m³) and tank(s)', fields: [
        field('qty', 'Quantity (m³)', 'number'),
        field('tanks', 'Tank(s)', 'tankMulti', { tankGroup: 'cargo' })
      ]}
    ]}
  ];

  function defaultOrbSetup(seed) {
    seed = seed || {};
    return {
      flag: seed.flag || 'LR',
      shipName: seed.shipName || '',
      imo: seed.imo || '',
      callSign: seed.callSign || '',
      gt: seed.gt != null ? seed.gt : null,
      shipType: seed.shipType || 'other', // other | tanker
      ioppForm: seed.ioppForm || 'A',
      masterName: seed.masterName || '',
      chiefEng: seed.chiefEng || '',
      equipment: Object.assign({
        owsFitted: true, owsPpm: 15, incineratorFitted: true, odmeFitted: false, cowFitted: false, cbtFitted: false,
        /* Capacities used for auto-ROB checks / mismatch warnings */
        incineratorM3PerH: seed.equipment && seed.equipment.incineratorM3PerH != null ? seed.equipment.incineratorM3PerH : 0.05,
        sludgePumpM3PerH: seed.equipment && seed.equipment.sludgePumpM3PerH != null ? seed.equipment.sludgePumpM3PerH : 2,
        bilgePumpM3PerH: seed.equipment && seed.equipment.bilgePumpM3PerH != null ? seed.equipment.bilgePumpM3PerH : 5,
        transferPumpM3PerH: seed.equipment && seed.equipment.transferPumpM3PerH != null ? seed.equipment.transferPumpM3PerH : 2,
        capacityWarnTolerancePct: seed.equipment && seed.equipment.capacityWarnTolerancePct != null ? seed.equipment.capacityWarnTolerancePct : 15
      }, seed.equipment || {}),
      tanks: {
        sludge: (seed.tanks && seed.tanks.sludge) || [{ id: 'sludge1', name: 'Sludge Tank', capacityM3: 5, robM3: 0 }],
        bilge: (seed.tanks && seed.tanks.bilge) || [{ id: 'bilge1', name: 'Oily Bilge Water Holding Tank', capacityM3: 10, robM3: 0 }],
        bilgeWells: (seed.tanks && seed.tanks.bilgeWells) || [{ id: 'bilgewell1', name: 'Engine Room Bilge Wells', capacityM3: null, robM3: 0 }],
        fuel: (seed.tanks && seed.tanks.fuel) || [],
        dirtyBallast: (seed.tanks && seed.tanks.dirtyBallast) || [],
        cargo: (seed.tanks && seed.tanks.cargo) || [],
        slop: (seed.tanks && seed.tanks.slop) || [],
        cbt: (seed.tanks && seed.tanks.cbt) || []
      },
      disclaimerAck: !!seed.disclaimerAck
    };
  }

  function getFlag(code) {
    return FLAGS.find(f => f.code === code) || FLAGS[0];
  }

  function getPartOps(part) {
    return Number(part) === 2 ? PART_II : PART_I;
  }

  function getOperation(part, code) {
    return getPartOps(part).find(op => op.code === code) || null;
  }

  function tanksForGroup(setup, group) {
    const t = (setup && setup.tanks) || {};
    if (group === 'sludge') return t.sludge || [];
    if (group === 'bilge') return t.bilge || [];
    if (group === 'bilgeWells') return t.bilgeWells || [];
    if (group === 'fuel') return t.fuel || [];
    if (group === 'cargo') return t.cargo || [];
    if (group === 'slop') return t.slop || [];
    if (group === 'cbt') return t.cbt || [];
    if (group === 'dirtyBallast') return t.dirtyBallast || [];
    /* any */
    return [].concat(t.sludge || [], t.bilge || [], t.bilgeWells || [], t.fuel || [], t.cargo || [], t.slop || [], t.cbt || [], t.dirtyBallast || []);
  }

  /**
   * Weekly inventory builder (MEPC.1/Circ.736 Example #1).
   * - Sludge / oil residue tanks (IOPP 3.1) → Code C items 11.1 / 11.2 / 11.3 per tank (mandatory weekly).
   * - Oily bilge water holding (IOPP 3.3) + other bilge tanks/wells → Code I (voluntary per Circ.736).
   * soundings: [{ id, group, name, capacityM3, robM3, include }]
   */
  function buildWeeklyInventory(setup, soundings, options) {
    options = options || {};
    const list = Array.isArray(soundings) ? soundings : [];
    const sludgeLines = [];
    const sludgeTanks = [];
    const bilgeParts = [];
    const bilgeWellParts = [];

    list.forEach(row => {
      if (!row || row.include === false) return;
      const name = row.name || tankName(setup, row.id) || row.id;
      const cap = row.capacityM3;
      const rob = row.robM3;
      if (row.group === 'sludge') {
        if (rob == null || rob === '') return;
        sludgeTanks.push({ id: row.id, name, capacityM3: cap, robM3: rob });
        sludgeLines.push({ itemNo: '11.1', text: String(name) });
        sludgeLines.push({ itemNo: '11.2', text: (cap != null && cap !== '' ? fmtVal(Number(cap)) : '—') + ' m³' });
        sludgeLines.push({ itemNo: '11.3', text: fmtVal(Number(rob)) + ' m³' });
      } else if (row.group === 'bilge') {
        if (rob == null || rob === '') return;
        bilgeParts.push(
          name + ' — capacity ' + (cap != null && cap !== '' ? fmtVal(Number(cap)) + ' m³' : 'n/a') +
          ', retained ' + fmtVal(Number(rob)) + ' m³'
        );
      } else if (row.group === 'bilgeWells') {
        if (rob == null || rob === '') return;
        bilgeWellParts.push(
          name + ' — ' + (cap != null && cap !== '' ? ('capacity ' + fmtVal(Number(cap)) + ' m³, ') : '') +
          'retained ' + fmtVal(Number(rob)) + ' m³'
        );
      }
    });

    const out = { entries: [], errors: [] };
    if (!sludgeLines.length) {
      out.errors.push('Enter retained quantity (m³) for at least one sludge / oil residue tank (IOPP 3.1) — weekly C.11 inventory.');
    } else {
      out.entries.push({
        part: 1,
        code: 'C',
        selectedItems: ['11.1', '11.2', '11.3'],
        values: {
          weeklyInventory: true,
          sludgeTanks,
          inventoryKind: 'weekly-sludge'
        },
        lines: sludgeLines,
        title: 'Weekly inventory — oil residue (sludge) tanks (IOPP 3.1)'
      });
    }

    const bilgeTextParts = [];
    if (bilgeParts.length) {
      bilgeTextParts.push('Weekly inventory of oily bilge water holding tank(s) (IOPP Supplement item 3.3 — voluntary per MEPC.1/Circ.736): ' + bilgeParts.join('; ') + '.');
    }
    if (bilgeWellParts.length) {
      bilgeTextParts.push('Weekly inventory of bilge tank(s) / wells: ' + bilgeWellParts.join('; ') + '.');
    }
    if (bilgeTextParts.length) {
      const remarks = bilgeTextParts.join(' ');
      out.entries.push({
        part: 1,
        code: 'I',
        selectedItems: ['I'],
        values: { remarks, weeklyInventory: true, inventoryKind: 'weekly-bilge' },
        lines: [{ itemNo: 'I', text: remarks }],
        title: 'Weekly inventory — oily bilge / bilge tanks (Code I, voluntary)'
      });
    } else if (options.requireBilge) {
      out.errors.push('Enter retained quantity for oily bilge holding and/or bilge tanks, or untick “Require bilge inventory”.');
    }

    return out;
  }

  function tankName(setup, id) {
    if (!id) return '';
    const all = tanksForGroup(setup, 'any');
    const hit = all.find(x => x.id === id || x.name === id);
    return hit ? hit.name : String(id);
  }

  function findTank(setup, id) {
    if (!id || !setup || !setup.tanks) return null;
    const groups = Object.keys(setup.tanks);
    for (let i = 0; i < groups.length; i++) {
      const list = setup.tanks[groups[i]] || [];
      const hit = list.find(t => t && (t.id === id || t.name === id));
      if (hit) return { tank: hit, group: groups[i] };
    }
    return null;
  }

  function numOrNull(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function hoursBetween(start, stop) {
    if (!start || !stop) return null;
    const [sh, sm] = String(start).split(':').map(Number);
    const [eh, em] = String(stop).split(':').map(Number);
    if (![sh, sm, eh, em].every(isFinite)) return null;
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60; /* crossed midnight */
    return mins / 60;
  }

  function round3(n) {
    return Math.round(Number(n) * 1000) / 1000;
  }

  function tolPct(setup) {
    const t = setup && setup.equipment && Number(setup.equipment.capacityWarnTolerancePct);
    return isFinite(t) && t >= 0 ? t : 15;
  }

  function mismatchWarning(label, actual, expected, unit, setup) {
    if (actual == null || expected == null || !(expected > 0)) return null;
    const pct = Math.abs(actual - expected) / expected * 100;
    if (pct <= tolPct(setup)) return null;
    return {
      level: pct >= 40 ? 'error' : 'warn',
      code: 'CAPACITY_MISMATCH',
      message: label + ': recorded ' + fmtVal(actual) + ' ' + unit +
        ' vs equipment capacity ≈ ' + fmtVal(round3(expected)) + ' ' + unit +
        ' (' + fmtVal(round3(pct)) + '% difference; tolerance ' + tolPct(setup) + '%). Check quantity, time, or rated capacity in ORB Vessel Setup.'
    };
  }

  /**
   * Auto-fill derived fields (retained, toTotal, capacity) from current tank ROB
   * without mutating setup. Returns a new values object + notes.
   */
  function autofillOperationValues(setup, part, code, selectedItems, values) {
    const v = Object.assign({}, values || {});
    const notes = [];
    const want = new Set(selectedItemNos(selectedItems));
    if (Number(part) !== 1) return { values: v, notes };

    function tankRob(id) {
      const hit = findTank(setup, id);
      return hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : null;
    }
    function tankCap(id) {
      const hit = findTank(setup, id);
      return hit && hit.tank.capacityM3 != null ? Number(hit.tank.capacityM3) : null;
    }

    if (code === 'C') {
      if (want.has('11.1') || want.has('11.2') || want.has('11.3')) {
        const id = v.tank;
        if (id) {
          if (v.capacity == null || v.capacity === '') {
            const c = tankCap(id);
            if (c != null) { v.capacity = c; notes.push('Capacity filled from ' + tankName(setup, id) + '.'); }
          }
          if (v.retention == null || v.retention === '') {
            const r = tankRob(id);
            if (r != null) { v.retention = r; notes.push('Retention filled from current ROB.'); }
          }
        }
      }
      if (want.has('11.4')) {
        const id = v.tank;
        const add = numOrNull(v.manualCollected);
        const base = tankRob(id);
        if (id && add != null && (v.retention == null || v.retention === '') && base != null) {
          v.retention = round3(base + add);
          if (v.capacity == null || v.capacity === '') {
            const c = tankCap(id);
            if (c != null) v.capacity = c;
          }
          notes.push('Retention after manual collection = prior ROB + collected.');
        }
      }
      if (want.has('12.1') || want.has('12.3') || want.has('12.4')) {
        const id = v.tankEmptied;
        const qty = numOrNull(v.qtyDisposed);
        const prior = tankRob(id);
        if (id && qty != null && (v.retained == null || v.retained === '') && prior != null) {
          v.retained = round3(Math.max(0, prior - qty));
          notes.push('Retained auto-calculated: ' + fmtVal(prior) + ' − ' + fmtVal(qty) + ' = ' + fmtVal(v.retained) + ' m³.');
        }
      }
      if (want.has('12.2')) {
        const fromId = v.fromTank;
        const toId = v.toTank;
        const qty = numOrNull(v.qtyDisposed);
        const fromPrior = tankRob(fromId);
        const toPrior = tankRob(toId);
        if (fromId && qty != null && (v.retained == null || v.retained === '') && fromPrior != null) {
          v.retained = round3(Math.max(0, fromPrior - qty));
          notes.push('Source retained auto-calculated from ROB.');
        }
        if (toId && qty != null && (v.toTotal == null || v.toTotal === '') && toPrior != null) {
          v.toTotal = round3(toPrior + qty);
          notes.push('Receiving tank total auto-calculated from ROB + transferred.');
        }
      }
    }

    if (code === 'D') {
      const fromId = v.fromTank;
      const qty = numOrNull(v.qty);
      const prior = tankRob(fromId);
      if (fromId && (v.fromCap == null || v.fromCap === '')) {
        const c = tankCap(fromId);
        if (c != null) v.fromCap = c;
      }
      if (fromId && qty != null && (v.fromRetained == null || v.fromRetained === '') && prior != null) {
        v.fromRetained = round3(Math.max(0, prior - qty));
        notes.push('Bilge holding retained auto-calculated from ROB − quantity.');
      }
      if (want.has('15.3')) {
        const toId = v.toTank;
        const toPrior = tankRob(toId);
        if (toId && qty != null && (v.toRetained == null || v.toRetained === '') && toPrior != null) {
          v.toRetained = round3(toPrior + qty);
          notes.push('Receiving tank retained auto-calculated from ROB + transferred.');
        }
      }
    }

    if (code === 'H' && want.has('26.3')) {
      const tanks = Array.isArray(v.fuelTank) ? v.fuelTank : (v.fuelTank ? String(v.fuelTank).split('|') : []);
      const add = numOrNull(v.fuelQty);
      if (tanks.length === 1 && add != null && (v.fuelTotal == null || v.fuelTotal === '')) {
        const prior = tankRob(tanks[0]);
        if (prior != null) {
          v.fuelTotal = round3(prior + add);
          notes.push('Fuel tank total content auto-calculated: prior + bunkered quantity.');
        }
      }
    }

    return { values: v, notes };
  }

  /**
   * Capacity / rate warnings (incinerator burn rate, pump transfer rate vs quantity & time).
   */
  function capacityWarnings(setup, part, code, selectedItems, values) {
    const warnings = [];
    if (Number(part) !== 1) return warnings;
    const v = values || {};
    const want = new Set(selectedItemNos(selectedItems));
    const eq = (setup && setup.equipment) || {};

    if (code === 'C' && want.has('12.3')) {
      const qty = numOrNull(v.qtyDisposed);
      const hours = numOrNull(v.incinHours);
      const rate = numOrNull(eq.incineratorM3PerH);
      if (qty != null && hours != null && hours > 0 && rate != null && rate > 0) {
        const expected = rate * hours;
        const w = mismatchWarning('Incinerator sludge burning capacity', qty, expected, 'm³', setup);
        if (w) warnings.push(w);
        else warnings.push({
          level: 'info',
          code: 'INCIN_OK',
          message: 'Incinerator check OK: ' + fmtVal(qty) + ' m³ in ' + fmtVal(hours) +
            ' h ≈ ' + fmtVal(round3(expected)) + ' m³ at ' + fmtVal(rate) + ' m³/h rated capacity.'
        });
      } else if (eq.incineratorFitted !== false && (rate == null || !(rate > 0))) {
        warnings.push({ level: 'warn', code: 'INCIN_RATE_MISSING', message: 'Set incinerator sludge capacity (m³/h) in ORB Vessel Setup to validate burning quantity vs time.' });
      }
      const id = v.tankEmptied;
      const hit = findTank(setup, id);
      if (hit && qty != null && hit.tank.robM3 != null && qty - Number(hit.tank.robM3) > 0.001) {
        warnings.push({ level: 'error', code: 'ROB_EXCEEDED', message: 'Incinerated quantity (' + fmtVal(qty) + ' m³) exceeds current ROB in ' + hit.tank.name + ' (' + fmtVal(hit.tank.robM3) + ' m³).' });
      }
    }

    if (code === 'C' && (want.has('12.1') || want.has('12.2') || want.has('12.4'))) {
      const qty = numOrNull(v.qtyDisposed);
      const hours = hoursBetween(v.timeStart, v.timeStop);
      const rate = numOrNull(eq.sludgePumpM3PerH) || numOrNull(eq.transferPumpM3PerH);
      if (qty != null && hours != null && hours > 0 && rate != null && rate > 0) {
        const expected = rate * hours;
        const w = mismatchWarning('Sludge / transfer pump capacity', qty, expected, 'm³', setup);
        if (w) warnings.push(w);
      }
      const fromId = want.has('12.2') ? v.fromTank : v.tankEmptied;
      const hit = findTank(setup, fromId);
      if (hit && qty != null && hit.tank.robM3 != null && qty - Number(hit.tank.robM3) > 0.001) {
        warnings.push({ level: 'error', code: 'ROB_EXCEEDED', message: 'Transferred/disposed quantity (' + fmtVal(qty) + ' m³) exceeds ROB in ' + hit.tank.name + ' (' + fmtVal(hit.tank.robM3) + ' m³).' });
      }
      if (want.has('12.2')) {
        const toHit = findTank(setup, v.toTank);
        const toTotal = numOrNull(v.toTotal);
        if (toHit && toTotal != null && toHit.tank.capacityM3 != null && toTotal - Number(toHit.tank.capacityM3) > 0.001) {
          warnings.push({ level: 'error', code: 'OVERFILL', message: 'Receiving tank total (' + fmtVal(toTotal) + ' m³) exceeds capacity of ' + toHit.tank.name + ' (' + fmtVal(toHit.tank.capacityM3) + ' m³).' });
        }
      }
    }

    if (code === 'D') {
      const qty = numOrNull(v.qty);
      const hours = hoursBetween(v.timeStart, v.timeStop);
      const rate = numOrNull(eq.bilgePumpM3PerH) || numOrNull(eq.transferPumpM3PerH);
      if (qty != null && hours != null && hours > 0 && rate != null && rate > 0) {
        const expected = rate * hours;
        const w = mismatchWarning('Bilge pump capacity', qty, expected, 'm³', setup);
        if (w) warnings.push(w);
      } else if (qty != null && hours != null && hours > 0 && !(rate > 0)) {
        warnings.push({ level: 'warn', code: 'BILGE_RATE_MISSING', message: 'Set bilge pump capacity (m³/h) in ORB Vessel Setup to validate quantity vs pumping time.' });
      }
      const hit = findTank(setup, v.fromTank);
      if (hit && qty != null && hit.tank.robM3 != null && qty - Number(hit.tank.robM3) > 0.001) {
        warnings.push({ level: 'error', code: 'ROB_EXCEEDED', message: 'Bilge quantity (' + fmtVal(qty) + ' m³) exceeds ROB in ' + hit.tank.name + ' (' + fmtVal(hit.tank.robM3) + ' m³).' });
      }
    }

    if (code === 'H' && want.has('26.3')) {
      const tanks = Array.isArray(v.fuelTank) ? v.fuelTank : (v.fuelTank ? String(v.fuelTank).split('|') : []);
      const total = numOrNull(v.fuelTotal);
      if (tanks.length === 1 && total != null) {
        const hit = findTank(setup, tanks[0]);
        if (hit && hit.tank.capacityM3 != null && total - Number(hit.tank.capacityM3) > 0.001) {
          warnings.push({ level: 'error', code: 'OVERFILL', message: 'Bunkered total content (' + fmtVal(total) + ') exceeds capacity of ' + hit.tank.name + ' (' + fmtVal(hit.tank.capacityM3) + ').' });
        }
      }
    }

    return warnings;
  }

  /**
   * Apply ROB side-effects after a successful save. Mutates setup.tanks robM3 values.
   * Returns list of human-readable ROB change notes.
   */
  function applyOperationRob(setup, part, code, selectedItems, values) {
    const notes = [];
    if (!setup || Number(part) !== 1) return notes;
    const v = values || {};
    const want = new Set(selectedItemNos(selectedItems));

    function setRob(id, next, label) {
      const hit = findTank(setup, id);
      if (!hit) return;
      const prev = hit.tank.robM3 != null ? Number(hit.tank.robM3) : null;
      hit.tank.robM3 = round3(Math.max(0, next));
      notes.push((label || hit.tank.name) + ': ROB ' +
        (prev != null ? fmtVal(prev) : '—') + ' → ' + fmtVal(hit.tank.robM3) + ' m³');
    }

    if (code === 'C') {
      if (want.has('11.3') && v.tank != null && v.retention != null && v.retention !== '') {
        setRob(v.tank, Number(v.retention), tankName(setup, v.tank));
      }
      if (want.has('11.4') && v.tank && numOrNull(v.manualCollected) != null) {
        const hit = findTank(setup, v.tank);
        const base = hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : 0;
        /* If retention also set, prefer retention; else add collected */
        if (want.has('11.3') && v.retention != null && v.retention !== '') {
          setRob(v.tank, Number(v.retention), tankName(setup, v.tank));
        } else {
          setRob(v.tank, base + Number(v.manualCollected), tankName(setup, v.tank));
        }
      }
      if ((want.has('12.1') || want.has('12.3') || want.has('12.4')) && v.tankEmptied) {
        if (v.retained != null && v.retained !== '') setRob(v.tankEmptied, Number(v.retained));
        else if (numOrNull(v.qtyDisposed) != null) {
          const hit = findTank(setup, v.tankEmptied);
          const base = hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : 0;
          setRob(v.tankEmptied, Math.max(0, base - Number(v.qtyDisposed)));
        }
      }
      if (want.has('12.2')) {
        if (v.fromTank) {
          if (v.retained != null && v.retained !== '') setRob(v.fromTank, Number(v.retained));
          else if (numOrNull(v.qtyDisposed) != null) {
            const hit = findTank(setup, v.fromTank);
            const base = hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : 0;
            setRob(v.fromTank, Math.max(0, base - Number(v.qtyDisposed)));
          }
        }
        if (v.toTank) {
          if (v.toTotal != null && v.toTotal !== '') setRob(v.toTank, Number(v.toTotal));
          else if (numOrNull(v.qtyDisposed) != null) {
            const hit = findTank(setup, v.toTank);
            const base = hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : 0;
            setRob(v.toTank, base + Number(v.qtyDisposed));
          }
        }
      }
    }

    if (code === 'D') {
      if (v.fromTank) {
        if (v.fromRetained != null && v.fromRetained !== '') setRob(v.fromTank, Number(v.fromRetained));
        else if (numOrNull(v.qty) != null) {
          const hit = findTank(setup, v.fromTank);
          const base = hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : 0;
          setRob(v.fromTank, Math.max(0, base - Number(v.qty)));
        }
      }
      if (want.has('15.3') && v.toTank) {
        if (v.toRetained != null && v.toRetained !== '') setRob(v.toTank, Number(v.toRetained));
        else if (numOrNull(v.qty) != null) {
          const hit = findTank(setup, v.toTank);
          const base = hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : 0;
          setRob(v.toTank, base + Number(v.qty));
        }
      }
    }

    if (code === 'H' && want.has('26.3')) {
      const tanks = Array.isArray(v.fuelTank) ? v.fuelTank : (v.fuelTank ? String(v.fuelTank).split('|') : []);
      if (tanks.length === 1) {
        if (v.fuelTotal != null && v.fuelTotal !== '') setRob(tanks[0], Number(v.fuelTotal));
        else if (numOrNull(v.fuelQty) != null) {
          const hit = findTank(setup, tanks[0]);
          const base = hit && hit.tank.robM3 != null ? Number(hit.tank.robM3) : 0;
          setRob(tanks[0], base + Number(v.fuelQty));
        }
      }
    }

    return notes;
  }

  function fmtVal(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) {
      return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(Number(v.toFixed(3)));
    }
    return String(v).trim();
  }

  function selectedItemNos(selected) {
    return (selected || []).slice().sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  function buildItemLines(part, code, selectedItems, values, setup) {
    const op = getOperation(part, code);
    if (!op) return [];
    const val = values || {};
    const want = new Set(selectedItemNos(selectedItems));
    const lines = [];

    function resolve(fieldDef) {
      let v = val[fieldDef.name];
      if (fieldDef.type === 'tank') v = tankName(setup, v) || v;
      if (fieldDef.type === 'tankMulti') {
        const arr = Array.isArray(v) ? v : (v ? String(v).split('|') : []);
        v = arr.map(id => tankName(setup, id) || id).filter(Boolean).join(', ');
      }
      return fmtVal(v);
    }

    op.items.forEach(item => {
      if (want.size && !want.has(item.no) && !(code === 'I' && item.no === 'I') && !(code === 'O' && item.no === 'O')) return;
      const parts = [];
      (item.fields || []).forEach(f => {
        const v = resolve(f);
        if (v !== '') parts.push(v);
      });
      if (!parts.length && want.size && !want.has(item.no)) return;
      if (!parts.length && !want.size) return;
      let text = parts.join('; ');
      /* Prefer MEPC-style compact phrases for common items */
      if (code === 'C' && item.no === '11.1') text = resolve(item.fields[0]);
      if (code === 'C' && item.no === '11.2') text = resolve(item.fields[0]) + ' m³';
      if (code === 'C' && item.no === '11.3') text = resolve(item.fields[0]) + ' m³';
      if (code === 'C' && item.no === '11.4' && resolve(item.fields[0])) text = resolve(item.fields[0]) + ' m³';
      if (code === 'C' && item.no === '12.1') {
        text = [resolve(item.fields[0]) && (resolve(item.fields[0]) + ' m³ sludge from ' + resolve(item.fields[1])),
          resolve(item.fields[2]) !== '' ? (resolve(item.fields[2]) + ' m³ retained') : '',
          resolve(item.fields[3]) ? ('to reception facilities at ' + resolve(item.fields[3])) : ''
        ].filter(Boolean).join(', ');
      }
      if (code === 'C' && item.no === '12.2') {
        text = [resolve(item.fields[0]) + ' m³ from ' + resolve(item.fields[1]) + ' to ' + resolve(item.fields[2]),
          resolve(item.fields[3]) !== '' ? ('total content ' + resolve(item.fields[3]) + ' m³') : '',
          resolve(item.fields[4]) !== '' ? (resolve(item.fields[4]) + ' m³ retained') : ''
        ].filter(Boolean).join(', ');
      }
      if (code === 'C' && item.no === '12.3') {
        text = [resolve(item.fields[0]) + ' m³ from ' + resolve(item.fields[1]),
          resolve(item.fields[2]) !== '' ? (resolve(item.fields[2]) + ' m³ retained') : '',
          'incinerated ' + resolve(item.fields[3]) + ' h'
        ].filter(Boolean).join(', ');
      }
      if (code === 'D' && item.no === '13') {
        const bits = [resolve(item.fields[0]) + ' m³ bilge water'];
        if (resolve(item.fields[1])) bits.push('from ' + resolve(item.fields[1]));
        if (resolve(item.fields[2])) bits.push('cap. ' + resolve(item.fields[2]) + ' m³');
        if (resolve(item.fields[3]) !== '') bits.push(resolve(item.fields[3]) + ' m³ retained');
        text = bits.join(', ');
      }
      if (code === 'D' && item.no === '14') text = 'start: ' + resolve(item.fields[0]) + ', stop: ' + resolve(item.fields[1]);
      if (code === 'D' && item.no === '15.1') text = 'through 15 ppm equipment, start ' + resolve(item.fields[0]) + ', end ' + resolve(item.fields[1]);
      if (code === 'D' && item.no === '15.2') text = 'to reception facilities at ' + resolve(item.fields[0]);
      if (code === 'D' && item.no === '15.3') text = 'to ' + resolve(item.fields[0]) + (resolve(item.fields[1]) !== '' ? (', ' + resolve(item.fields[1]) + ' m³ retained') : '');
      if (code === 'H' && item.no === '26.3') {
        text = resolve(item.fields[0]) + ' ' + resolve(item.fields[1]) + ' t to ' + resolve(item.fields[2]) +
          (resolve(item.fields[3]) !== '' ? (', total content ' + resolve(item.fields[3]) + ' t') : '');
      }
      if ((code === 'I' || code === 'O') && (item.no === 'I' || item.no === 'O')) text = resolve(item.fields[0]);
      if (!text) return;
      lines.push({ itemNo: item.no, text });
    });
    return lines;
  }

  function validateEntry(part, code, selectedItems, values, setup) {
    const op = getOperation(part, code);
    const errors = [];
    if (!op) { errors.push('Unknown operation code.'); return errors; }
    if (Number(part) === 2 && setup && setup.shipType !== 'tanker') {
      errors.push('Part II is for oil tankers. Set ship type to Tanker in ORB Vessel Setup.');
    }
    const want = selectedItemNos(selectedItems);
    if (!want.length) errors.push('Select at least one item number for this operation.');
    const byNo = {};
    op.items.forEach(it => { byNo[it.no] = it; });
    want.forEach(no => {
      const it = byNo[no];
      if (!it) { errors.push('Unknown item ' + no); return; }
      (it.fields || []).forEach(f => {
        if (!f.required) return;
        let v = values[f.name];
        if (f.type === 'tankMulti') {
          const arr = Array.isArray(v) ? v : (v ? String(v).split('|') : []);
          if (!arr.length) errors.push(f.label + ' is required (' + no + ').');
        } else if (v == null || String(v).trim() === '') {
          errors.push(f.label + ' is required (' + no + ').');
        }
      });
    });
    return errors;
  }

  function formatOrbDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + (isoDate.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return isoDate;
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const dd = String(d.getDate()).padStart(2, '0');
    return dd + '-' + months[d.getMonth()] + '-' + d.getFullYear();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildPrintHtml(setup, entries, rangeLabel) {
    const flag = getFlag(setup.flag);
    const rows = (entries || []).filter(e => !e.voided).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    let body = '';
    rows.forEach(e => {
      const lines = e.lines || [];
      lines.forEach((ln, idx) => {
        body += '<tr>' +
          '<td>' + (idx === 0 ? escapeHtml(formatOrbDate(e.date)) : '') + '</td>' +
          '<td>' + (idx === 0 ? escapeHtml(e.code) : '') + '</td>' +
          '<td>' + escapeHtml(ln.itemNo) + '</td>' +
          '<td>' + escapeHtml(ln.text) +
            (idx === lines.length - 1 ? '<div class="orb-sign">Signed: ' + escapeHtml(e.officerName || '') +
              (e.officerRank ? (', ' + escapeHtml(e.officerRank)) : '') +
              (e.officerSignedAt ? (' — ' + escapeHtml(formatOrbDate(e.officerSignedAt.slice(0, 10)))) : '') +
              '</div>' : '') +
          '</td></tr>';
      });
    });
    if (!body) body = '<tr><td colspan="4" style="text-align:center;padding:24px;">No entries in selected period.</td></tr>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Oil Record Book</title>' +
      '<style>' +
      '@page{size:A4 portrait;margin:12mm}' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:11px}' +
      'h1{font-size:16px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em}' +
      'h2{font-size:13px;margin:0 0 10px}' +
      '.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:12px;font-size:11px}' +
      'table{width:100%;border-collapse:collapse}' +
      'th,td{border:1px solid #333;padding:5px 6px;vertical-align:top}' +
      'th{background:#eee;font-size:10px;text-transform:uppercase}' +
      'td:nth-child(1){width:90px}td:nth-child(2){width:48px;text-align:center}td:nth-child(3){width:52px;text-align:center}' +
      '.orb-sign{margin-top:6px;font-size:10px;font-style:italic}' +
      '.foot{margin-top:14px;font-size:9px;color:#444;line-height:1.4}' +
      '.master{margin-top:18px;display:flex;justify-content:space-between;gap:24px}' +
      '.master div{flex:1;border-top:1px solid #333;padding-top:4px;min-height:36px}' +
      '</style></head><body>' +
      '<h1>Oil Record Book — Part ' + (rows[0] && rows[0].part === 2 ? 'II' : 'I') + '</h1>' +
      '<h2>' + (rows[0] && rows[0].part === 2 ? 'Cargo / Ballast Operations (Oil Tankers)' : 'Machinery Space Operations (All Ships)') + '</h2>' +
      '<div class="meta">' +
      '<div><strong>Name of ship:</strong> ' + escapeHtml(setup.shipName || '') + '</div>' +
      '<div><strong>IMO No.:</strong> ' + escapeHtml(setup.imo || '') + '</div>' +
      '<div><strong>Distinctive number or letters:</strong> ' + escapeHtml(setup.callSign || '') + '</div>' +
      '<div><strong>Gross tonnage:</strong> ' + escapeHtml(fmtVal(setup.gt)) + '</div>' +
      '<div><strong>Flag administration:</strong> ' + escapeHtml(flag.name) + '</div>' +
      '<div><strong>Period:</strong> ' + escapeHtml(rangeLabel || '') + '</div>' +
      '</div>' +
      '<table><thead><tr><th>Date</th><th>Code</th><th>Item</th><th>Record of operations / signature of officer in charge</th></tr></thead><tbody>' +
      body + '</tbody></table>' +
      '<div class="master"><div>Master\'s signature / date</div><div>Ship\'s stamp</div></div>' +
      '<div class="foot">MARPOL Annex I Appendix III codes. Flag: ' + escapeHtml(flag.admin) +
      '. Language: ' + escapeHtml(flag.language) + '. ' +
      'This printout is generated by Noon Report e-ORB. Official electronic ORB use as a hard-copy replacement requires flag-approved software under IMO MEPC.312(74) and a ship-specific Declaration. ' +
      escapeHtml(flag.erbNote) +
      '</div></body></html>';
  }

  global.EORB = {
    FLAGS,
    PART_I,
    PART_II,
    defaultOrbSetup,
    getFlag,
    getPartOps,
    getOperation,
    tanksForGroup,
    tankName,
    buildItemLines,
    buildWeeklyInventory,
    autofillOperationValues,
    capacityWarnings,
    applyOperationRob,
    findTank,
    validateEntry,
    formatOrbDate,
    buildPrintHtml,
    selectedItemNos
  };
})(typeof window !== 'undefined' ? window : globalThis);
