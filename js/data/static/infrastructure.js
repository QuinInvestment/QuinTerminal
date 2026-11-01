// Curated reference layer: oil fields, refineries, terminals, hubs, the US SPR,
// pipelines, chokepoints and the main seaborne crude routes.
// Coordinates are approximate (site level, ±10–20 km) and capacities are
// public nameplate figures rounded to the nearest 10 kb/d — good for a map,
// not for engineering. "trapped" = loads inside the Persian Gulf, behind Hormuz.

export const CATS = {
  field: { label: "Oil field", color: "--s3" },
  refinery: { label: "Refinery", color: "--s1" },
  terminal: { label: "Export / import terminal", color: "--accent" },
  hub: { label: "Storage hub", color: "--s7" },
  spr: { label: "US Strategic Petroleum Reserve", color: "--s4" },
  processing: { label: "Processing plant", color: "--s5" },
  lng: { label: "LNG export", color: "--s6" },
};

const P = (id, name, cat, lat, lon, cc, cap, extra = {}) => ({ id, name, cat, lat, lon, cc, cap, ...extra });

export const POINTS = [
  // ---------------------------------------------------------------- Persian Gulf (behind Hormuz)
  P("ghawar", "Ghawar field", "field", 25.4, 49.35, "SA", 3800, { trapped: true, note: "World's largest conventional oil field" }),
  P("safaniya", "Safaniya field (offshore)", "field", 28.0, 48.85, "SA", 1300, { trapped: true }),
  P("khurais", "Khurais field", "field", 25.07, 48.18, "SA", 1500, { trapped: true }),
  P("manifa", "Manifa field (offshore)", "field", 27.67, 49.0, "SA", 900, { trapped: true }),
  P("shaybah", "Shaybah field", "field", 22.52, 53.95, "SA", 1000, { trapped: true }),
  P("abqaiq", "Abqaiq processing", "processing", 25.94, 49.68, "SA", 7000, { trapped: true, note: "Stabilises most Saudi crude; hit by drones in Sept 2019. Feeds the East-West pipeline." }),
  P("rastanura", "Ras Tanura terminal & refinery", "terminal", 26.66, 50.17, "SA", 3500, { trapped: true, note: "Largest Saudi export terminal; 550 kb/d refinery" }),
  P("juaymah", "Ju'aymah terminal", "terminal", 26.84, 50.02, "SA", 3000, { trapped: true }),
  P("rumaila", "Rumaila field", "field", 30.45, 47.33, "IQ", 1450, { trapped: true }),
  P("westqurna", "West Qurna fields", "field", 30.95, 47.28, "IQ", 900, { trapped: true }),
  P("basra", "Basra Oil Terminal (SPMs)", "terminal", 29.68, 48.81, "IQ", 3300, { trapped: true, note: "Almost all of Iraq's exports" }),
  P("burgan", "Burgan field", "field", 28.95, 47.95, "KW", 1700, { trapped: true }),
  P("ahmadi", "Mina al-Ahmadi terminal & refinery", "terminal", 29.06, 48.17, "KW", 1800, { trapped: true }),
  P("alzour", "Al-Zour refinery", "refinery", 28.73, 48.37, "KW", 615, { trapped: true }),
  P("kharg", "Kharg Island terminal", "terminal", 29.24, 50.31, "IR", 1800, { trapped: true, note: "~90% of Iran's crude exports" }),
  P("ahvaz", "Ahvaz fields", "field", 31.3, 48.8, "IR", 750, { trapped: true }),
  P("gachsaran", "Gachsaran field", "field", 30.35, 50.8, "IR", 500, { trapped: true }),
  P("abadan", "Abadan refinery", "refinery", 30.35, 48.28, "IR", 400, { trapped: true }),
  P("bandarabbas", "Bandar Abbas refinery & port", "refinery", 27.18, 56.27, "IR", 320, { trapped: true }),
  P("upperzakum", "Upper Zakum field (offshore)", "field", 24.9, 53.75, "AE", 1000, { trapped: true }),
  P("das", "Das Island terminal", "terminal", 25.15, 52.87, "AE", 800, { trapped: true }),
  P("ruwais", "Ruwais refinery & Jebel Dhanna", "refinery", 24.11, 52.73, "AE", 920, { trapped: true }),
  P("murban", "Murban onshore fields", "field", 23.8, 54.0, "AE", 1700, { note: "Partly exportable via the Habshan–Fujairah pipeline" }),
  P("raslaffan", "Ras Laffan LNG", "lng", 25.92, 51.55, "QA", 0, { trapped: true, note: "77 Mtpa LNG, about a fifth of world LNG supply" }),
  P("sitra", "Sitra refinery", "refinery", 26.15, 50.62, "BH", 260, { trapped: true }),

  // ---------------------------------------------------------------- bypass outlets and Red Sea
  P("fujairah", "Fujairah terminal & storage", "hub", 25.12, 56.36, "AE", 1500, { note: "Outside Hormuz; ADCOP outlet and Middle East's largest bunkering/storage hub" }),
  P("jask", "Jask terminal", "terminal", 25.65, 57.77, "IR", 300, { note: "Iran's Goreh–Jask bypass outlet (limited use)" }),
  P("minafahal", "Mina al Fahal (Muscat)", "terminal", 23.63, 58.52, "OM", 900, { note: "Omani crude, outside Hormuz" }),
  P("duqm", "Duqm refinery", "refinery", 19.67, 57.7, "OM", 230),
  P("yanbu", "Yanbu terminals & refineries", "terminal", 24.09, 38.06, "SA", 4500, { note: "East-West pipeline outlet on the Red Sea" }),
  P("rabigh", "Rabigh refinery", "refinery", 22.75, 39.0, "SA", 400),
  P("jazan", "Jazan refinery", "refinery", 16.85, 42.58, "SA", 400),
  P("sukhna", "Ain Sukhna (SUMED inlet)", "terminal", 29.6, 32.35, "EG", 2500),
  P("sidikerir", "Sidi Kerir (SUMED outlet)", "terminal", 31.1, 29.66, "EG", 2500),
  P("rasisa", "Ras Isa terminal", "terminal", 15.12, 42.6, "YE", 0, { note: "Houthi-held Red Sea port" }),
  P("eilat", "Eilat terminal (EAPC)", "terminal", 29.55, 34.95, "IL", 600),
  P("ashkelon", "Ashkelon terminal (EAPC)", "terminal", 31.67, 34.55, "IL", 600),
  P("haifa", "Haifa refinery", "refinery", 32.8, 35.03, "IL", 200),

  // ---------------------------------------------------------------- Mediterranean, Black Sea, Caspian
  P("ceyhan", "Ceyhan terminal", "terminal", 36.88, 35.93, "TR", 1500, { note: "Kirkuk–Ceyhan and BTC outlets" }),
  P("kirkuk", "Kirkuk field", "field", 35.47, 44.39, "IQ", 300),
  P("novo", "Novorossiysk (Sheskharis)", "terminal", 44.7, 37.8, "RU", 900),
  P("cpcterm", "CPC Marine Terminal", "terminal", 44.66, 37.65, "RU", 1500, { note: "Kazakh CPC Blend; SPM loadings, weather-sensitive" }),
  P("tuapse", "Tuapse refinery & port", "refinery", 44.1, 39.07, "RU", 240),
  P("tengiz", "Tengiz field", "field", 46.15, 53.38, "KZ", 900),
  P("kashagan", "Kashagan field (offshore)", "field", 46.0, 51.9, "KZ", 400),
  P("sangachal", "Sangachal terminal (BTC)", "terminal", 40.18, 49.47, "AZ", 1200),
  P("acg", "Azeri–Chirag–Gunashli (offshore)", "field", 40.1, 50.9, "AZ", 400),
  P("essider", "Es Sider terminal", "terminal", 30.63, 18.35, "LY", 450),
  P("raslanuf", "Ras Lanuf terminal", "terminal", 30.5, 18.57, "LY", 220),
  P("zueitina", "Zueitina terminal", "terminal", 30.85, 20.12, "LY", 70),
  P("sharara", "Sharara field", "field", 26.6, 12.2, "LY", 300),
  P("sirtebasin", "Sirte basin fields", "field", 29.0, 19.5, "LY", 600),
  P("hassi", "Hassi Messaoud field", "field", 31.7, 6.05, "DZ", 400),
  P("augusta", "Augusta–Priolo refining hub", "refinery", 37.2, 15.2, "IT", 400),
  P("trieste", "Trieste (TAL pipeline)", "terminal", 45.62, 13.78, "IT", 800),
  P("fos", "Fos-sur-Mer / Lavéra", "refinery", 43.43, 4.9, "FR", 200),

  // ---------------------------------------------------------------- Russia & Northern Europe
  P("primorsk", "Primorsk terminal", "terminal", 60.35, 28.67, "RU", 1000, { note: "Baltic Pipeline System crude and diesel" }),
  P("ustluga", "Ust-Luga terminal", "terminal", 59.68, 28.4, "RU", 700),
  P("kozmino", "Kozmino terminal (ESPO)", "terminal", 42.73, 133.07, "RU", 900),
  P("dekastri", "De-Kastri terminal", "terminal", 51.47, 140.78, "RU", 250),
  P("omsk", "Omsk refinery", "refinery", 55.0, 73.4, "RU", 420),
  P("kirishi", "Kirishi refinery", "refinery", 59.45, 32.02, "RU", 400),
  P("ryazan", "Ryazan refinery", "refinery", 54.6, 39.7, "RU", 340),
  P("volgograd", "Volgograd refinery", "refinery", 48.5, 44.6, "RU", 300),
  P("kstovo", "Kstovo (NORSI) refinery", "refinery", 56.15, 44.2, "RU", 340),
  P("samotlor", "West Siberia (Samotlor)", "field", 61.15, 76.7, "RU", 400),
  P("vankor", "Vankor field", "field", 67.8, 83.5, "RU", 300),
  P("sverdrup", "Johan Sverdrup field", "field", 58.84, 2.62, "NO", 755),
  P("mongstad", "Mongstad terminal & refinery", "terminal", 60.81, 5.03, "NO", 900),
  P("sullom", "Sullom Voe terminal", "terminal", 60.46, -1.28, "GB", 200),
  P("rotterdam", "Rotterdam (ARA hub)", "hub", 51.95, 4.05, "NL", 1200, { note: "Europe's main refining and storage hub" }),
  P("antwerp", "Antwerp refining", "refinery", 51.3, 4.3, "BE", 340),
  P("wilhelmshaven", "Wilhelmshaven", "terminal", 53.55, 8.15, "DE", 400),
  P("gdansk", "Gdańsk Naftoport", "terminal", 54.4, 18.7, "PL", 600),
  P("schwedt", "Schwedt refinery", "refinery", 53.06, 14.28, "DE", 230),
  P("leuna", "Leuna refinery", "refinery", 51.3, 12.0, "DE", 240),
  P("plock", "Płock refinery", "refinery", 52.55, 19.7, "PL", 330),
  P("mozyr", "Mozyr refinery", "refinery", 52.05, 29.2, "BY", 240),
  P("szazhalombatta", "Százhalombatta refinery", "refinery", 47.3, 18.92, "HU", 160),
  P("slovnaft", "Slovnaft refinery", "refinery", 48.13, 17.18, "SK", 120),

  // ---------------------------------------------------------------- Americas
  P("cushing", "Cushing, Oklahoma", "hub", 35.98, -96.77, "US", 0, { note: "WTI delivery point, ~90 mb working storage; operational floor near 20 mb" }),
  P("permian", "Permian Basin", "field", 31.9, -102.3, "US", 6500),
  P("bakken", "Bakken", "field", 47.9, -103.3, "US", 1200),
  P("eagleford", "Eagle Ford", "field", 28.6, -98.6, "US", 1100),
  P("gom", "US Gulf of Mexico deepwater", "field", 27.9, -89.9, "US", 1900),
  P("corpus", "Corpus Christi", "terminal", 27.81, -97.4, "US", 2300, { note: "Largest US crude export port" }),
  P("houston", "Houston / Texas City", "terminal", 29.73, -95.1, "US", 1500),
  P("loop", "LOOP deepwater port", "terminal", 28.88, -90.02, "US", 1200),
  P("portarthur", "Port Arthur refinery (Motiva)", "refinery", 29.88, -93.94, "US", 630),
  P("galvestonbay", "Galveston Bay refinery", "refinery", 29.38, -94.92, "US", 630),
  P("baytown", "Baytown refinery", "refinery", 29.75, -95.0, "US", 590),
  P("beaumont", "Beaumont refinery", "refinery", 30.07, -94.08, "US", 630),
  P("garyville", "Garyville refinery", "refinery", 30.06, -90.62, "US", 600),
  P("lakecharles", "Lake Charles refining", "refinery", 30.23, -93.27, "US", 460),
  P("whiting", "Whiting refinery", "refinery", 41.68, -87.48, "US", 440),
  P("bryanmound", "SPR Bryan Mound", "spr", 28.93, -95.38, "US", 0),
  P("bighill", "SPR Big Hill", "spr", 29.79, -94.2, "US", 0),
  P("westhackberry", "SPR West Hackberry", "spr", 29.99, -93.4, "US", 0),
  P("bayouchoctaw", "SPR Bayou Choctaw", "spr", 30.41, -91.37, "US", 0),
  P("oilsands", "Alberta oil sands", "field", 57.0, -111.5, "CA", 3500),
  P("hardisty", "Hardisty hub", "hub", 52.67, -111.3, "CA", 0),
  P("burnaby", "Westridge / Burnaby (TMX)", "terminal", 49.29, -122.95, "CA", 890),
  P("dosbocas", "Olmeca (Dos Bocas) refinery", "refinery", 18.43, -93.18, "MX", 340),
  P("kmz", "Ku-Maloob-Zaap (offshore)", "field", 19.4, -92.2, "MX", 600),
  P("jose", "José terminal", "terminal", 10.1, -64.84, "VE", 600),
  P("orinoco", "Orinoco belt", "field", 8.6, -64.0, "VE", 700),
  P("stabroek", "Stabroek (Guyana)", "field", 8.05, -56.85, "GY", 900),
  P("santos", "Santos pre-salt", "field", -25.0, -42.7, "BR", 3000),
  P("saosebastiao", "São Sebastião terminal", "terminal", -23.8, -45.4, "BR", 600),

  // ---------------------------------------------------------------- Africa
  P("bonny", "Bonny terminal", "terminal", 4.42, 7.15, "NG", 400),
  P("forcados", "Forcados terminal", "terminal", 5.35, 5.35, "NG", 250),
  P("nigerdelta", "Niger Delta fields", "field", 4.8, 6.5, "NG", 1500),
  P("dangote", "Dangote refinery", "refinery", 6.43, 3.98, "NG", 650),
  P("angola", "Angola deepwater", "field", -7.0, 11.8, "AO", 1100),
  P("saldanha", "Saldanha Bay storage", "hub", -33.03, 17.95, "ZA", 0),

  // ---------------------------------------------------------------- Asia
  P("jamnagar", "Jamnagar refining complex", "refinery", 22.35, 69.85, "IN", 1400, { note: "World's largest refining site" }),
  P("vadinar", "Vadinar refinery", "refinery", 22.48, 69.7, "IN", 400),
  P("singapore", "Singapore (Jurong / Bukom)", "hub", 1.26, 103.7, "SG", 1300, { note: "Asia's pricing and storage hub" }),
  P("pengerang", "Pengerang refinery", "refinery", 1.37, 104.12, "MY", 300),
  P("ningbo", "Ningbo–Zhoushan", "terminal", 29.93, 122.06, "CN", 2000, { note: "China's largest crude import port" }),
  P("zpc", "Zhoushan ZPC refinery", "refinery", 30.25, 122.15, "CN", 800),
  P("qingdao", "Qingdao / Dongjiakou", "terminal", 36.0, 120.3, "CN", 1500),
  P("shandong", "Shandong independent refiners", "refinery", 37.45, 118.5, "CN", 1500),
  P("dalian", "Dalian refining", "refinery", 39.5, 121.6, "CN", 400),
  P("daqing", "Daqing field", "field", 46.6, 125.0, "CN", 600),
  P("ulsan", "Ulsan refinery", "refinery", 35.48, 129.37, "KR", 840),
  P("yeosu", "Yeosu refinery", "refinery", 34.85, 127.75, "KR", 800),
  P("chiba", "Chiba / Tokyo Bay refining", "refinery", 35.55, 140.05, "JP", 400),
  P("mailiao", "Mailiao refinery", "refinery", 23.78, 120.2, "TW", 540),
];

// ---------------------------------------------------------------- pipelines [lon, lat]
export const PIPELINES = [
  { id: "eastwest", name: "East-West (Petroline)", cap: 7000, status: "partial", bypass: true, note: "Abqaiq → Yanbu. Hit by drones 11 Sep 2026, restarted 22 Sep.", path: [[49.68, 25.94], [48.2, 25.4], [46.7, 24.7], [44.0, 24.4], [41.3, 24.3], [39.2, 24.1], [38.06, 24.09]] },
  { id: "adcop", name: "Habshan–Fujairah (ADCOP)", cap: 1500, status: "open", bypass: true, note: "UAE bypass to the Gulf of Oman", path: [[53.62, 23.83], [54.6, 24.05], [55.5, 24.45], [56.05, 24.85], [56.36, 25.12]] },
  { id: "gorehjask", name: "Goreh–Jask", cap: 1000, status: "limited", bypass: true, note: "Iran's bypass; small sustained throughput", path: [[50.95, 29.88], [52.5, 28.6], [54.6, 27.3], [56.4, 26.2], [57.77, 25.65]] },
  { id: "itp", name: "Kirkuk–Ceyhan (ITP)", cap: 1600, status: "limited", bypass: true, note: "Northern Iraq to the Mediterranean", path: [[44.39, 35.47], [43.4, 36.6], [42.2, 37.15], [40.4, 37.3], [38.4, 37.05], [36.6, 36.95], [35.93, 36.88]] },
  { id: "sumed", name: "SUMED", cap: 2500, status: "open", note: "Red Sea → Mediterranean", path: [[32.35, 29.6], [31.5, 30.0], [30.6, 30.55], [29.66, 31.1]] },
  { id: "eapc", name: "Eilat–Ashkelon", cap: 600, status: "open", note: "Reversible Red Sea–Mediterranean line", path: [[34.95, 29.55], [34.85, 30.3], [34.7, 31.0], [34.55, 31.67]] },
  { id: "cpc", name: "Caspian Pipeline Consortium", cap: 1500, status: "open", note: "Tengiz → Novorossiysk", path: [[53.38, 46.15], [51.9, 47.1], [49.0, 46.5], [46.5, 45.6], [44.0, 45.2], [41.5, 45.0], [39.5, 44.9], [37.65, 44.66]] },
  { id: "btc", name: "Baku–Tbilisi–Ceyhan", cap: 1200, status: "open", path: [[49.47, 40.18], [47.5, 40.7], [45.5, 41.2], [44.8, 41.7], [43.2, 41.3], [41.5, 40.4], [39.5, 39.6], [37.5, 38.2], [35.93, 36.88]] },
  { id: "druzhba", name: "Druzhba (trunk)", cap: 1500, status: "partial", path: [[52.3, 54.9], [49.0, 54.5], [44.0, 53.7], [39.0, 53.2], [35.0, 53.0], [32.68, 52.85], [29.2, 52.05]] },
  { id: "druzhban", name: "Druzhba north", cap: 1000, status: "idle", note: "Flows to Poland and Germany stopped in 2023", path: [[29.2, 52.05], [26.0, 52.3], [23.5, 52.3], [21.5, 52.4], [19.7, 52.55], [16.5, 52.8], [14.28, 53.06]] },
  { id: "druzhbas", name: "Druzhba south", cap: 400, status: "open", note: "Slovakia and Hungary", path: [[29.2, 52.05], [27.0, 51.0], [25.0, 50.4], [23.0, 49.3], [21.5, 48.7], [19.5, 48.3], [17.18, 48.13]] },
  { id: "bps", name: "Baltic Pipeline System", cap: 1200, status: "open", path: [[39.7, 58.0], [35.0, 59.2], [31.5, 59.9], [28.67, 60.35]] },
  { id: "espo", name: "ESPO", cap: 1600, status: "open", path: [[98.0, 55.95], [104.0, 55.0], [110.0, 55.3], [116.0, 54.0], [120.0, 53.9], [123.94, 53.98], [127.5, 51.0], [130.5, 48.5], [132.0, 45.0], [133.07, 42.73]] },
  { id: "espochina", name: "ESPO spur to Daqing", cap: 600, status: "open", path: [[123.94, 53.98], [124.3, 51.0], [125.0, 46.6]] },
  { id: "kazchina", name: "Kazakhstan–China", cap: 400, status: "open", path: [[51.9, 47.1], [57.0, 48.5], [63.0, 47.0], [70.0, 45.5], [76.0, 45.0], [82.6, 45.2]] },
  { id: "myanmar", name: "Myanmar–China", cap: 440, status: "open", path: [[93.55, 19.43], [95.0, 21.5], [96.1, 21.97], [98.0, 23.0], [100.5, 24.7], [102.7, 25.0]] },
  { id: "keystone", name: "Keystone", cap: 620, status: "open", path: [[-111.3, 52.67], [-108.0, 50.5], [-104.0, 49.0], [-100.5, 45.5], [-97.5, 42.0], [-96.1, 40.0], [-96.77, 35.98]] },
  { id: "marketlink", name: "Cushing → Gulf Coast", cap: 700, status: "open", path: [[-96.77, 35.98], [-95.5, 33.0], [-94.9, 30.6], [-95.1, 29.75]] },
  { id: "tmx", name: "Trans Mountain (TMX)", cap: 890, status: "open", path: [[-113.5, 53.55], [-116.5, 53.3], [-119.0, 52.8], [-121.0, 50.7], [-122.95, 49.29]] },
  { id: "permiancc", name: "Permian → Corpus Christi", cap: 3000, status: "open", path: [[-102.1, 31.9], [-100.0, 30.9], [-98.5, 29.5], [-97.4, 27.8]] },
  { id: "permianhou", name: "Permian → Houston", cap: 2000, status: "open", path: [[-102.1, 31.9], [-99.0, 31.5], [-96.0, 30.3], [-95.1, 29.75]] },
  { id: "tal", name: "Transalpine (TAL)", cap: 800, status: "open", path: [[13.78, 45.62], [13.0, 46.5], [12.6, 47.6], [11.9, 48.4]] },
];

// ---------------------------------------------------------------- chokepoints
// flows in mb/d: pre = 1H 2025 (EIA), now = 2Q 2026 (EIA STEO Aug 2026, Vortexa)
export const CHOKEPOINTS = [
  { id: "hormuz", name: "Strait of Hormuz", lat: 26.57, lon: 56.25, pre: 20.9, now: 4.9, status: "closed", note: "Effectively closed to normal traffic since 28 Feb 2026" },
  { id: "malacca", name: "Strait of Malacca", lat: 2.8, lon: 100.9, pre: 23.2, now: 16.6, status: "open", note: "Volumes down with Gulf exports" },
  { id: "bab", name: "Bab el-Mandeb", lat: 12.6, lon: 43.35, pre: 4.2, now: 8.1, status: "contested", note: "Up on Yanbu exports; Yemeni coast contested since Sept 2026" },
  { id: "suez", name: "Suez Canal & SUMED", lat: 30.4, lon: 32.35, pre: 4.9, now: 5.8, status: "open", note: "2Q26 figure is the canal only" },
  { id: "cape", name: "Cape of Good Hope", lat: -34.6, lon: 18.5, pre: 9.1, now: 9.4, status: "open", note: "Diversion route" },
  { id: "danish", name: "Danish straits", lat: 55.6, lon: 12.75, pre: 4.9, now: 4.7, status: "open", note: "Russian Baltic exports" },
  { id: "turkish", name: "Turkish straits", lat: 41.12, lon: 29.07, pre: 3.7, now: 4.1, status: "open", note: "Russian and Kazakh Black Sea exports" },
  { id: "panama", name: "Panama Canal", lat: 9.1, lon: -79.68, pre: 2.3, now: 3.2, status: "open" },
];

// Hormuz shipping lanes (traffic separation scheme, schematic)
export const TSS = [
  { id: "hormuz-in", path: [[57.2, 26.25], [56.75, 26.47], [56.45, 26.62], [56.2, 26.6], [55.9, 26.45]] },
  { id: "hormuz-out", path: [[55.9, 26.35], [56.2, 26.48], [56.45, 26.5], [56.75, 26.36], [57.2, 26.12]] },
  { id: "bab-lane", path: [[43.15, 12.9], [43.42, 12.55], [43.7, 12.2]] },
];

// ---------------------------------------------------------------- seaborne routes (illustrative pre-crisis mb/d)
const GULF_OUT = [[50.2, 26.7], [52.0, 26.5], [54.5, 26.3], [56.3, 26.55], [57.3, 25.9], [58.8, 24.6], [60.5, 23.0]];
const ARAB_TO_SRI = [[62.0, 20.0], [66.0, 15.0], [72.0, 8.0], [78.0, 5.5], [80.6, 5.6]];
const SRI_TO_SG = [[85.0, 5.6], [92.0, 5.9], [95.5, 5.9], [97.8, 5.5], [99.5, 4.0], [101.5, 2.5], [103.3, 1.3], [104.3, 1.3]];
const SCS_NORTH = [[106.0, 5.0], [109.0, 10.0], [112.5, 16.0], [116.5, 21.0]];
const TO_NINGBO = [[119.5, 24.5], [121.5, 27.0], [122.1, 29.9]];
const TO_QINGDAO = [[119.5, 24.5], [121.5, 27.0], [123.0, 30.5], [122.8, 33.5], [120.3, 36.0]];
const TO_KOREA = [[121.0, 22.0], [124.5, 26.5], [127.5, 31.5], [129.4, 35.4]];
const TO_JAPAN = [[121.0, 21.5], [126.0, 25.5], [132.0, 31.0], [137.5, 33.8], [139.9, 35.3]];
const GULF_TO_BAB = [[58.5, 19.0], [53.0, 14.0], [48.0, 12.4], [45.0, 12.4], [43.4, 12.6]];
const RED_SEA_N = [[42.2, 14.5], [40.0, 18.5], [37.5, 22.5], [35.5, 26.0], [33.8, 27.8], [32.6, 29.6], [32.35, 30.4], [32.3, 31.3]];
const MED_W = [[28.0, 33.0], [22.0, 34.5], [15.0, 36.5], [11.0, 37.4], [6.0, 37.8], [0.0, 36.6], [-5.6, 35.95]];
const ATL_N = [[-9.5, 37.0], [-9.8, 43.0], [-6.0, 47.8], [-3.0, 49.5], [1.0, 50.8], [3.5, 51.6], [4.05, 51.95]];
const BAB_TO_ARAB = [[45.0, 12.4], [48.0, 12.4], [53.0, 14.0], [60.0, 15.0]];

export const ROUTES = [
  { id: "gulf-china", name: "Gulf → China", mbd: 5.4, via: ["hormuz", "malacca"], crisis: "blocked", path: [...GULF_OUT, ...ARAB_TO_SRI, ...SRI_TO_SG, ...SCS_NORTH, ...TO_NINGBO] },
  { id: "gulf-india", name: "Gulf → India", mbd: 2.1, via: ["hormuz"], crisis: "blocked", path: [...GULF_OUT, [64.0, 22.5], [69.85, 22.35]] },
  { id: "gulf-korea", name: "Gulf → South Korea", mbd: 1.7, via: ["hormuz", "malacca"], crisis: "blocked", path: [...GULF_OUT, ...ARAB_TO_SRI, ...SRI_TO_SG, ...SCS_NORTH, ...TO_KOREA] },
  { id: "gulf-japan", name: "Gulf → Japan", mbd: 1.6, via: ["hormuz", "malacca"], crisis: "blocked", path: [...GULF_OUT, ...ARAB_TO_SRI, ...SRI_TO_SG, ...SCS_NORTH, ...TO_JAPAN] },
  { id: "gulf-europe", name: "Gulf → Europe (Suez)", mbd: 0.8, via: ["hormuz", "bab", "suez"], crisis: "blocked", path: [...GULF_OUT, ...GULF_TO_BAB, ...RED_SEA_N, ...MED_W, ...ATL_N] },
  { id: "yanbu-asia", name: "Yanbu → Asia (bypass)", mbd: 3.0, via: ["bab", "malacca"], crisis: "bypass", path: [[38.06, 24.09], [39.5, 20.5], [41.0, 17.0], [42.5, 14.0], [43.4, 12.6], ...BAB_TO_ARAB, [66.0, 15.0], [72.0, 8.0], [78.0, 5.5], [80.6, 5.6], ...SRI_TO_SG, ...SCS_NORTH, ...TO_NINGBO] },
  { id: "yanbu-europe", name: "Yanbu → Europe (bypass)", mbd: 1.5, via: ["suez"], crisis: "bypass", path: [[38.06, 24.09], [36.5, 25.5], [35.0, 27.0], [33.8, 27.8], [32.6, 29.6], [32.35, 30.4], [32.3, 31.3], ...MED_W, ...ATL_N] },
  { id: "fujairah-asia", name: "Fujairah → Asia (bypass)", mbd: 1.5, via: ["malacca"], crisis: "bypass", path: [[56.36, 25.12], [57.8, 24.2], [60.5, 22.5], ...ARAB_TO_SRI, ...SRI_TO_SG, ...SCS_NORTH, ...TO_NINGBO] },
  { id: "rubaltic-india", name: "Russia Baltic → India", mbd: 1.0, via: ["danish", "suez", "bab"], crisis: "risk", path: [[28.67, 60.35], [26.0, 59.9], [22.5, 59.4], [19.5, 57.5], [17.0, 55.8], [14.0, 55.1], [12.75, 55.6], [11.0, 57.5], [8.5, 57.8], [4.0, 56.0], [2.0, 52.0], [1.0, 50.8], [-3.0, 49.5], [-6.0, 47.8], [-9.8, 43.0], [-9.5, 37.0], [-5.6, 35.95], [0.0, 36.6], [6.0, 37.8], [11.0, 37.4], [15.0, 36.5], [22.0, 34.5], [28.0, 33.0], [32.3, 31.3], [32.35, 30.4], [32.6, 29.6], [33.8, 27.8], [35.5, 26.0], [37.5, 22.5], [40.0, 18.5], [42.2, 14.5], [43.4, 12.6], ...BAB_TO_ARAB, [64.0, 18.5], [69.85, 22.35]] },
  { id: "rublack-india", name: "Russia Black Sea → India", mbd: 0.5, via: ["turkish", "suez", "bab"], crisis: "risk", path: [[37.8, 44.7], [34.0, 43.5], [30.5, 42.0], [29.07, 41.12], [28.0, 40.6], [26.4, 40.1], [25.5, 38.5], [26.0, 36.0], [28.5, 34.0], [32.3, 31.3], [32.35, 30.4], [32.6, 29.6], [33.8, 27.8], [35.5, 26.0], [37.5, 22.5], [40.0, 18.5], [42.2, 14.5], [43.4, 12.6], ...BAB_TO_ARAB, [64.0, 18.5], [69.85, 22.35]] },
  { id: "cpc-europe", name: "CPC → Europe", mbd: 1.3, via: ["turkish"], crisis: "normal", path: [[37.65, 44.66], [34.0, 43.5], [30.5, 42.0], [29.07, 41.12], [28.0, 40.6], [26.4, 40.1], [25.0, 38.0], [22.0, 36.5], [18.5, 38.5], [17.0, 40.8], [14.5, 43.5], [13.78, 45.62]] },
  { id: "kozmino-china", name: "Kozmino → China", mbd: 0.9, via: [], crisis: "normal", path: [[133.07, 42.73], [131.0, 39.0], [129.5, 35.5], [127.0, 33.5], [124.0, 34.5], [121.5, 36.5], [120.3, 36.0]] },
  { id: "usgc-europe", name: "US Gulf → Europe", mbd: 1.8, via: [], crisis: "normal", path: [[-97.4, 27.8], [-93.0, 26.5], [-87.0, 25.0], [-81.5, 24.2], [-79.5, 26.5], [-75.0, 32.0], [-60.0, 38.0], [-40.0, 43.0], [-20.0, 46.5], [-8.0, 48.5], [-3.0, 49.5], [1.0, 50.8], [4.05, 51.95]] },
  { id: "usgc-asia", name: "US Gulf → Asia (Cape)", mbd: 1.4, via: ["cape", "malacca"], crisis: "normal", path: [[-97.4, 27.8], [-90.0, 25.0], [-85.0, 22.0], [-80.0, 18.0], [-70.0, 15.0], [-50.0, 8.0], [-30.0, -5.0], [-10.0, -20.0], [10.0, -33.0], [20.0, -36.0], [40.0, -33.0], [60.0, -20.0], [80.0, -5.0], [95.0, 3.0], [99.5, 4.0], [101.5, 2.5], [103.3, 1.3], [104.3, 1.3], ...SCS_NORTH, ...TO_KOREA] },
  { id: "waf-europe", name: "West Africa → Europe", mbd: 1.0, via: [], crisis: "normal", path: [[7.15, 4.42], [4.0, 3.0], [-5.0, 4.0], [-15.0, 10.0], [-18.5, 20.0], [-16.0, 28.0], [-11.0, 37.0], [-9.8, 43.0], [-6.0, 47.8], [-3.0, 49.5], [1.0, 50.8], [4.05, 51.95]] },
  { id: "waf-india", name: "West Africa → India", mbd: 0.8, via: ["cape"], crisis: "normal", path: [[7.15, 4.42], [6.0, -2.0], [8.0, -15.0], [15.0, -30.0], [20.0, -36.0], [35.0, -34.0], [50.0, -22.0], [60.0, -5.0], [66.0, 10.0], [69.85, 22.35]] },
  { id: "brazil-china", name: "Brazil → China", mbd: 1.0, via: ["cape", "malacca"], crisis: "normal", path: [[-45.4, -24.0], [-35.0, -28.0], [-10.0, -34.0], [20.0, -37.0], [40.0, -35.0], [60.0, -25.0], [80.0, -10.0], [95.0, 3.0], [99.5, 4.0], [101.5, 2.5], [103.3, 1.3], [104.3, 1.3], ...SCS_NORTH, ...TO_QINGDAO] },
  { id: "northsea-ara", name: "North Sea → Rotterdam", mbd: 0.8, via: [], crisis: "normal", path: [[2.62, 58.84], [3.5, 56.5], [4.0, 53.5], [4.05, 51.95]] },
  { id: "libya-italy", name: "Libya → Italy", mbd: 0.8, via: [], crisis: "normal", path: [[18.35, 30.63], [17.5, 33.0], [16.0, 35.5], [15.2, 37.2], [18.0, 38.5], [18.8, 39.8], [17.5, 41.5], [14.5, 43.5], [13.78, 45.62]] },
  { id: "guyana-europe", name: "Guyana → Europe", mbd: 0.5, via: [], crisis: "normal", path: [[-56.85, 8.05], [-50.0, 12.0], [-35.0, 25.0], [-20.0, 38.0], [-9.8, 43.0], [-6.0, 47.8], [-3.0, 49.5], [1.0, 50.8], [4.05, 51.95]] },
  { id: "tmx-china", name: "Canada TMX → China", mbd: 0.3, via: [], crisis: "normal", path: [[-122.95, 49.29], [-124.7, 48.4], [-140.0, 47.0], [-160.0, 44.0], [-180.0, 40.0], [-200.0, 36.0], [-215.0, 32.0], [-237.9, 29.9]] },
];

export const SOURCES_NOTE = "Locations and capacities: company and government publications, EIA country briefs, Global Energy Monitor; chokepoint flows: EIA (1H 2025; 2Q 2026 via the August 2026 STEO, Vortexa). Route volumes are illustrative pre-crisis orders of magnitude.";
