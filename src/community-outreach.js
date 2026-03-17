/**
 * Edge Index — Community Outreach Engine
 *
 * Automates 3-stage email outreach to trading, crypto, forex, commodities
 * and investing community founders — male and female, global.
 *
 * Email sequence:
 *   Stage 1: Cold outreach — offer free personalised report (auto-whitelisted)
 *   Stage 2: Follow-up (3 days later if no reply)
 *   Stage 3: Post-report licensing pitch (24hrs after they receive their report)
 *   Stage 4: Final nudge (5 days after licensing pitch)
 *
 * Gender-aware copy:
 *   female/unknown → anxiety + protection tone
 *   male           → competitive edge + performance tone
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addPaidEmail } from './shared/paidUsers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'community-outreach.json');
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'The Edge Index <reports@edgeindex.io>';

// ─── Master target list ───────────────────────────────────────────────────────
// tier: 1=500k+  2=100k-500k  3=20k-100k  4=10k-20k
// gender: 'female' | 'male' | 'mixed' | 'unknown'

const INITIAL_TARGETS = [

  // ── FEMALE — CRYPTO / TRADING ─────────────────────────────────────────────
  { id: 'maren-altman',       gender: 'female', name: 'Maren Altman',       community: 'Maren Altman',            tier: 1, platform: 'TikTok/YouTube',   audience: '1.4M TikTok',   email: 'maren@marenaltman.com',              dmHandle: '@marenaltman',            niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Astrology + crypto — perfect fit' },
  { id: 'her-first-100k',     gender: 'female', name: 'Tori Dunlap',        community: 'Her First $100K',         tier: 1, platform: 'TikTok/Podcast',   audience: '5M+ women',     email: 'tori@herfirst100k.com',              dmHandle: '@herfirst100k',           niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Largest female investing community' },
  { id: 'cryptocita',         gender: 'female', name: 'Alina Pak',          community: 'Cryptocita',              tier: 1, platform: 'TikTok',           audience: '745K TikTok',   email: 'hello@cryptocita.com',               dmHandle: '@cryptocita',             niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'layah-heilpern',     gender: 'female', name: 'Layah Heilpern',     community: 'The Layah Heilpern Show', tier: 1, platform: 'TikTok/Podcast',   audience: '362K TikTok',   email: 'layah@bloxlive.tv',                  dmHandle: '@layahheilpern',          niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'humbled-trader',     gender: 'female', name: 'Shay (Humbled Trader)', community: 'Humbled Trader',       tier: 1, platform: 'YouTube',           audience: '400K+ YouTube', email: null,                                  dmHandle: '@humbledtrader',          niche: 'trading',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Contact via website form' },
  { id: 'wallstreet-queen',   gender: 'female', name: 'Wallstreet Queen',   community: 'Wallstreet Queen Official',tier: 1, platform: 'Telegram',         audience: '200K+',         email: null,                                  dmHandle: '@wallstreetqueenofficial',niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Telegram DM only' },
  { id: 'mindfully-trading',  gender: 'female', name: 'Emily Butler',       community: 'Mindfully Trading',       tier: 2, platform: 'YouTube',           audience: '81.5K subs',    email: 'emily@mindfullytrading.com',          dmHandle: '@mindfullytrading',       niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Trading psychology — strong fit' },
  { id: 'imkarenfoo',         gender: 'female', name: 'Karen Foo',          community: 'Karen Foo Trading',       tier: 2, platform: 'Instagram/YouTube', audience: '100K+',         email: 'admin@karen-foo.com',                dmHandle: '@imkarenfoo8',            niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'invest-diva',        gender: 'female', name: 'Kiana Danial',       community: 'Invest Diva',             tier: 2, platform: 'Instagram',         audience: '100K+',         email: 'support@investdiva.com',             dmHandle: '@investdiva',             niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'clever-girl-finance',gender: 'female', name: 'Bola Sokunbi',       community: 'Clever Girl Finance',     tier: 1, platform: 'YouTube',           audience: '400K+ YouTube', email: null,                                  dmHandle: '@clevergirlfinance',      niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'financial-diet',     gender: 'female', name: 'Chelsea Fagan',      community: 'The Financial Diet',      tier: 1, platform: 'YouTube',           audience: '1M+ YouTube',   email: 'chelsea@thefinancialdiet.com',        dmHandle: '@thefinancialdiet',       niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'delyanne',           gender: 'female', name: 'Delyanne Barros',    community: 'Stocks and Savings',      tier: 2, platform: 'Instagram',         audience: '200K+',         email: 'delyanneb@gmail.com',                dmHandle: '@delyannethemoneycoach',  niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'vestpod',            gender: 'female', name: 'Emilie Bellet',      community: 'Vestpod',                 tier: 3, platform: 'Podcast/Platform',  audience: '50K+',          email: 'hello@vestpod.com',                  dmHandle: 'vestpod.com',             niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'shefi',              gender: 'female', name: 'Maggie Love',        community: 'SheFi',                   tier: 3, platform: 'Community',         audience: '30K+',          email: null,                                  dmHandle: 'shefi.io',                niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Web3 women community' },
  { id: 'cryptochicks',       gender: 'female', name: 'Elena Sinelnikova',  community: 'CryptoChicks',            tier: 3, platform: 'Non-profit/Intl',   audience: 'International', email: 'elena.sinelnikova@gmail.com',         dmHandle: 'cryptochicks.ca',         niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'ladies-finance-club',gender: 'female', name: 'Ladies Finance Club',community: 'Ladies Finance Club',     tier: 3, platform: 'Events/Community',  audience: '20K+',          email: 'hello@ladiesfinanceclub.com.au',     dmHandle: 'ladiesfinanceclub.com.au',niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australia — priority' },
  { id: 'cryptowendyo',       gender: 'female', name: 'Cryptowendyo',       community: 'CryptoWendyo',            tier: 2, platform: 'TikTok',            audience: '272K TikTok',   email: null,                                  dmHandle: '@cryptowendyo',           niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'bitcoin-babyy',      gender: 'female', name: 'Kayla',              community: 'Bitcoin Babyy',           tier: 3, platform: 'TikTok/Instagram',  audience: '71K TikTok',    email: null,                                  dmHandle: '@bitcoinbabyy',           niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'raghee-horner',      gender: 'female', name: 'Raghee Horner',      community: 'Raghee Horner Trading',   tier: 2, platform: 'Instagram/YouTube', audience: '50K+',          email: null,                                  dmHandle: '@ragheehorner',           niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'this-girl-talks',    gender: 'female', name: 'Ellie Austin-Williams',community: 'This Girl Talks Money', tier: 3, platform: 'Podcast/Instagram', audience: '30K+',          email: 'hello@thisgirltalksmoney.com',        dmHandle: '@thisgirltalksmoney',     niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'broke-black-girl',   gender: 'female', name: 'Dasha Kennedy',      community: 'The Broke Black Girl',    tier: 2, platform: 'Facebook/Instagram',audience: '255K',          email: null,                                  dmHandle: '@thebrokeblackgirl',      niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'pennies-to-pounds',  gender: 'female', name: 'Kia Commodore',      community: 'Pennies to Pounds',       tier: 2, platform: 'Podcast/BBC',       audience: '100K+',         email: null,                                  dmHandle: '@pennies_to_pounds',      niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'nischa',             gender: 'female', name: 'Nischa Shah',        community: 'Nischa',                  tier: 2, platform: 'YouTube',           audience: '500K+ YouTube', email: null,                                  dmHandle: '@nischa',                 niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'heygermaine',        gender: 'female', name: 'Germaine Chow',      community: 'Financial Literacy AUS',  tier: 3, platform: 'Instagram',         audience: '50K+',          email: null,                                  dmHandle: '@heygermaine',            niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian' },
  { id: 'joyee-yang',         gender: 'female', name: 'Joyee Yang',         community: 'Financial Freedom',       tier: 2, platform: 'TikTok/Instagram',  audience: '161K TikTok',   email: null,                                  dmHandle: '@joyeeyang0',             niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'aligned-trader',     gender: 'female', name: 'Aligned Trader',     community: 'Aligned Trader',          tier: 3, platform: 'Instagram',         audience: '20K+',          email: null,                                  dmHandle: 'Search Instagram',        niche: 'trading',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'HD + trading — perfect fit' },

  // ── MALE — CRYPTO / BITCOIN ───────────────────────────────────────────────
  { id: 'coin-bureau',        gender: 'male',   name: 'Guy Turner',         community: 'Coin Bureau',             tier: 1, platform: 'YouTube',           audience: '2.4M YouTube',  email: 'contact@coinbureau.com',             dmHandle: '@coinbureau',             niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'crypto-banter',      gender: 'male',   name: 'Ran Neuner',         community: 'Crypto Banter',           tier: 1, platform: 'YouTube/Twitter',   audience: '1M+ YouTube',   email: 'ran@onchaincapital.io',              dmHandle: '@cryptomanran',           niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'wolf-all-streets',   gender: 'male',   name: 'Scott Melker',       community: 'Wolf of All Streets',     tier: 1, platform: 'Podcast/Twitter',   audience: '600K+ Twitter', email: 'scott@wolfofallstreets.com',          dmHandle: '@scottmelker',            niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'real-vision',        gender: 'male',   name: 'Raoul Pal',          community: 'Real Vision',             tier: 1, platform: 'Platform/YouTube',  audience: '1M+ global',    email: 'raoul@realvisiongroup.com',           dmHandle: '@raoulgmi',               niche: 'macro',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Macro investing — premium audience' },
  { id: 'pomp-podcast',       gender: 'male',   name: 'Anthony Pompliano',  community: 'The Pomp Podcast',        tier: 1, platform: 'Podcast/Twitter',   audience: '1.5M+ Twitter', email: 'anthony@pompcast.com',               dmHandle: '@apompliano',             niche: 'bitcoin',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'what-bitcoin-did',   gender: 'male',   name: 'Peter McCormack',    community: 'What Bitcoin Did',        tier: 1, platform: 'Podcast',           audience: '200K+ listeners',email: 'peter@whatbitcoindid.com',           dmHandle: '@PeterMcCormack',         niche: 'bitcoin',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'bankless',           gender: 'male',   name: 'Ryan Sean Adams',    community: 'Bankless',                tier: 1, platform: 'Podcast/Newsletter',audience: '500K+',          email: 'ryan@bankless.cc',                   dmHandle: '@ryansadams',             niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'into-cryptoverse',   gender: 'male',   name: 'Benjamin Cowen',     community: 'Into The Cryptoverse',    tier: 1, platform: 'YouTube',           audience: '800K+ YouTube', email: null,                                  dmHandle: '@intocryptoverse',        niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Contact via YouTube / website' },
  { id: 'altcoin-daily',      gender: 'male',   name: 'Aaron & Austin Arnold',community: 'Altcoin Daily',         tier: 1, platform: 'YouTube',           audience: '1.3M YouTube',  email: 'contact@altcoindaily.co',            dmHandle: '@AltcoinDailyio',         niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'blockworks',         gender: 'male',   name: 'Jason Yanowitz',     community: 'Blockworks',              tier: 1, platform: 'Media/Podcast',     audience: '500K+',          email: 'jason@blockworks.co',                dmHandle: '@JasonYanowitz',          niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'invest-answers',     gender: 'male',   name: 'James',             community: 'InvestAnswers',            tier: 1, platform: 'YouTube',           audience: '500K+ YouTube', email: 'contact@investanswers.com',           dmHandle: '@investanswers',          niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'datadash',           gender: 'male',   name: 'Nicholas Merten',    community: 'DataDash',                tier: 2, platform: 'YouTube',           audience: '500K YouTube',  email: 'nicholas@datadash.io',               dmHandle: '@Nicholas_Merten',        niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'ivan-on-tech',       gender: 'male',   name: 'Ivan Liljeqvist',    community: 'Ivan on Tech',            tier: 1, platform: 'YouTube/Academy',   audience: '500K+ YouTube', email: 'ivan@ivanontech.com',                dmHandle: '@IvanOnTech',             niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'unchained-podcast',  gender: 'female', name: 'Laura Shin',         community: 'Unchained Podcast',       tier: 1, platform: 'Podcast',           audience: '300K+',          email: 'laura@unchained.com',                dmHandle: '@laurashin',              niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'the-chart-guys',     gender: 'male',   name: 'Dan & Ryan',         community: 'The Chart Guys',          tier: 2, platform: 'YouTube/Community', audience: '300K YouTube',  email: 'contact@thechartguys.com',           dmHandle: '@TheChartGuys',           niche: 'trading',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'gareth-soloway',     gender: 'male',   name: 'Gareth Soloway',     community: 'InTheMoney Stocks',       tier: 2, platform: 'YouTube/Platform',  audience: '200K+',          email: 'gareth@inthemoney.com',              dmHandle: '@GarethSoloway',          niche: 'trading',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'michaelvan-de-poppe',gender: 'male',   name: 'Michaël van de Poppe',community: 'MN Trading',            tier: 1, platform: 'YouTube/Twitter',   audience: '700K+ Twitter', email: 'info@mntrading.io',                  dmHandle: '@CryptoMichNL',           niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'jason-pizzino',      gender: 'male',   name: 'Jason Pizzino',      community: 'Jason Pizzino',           tier: 2, platform: 'YouTube',           audience: '200K YouTube',  email: 'contact@jasonpizzino.com',           dmHandle: '@jasonpizzino',           niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian' },
  { id: 'crypto-zombie',      gender: 'male',   name: 'K-Dub',              community: 'Crypto Zombie',           tier: 2, platform: 'YouTube',           audience: '400K YouTube',  email: null,                                  dmHandle: '@TheCryptoZombie',        niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'plan-b',             gender: 'male',   name: 'PlanB',              community: 'PlanB (S2F Model)',       tier: 1, platform: 'Twitter',           audience: '1.8M Twitter',  email: null,                                  dmHandle: '@100trillionUSD',         niche: 'bitcoin',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'DM on Twitter' },
  { id: 'willy-woo',          gender: 'male',   name: 'Willy Woo',          community: 'Willy Woo On-chain',      tier: 1, platform: 'Twitter/Newsletter',audience: '1M+ Twitter',   email: null,                                  dmHandle: '@woonomic',               niche: 'bitcoin',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'On-chain analytics' },
  { id: 'crypto-tone-vays',   gender: 'male',   name: 'Tone Vays',          community: 'Tone Vays',               tier: 2, platform: 'YouTube/Twitter',   audience: '200K+',          email: 'tone@tonevays.com',                  dmHandle: '@ToneVays',               niche: 'bitcoin',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'crypto-jebb',        gender: 'male',   name: 'Jebb McAfee',        community: 'Crypto Jebb',             tier: 3, platform: 'YouTube',           audience: '100K YouTube',  email: null,                                  dmHandle: '@CryptoJebb',             niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // ── MALE — FOREX / TRADING ────────────────────────────────────────────────
  { id: 'trading-rayner',     gender: 'male',   name: 'Rayner Teo',         community: 'Trading with Rayner',     tier: 1, platform: 'YouTube/Community', audience: '1M+ YouTube',   email: 'rayner@tradingwithrayner.com',        dmHandle: '@RaynerTeo',              niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Huge forex education community' },
  { id: 'nial-fuller',        gender: 'male',   name: 'Nial Fuller',        community: 'Learn to Trade the Market',tier: 2, platform: 'Website/Community',audience: '200K+',          email: 'contact@learntotradethemarket.com',  dmHandle: 'learntotradethemarket.com',niche: 'forex',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'adam-khoo',          gender: 'male',   name: 'Adam Khoo',          community: 'Adam Khoo Wealth Academy',tier: 1, platform: 'YouTube/Academy',   audience: '600K YouTube',  email: 'contact@adamkhoo.com',               dmHandle: '@adamkhoospeaks',         niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'chris-capre',        gender: 'male',   name: 'Chris Capre',        community: '2ndSkies Forex',          tier: 3, platform: 'Website/Community', audience: '50K+',           email: 'chris@2ndskiesforex.com',            dmHandle: '@2ndSkies',               niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'smb-capital',        gender: 'male',   name: 'Mike Bellafiore',    community: 'SMB Capital',             tier: 2, platform: 'YouTube/Training',  audience: '200K+',          email: 'contact@smbcap.com',                 dmHandle: '@smbcapital',             niche: 'trading',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Prop trading firm + education' },
  { id: 'investors-underground',gender: 'male', name: 'Nate Michaud',       community: 'Investors Underground',   tier: 2, platform: 'Community/YouTube', audience: '100K+',          email: 'nate@investorsunderground.com',      dmHandle: '@investorsunder',         niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'options-alpha',       gender: 'male',  name: 'Kirk Du Plessis',    community: 'Options Alpha',           tier: 2, platform: 'Platform/Podcast',  audience: '150K+',          email: 'kirk@optionsalpha.com',              dmHandle: '@OptionsAlpha',           niche: 'options',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'unusual-whales',      gender: 'mixed', name: 'Unusual Whales',     community: 'Unusual Whales',          tier: 1, platform: 'Twitter/Platform',  audience: '500K+ Twitter',  email: 'contact@unusualwhales.com',          dmHandle: '@unusual_whales',         niche: 'options',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'market-rebellion',    gender: 'male',  name: 'Jon & Pete Najarian',community: 'Market Rebellion',        tier: 2, platform: 'Platform/YouTube',  audience: '200K+',          email: 'info@marketrebellion.com',           dmHandle: '@MarketRebellion',        niche: 'options',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'peter-brandt',        gender: 'male',  name: 'Peter Brandt',       community: 'Peter Brandt Trading',    tier: 1, platform: 'Twitter/Newsletter',audience: '700K+ Twitter',  email: 'peter@peterlbrandt.com',             dmHandle: '@PeterLBrandt',           niche: 'commodities',stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Commodities — decades of experience' },
  { id: 'adam-grimes',         gender: 'male',  name: 'Adam Grimes',        community: 'Waverly Advisors',        tier: 3, platform: 'Website/Community', audience: '50K+',           email: 'adam@waverlyadvisors.com',           dmHandle: '@AdamHGrimes',            niche: 'trading',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'forex-peace-army',    gender: 'male',  name: 'Dmitri Chavkerov',   community: 'Forex Peace Army',        tier: 1, platform: 'Community/Website', audience: '2M+ members',   email: 'contact@forexpeacearmy.com',         dmHandle: '@ForexPeaceArmy',         niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Huge forex community' },
  { id: 'babypips',            gender: 'mixed', name: 'BabyPips Team',      community: 'BabyPips',                tier: 1, platform: 'Website/Community', audience: '5M+ members',   email: 'info@babypips.com',                  dmHandle: '@babypips',               niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Biggest forex education site globally' },
  { id: 'forex-factory',       gender: 'mixed', name: 'Forex Factory',      community: 'Forex Factory',           tier: 1, platform: 'Community/Forum',   audience: '10M+ members',  email: 'admin@forexfactory.com',             dmHandle: 'forexfactory.com',        niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'World largest forex community' },
  { id: 'dailyfx',             gender: 'mixed', name: 'DailyFX Team',       community: 'DailyFX',                 tier: 1, platform: 'Media/Community',   audience: '1M+',            email: 'editorial@dailyfx.com',              dmHandle: '@DailyFX',                niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'no-nonsense-forex',   gender: 'male',  name: 'VP (NoNonsenseForex)',community: 'No Nonsense Forex',       tier: 2, platform: 'YouTube/Podcast',   audience: '300K YouTube',  email: null,                                  dmHandle: '@nononsenseforex',        niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'forex-signals',       gender: 'mixed', name: 'Gary Thomson',       community: 'ForexSignals.com',        tier: 2, platform: 'Platform/YouTube',  audience: '200K+',          email: 'support@forexsignals.com',           dmHandle: '@forexsignals',           niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'trade-pro-academy',   gender: 'male',  name: 'Akil Stokes',        community: 'Trade Pro Academy',       tier: 3, platform: 'YouTube/Community', audience: '100K YouTube',  email: 'akil@tradeproacademy.com',           dmHandle: '@AkilStokes',             niche: 'forex',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // ── MALE — STOCKS / INVESTING ─────────────────────────────────────────────
  { id: 'meet-kevin',          gender: 'male',  name: 'Kevin Paffrath',     community: 'Meet Kevin',              tier: 1, platform: 'YouTube',           audience: '2M+ YouTube',   email: null,                                  dmHandle: '@meetkevin',              niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'graham-stephan',      gender: 'male',  name: 'Graham Stephan',     community: 'Graham Stephan',          tier: 1, platform: 'YouTube',           audience: '4M+ YouTube',   email: 'grahamstephanteam@gmail.com',         dmHandle: '@GrahamStephan',          niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'andrei-jikh',         gender: 'male',  name: 'Andrei Jikh',        community: 'Andrei Jikh',             tier: 1, platform: 'YouTube',           audience: '2M+ YouTube',   email: null,                                  dmHandle: '@andrei_jikh',            niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'mark-meldrum',        gender: 'male',  name: 'Mark Meldrum',       community: 'Mark Meldrum Finance',    tier: 2, platform: 'YouTube/Platform',  audience: '300K YouTube',  email: 'mark@markmeldrum.com',               dmHandle: '@markmeldrum',            niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'ticker-symbol-you',   gender: 'male',  name: 'Ticker Symbol: YOU', community: 'Ticker Symbol: YOU',      tier: 2, platform: 'YouTube',           audience: '300K YouTube',  email: null,                                  dmHandle: '@TickerSymbolYOU',        niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'financial-education', gender: 'male',  name: 'Jeremy Lefebvre',    community: 'Financial Education',     tier: 2, platform: 'YouTube',           audience: '600K YouTube',  email: null,                                  dmHandle: '@FinancialEducation',     niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'joseph-carlson',      gender: 'male',  name: 'Joseph Carlson',     community: 'Joseph Carlson Show',     tier: 2, platform: 'YouTube',           audience: '600K YouTube',  email: null,                                  dmHandle: '@josephcarlsonshow',      niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'rask-australia',      gender: 'male',  name: 'Owen Raszkiewicz',   community: 'Rask Australia',          tier: 2, platform: 'Podcast/YouTube',   audience: '200K+',          email: 'owen@rask.com.au',                   dmHandle: '@OwenRask',               niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian — priority' },
  { id: 'motley-fool',         gender: 'mixed', name: 'The Motley Fool',    community: 'Motley Fool Community',   tier: 1, platform: 'Media/Community',   audience: '10M+',           email: 'feedback@fool.com',                  dmHandle: '@TheMotleyFool',          niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // ── MALE — COMMODITIES / MACRO ────────────────────────────────────────────
  { id: 'jim-rogers-community',gender: 'male',  name: 'Jim Rogers',         community: 'Jim Rogers Investors',    tier: 1, platform: 'Media/Newsletter',  audience: 'Global',         email: null,                                  dmHandle: 'jimrogers.com',           niche: 'commodities',stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'kitco-news',          gender: 'mixed', name: 'Kitco News',         community: 'Kitco Community',         tier: 1, platform: 'Media/YouTube',     audience: '1M+ YouTube',   email: 'info@kitco.com',                     dmHandle: '@kitco_news',             niche: 'commodities',stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Gold/silver community' },
  { id: 'trading-economics',  gender: 'mixed',  name: 'Trading Economics',  community: 'Trading Economics',       tier: 1, platform: 'Platform',          audience: '5M+ users',     email: 'info@tradingeconomics.com',           dmHandle: '@tradingeconomics',       niche: 'macro',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'macro-voices',        gender: 'male',  name: 'Erik Townsend',      community: 'MacroVoices',             tier: 2, platform: 'Podcast',           audience: '100K+',          email: 'erik@macrovoices.com',               dmHandle: '@MacroVoices',            niche: 'macro',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'grantham-mayo',       gender: 'male',  name: 'GMO Research',       community: 'GMO Quarterly Letters',   tier: 1, platform: 'Newsletter',        audience: '500K+',          email: 'info@gmo.com',                       dmHandle: 'gmo.com',                 niche: 'macro',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Institutional but newsletter is public' },

  // ── TELEGRAM — LARGE TRADING CHANNELS ────────────────────────────────────
  { id: 'wolf-of-trading',     gender: 'male',  name: 'Wolf of Trading',    community: 'Wolf of Trading',         tier: 1, platform: 'Telegram',          audience: '90K Telegram',  email: null,                                  dmHandle: '@WolfofTradingAdmin',     niche: 'trading',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'bitcoin-bullets',     gender: 'male',  name: 'Bitcoin Bullets',    community: 'Bitcoin Bullets',         tier: 1, platform: 'Telegram',          audience: '106K Telegram', email: null,                                  dmHandle: '@joe1322',                niche: 'bitcoin',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'fat-pig-signals',     gender: 'male',  name: 'Fat Pig Signals',    community: 'Fat Pig Signals',         tier: 2, platform: 'Telegram',          audience: '46K Telegram',  email: null,                                  dmHandle: '@dad10',                  niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'binance-killers',     gender: 'male',  name: 'Binance Killers',    community: 'Binance Killers',         tier: 1, platform: 'Telegram',          audience: '250K+ Telegram',email: null,                                  dmHandle: '@BKCEO',                  niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'elite-crypto',        gender: 'mixed', name: 'Elite Crypto Signals',community: 'Elite Crypto Signals',   tier: 3, platform: 'Discord/Telegram',  audience: '23K Discord',   email: null,                                  dmHandle: 'Discord DM',              niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'axion',               gender: 'mixed', name: 'Axion',              community: 'Axion Discord',           tier: 1, platform: 'Discord',           audience: '88K Discord',   email: null,                                  dmHandle: 'Discord DM',              niche: 'crypto',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // ── AUSTRALIA ─────────────────────────────────────────────────────────────
  { id: 'ausbiz',              gender: 'mixed', name: 'Ausbiz Media',       community: 'Ausbiz',                  tier: 2, platform: 'Media/YouTube',     audience: '100K+',          email: 'info@ausbiz.com.au',                 dmHandle: '@ausbizTV',               niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian business media' },
  { id: 'finance-explained',   gender: 'male',  name: 'Finance Explained',  community: 'Finance Explained',       tier: 3, platform: 'YouTube',           audience: '100K YouTube',  email: null,                                  dmHandle: '@FinanceExplainedAU',     niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian' },
  { id: 'pearler',             gender: 'mixed', name: 'Pearler Invest',     community: 'Pearler Community',       tier: 3, platform: 'App/Community',     audience: '50K+',           email: 'hello@pearler.com',                  dmHandle: '@pearlerinvest',          niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian investing app' },
  { id: 'equity-mates',        gender: 'male',  name: 'Bryce & Ren',        community: 'Equity Mates',            tier: 2, platform: 'Podcast/Community', audience: '100K+',          email: 'hello@equitymates.com',              dmHandle: '@equitymates',            niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian — priority' },
  { id: 'asx-investor',        gender: 'mixed', name: 'ASX Investor Day',   community: 'ASX Investment Community',tier: 2, platform: 'Events/Community',  audience: '200K+',          email: 'info@asx.com.au',                    dmHandle: '@ASX_Online',             niche: 'stocks',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // ── UK ─────────────────────────────────────────────────────────────────────
  { id: 'money-week',          gender: 'mixed', name: 'MoneyWeek',          community: 'MoneyWeek Community',     tier: 2, platform: 'Media/Newsletter',  audience: '200K+',          email: 'editor@moneyweek.com',               dmHandle: '@MoneyWeek',              niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'UK' },
  { id: 'uk-investors',        gender: 'mixed', name: 'UK Investor Magazine',community: 'UK Investor Community',  tier: 3, platform: 'Media',             audience: '50K+',           email: 'info@ukinvestormagazine.co.uk',      dmHandle: '@UKInvestorMag',          niche: 'investing', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'UK' },

];

// ─── State management ────────────────────────────────────────────────────────

export function loadOutreachData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_TARGETS, null, 2));
      return [...INITIAL_TARGETS];
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return [...INITIAL_TARGETS]; }
}

export function saveOutreachData(targets) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(targets, null, 2));
}

export function getTarget(id) {
  return loadOutreachData().find(t => t.id === id) || null;
}

export function updateTarget(id, updates) {
  const targets = loadOutreachData();
  const idx = targets.findIndex(t => t.id === id);
  if (idx === -1) return false;
  targets[idx] = { ...targets[idx], ...updates };
  saveOutreachData(targets);
  return true;
}

// ─── CSV bulk import ─────────────────────────────────────────────────────────
// Format: id,name,community,tier,platform,audience,email,dmHandle,niche,gender
// Anna can drop a CSV at data/outreach-import.csv and run /admin outreach import

export function importFromCSV(csvPath) {
  if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
  const lines  = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const targets = loadOutreachData();
  const existing = new Set(targets.map(t => t.id));
  let added = 0; let skipped = 0;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const row  = {};
    header.forEach((h, i) => row[h] = cols[i] || null);

    const id = row.id || row.name?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `import-${Date.now()}-${added}`;
    if (existing.has(id)) { skipped++; continue; }

    targets.push({
      id,
      gender:       row.gender || 'unknown',
      name:         row.name || 'Unknown',
      community:    row.community || row.name || 'Unknown',
      tier:         parseInt(row.tier) || 3,
      platform:     row.platform || 'Unknown',
      audience:     row.audience || 'Unknown',
      email:        row.email && row.email.includes('@') ? row.email : null,
      dmHandle:     row.dmhandle || row.handle || null,
      niche:        row.niche || 'trading',
      stage:        0,
      emailSentAt:  null,
      followupSentAt: null,
      replied:      false,
      notes:        row.notes || '',
    });
    existing.add(id);
    added++;
  }

  saveOutreachData(targets);
  return { added, skipped, total: targets.length };
}

// ─── Gender-aware email templates ────────────────────────────────────────────

function isMale(target) {
  return target.gender === 'male';
}

function buildColdEmailHtml(target) {
  const male = isMale(target);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><div class="logo">The Edge Index</div></div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>I've been following ${target.community} — genuinely impressive what you've built.</p>
      ${male ? `
      <p>One thing separates the traders who consistently outperform from those who don't — and it's not strategy. Strategy is table stakes. What the best traders have is timing clarity: they know when their judgment is operating at its sharpest and when emotional noise is highest. Most traders never map this. They run the same process in every condition and wonder why results are inconsistent.</p>
      <p>I built The Edge Index to solve that. It's a personalised report and platform that maps each person's individual decision-timing patterns for the next 12 months — when to be aggressive, when to step back, and exactly which windows are highest risk. Not a market signal. A map of the person running the strategy.</p>
      ` : `
      <p>Right now the pressure on people financially is unlike anything we've seen in a long time. Rates are up. Petrol, food, everything costs more. The geopolitical situation is feeding straight into cost of living — and the stakes of every financial decision have never felt higher.</p>
      <p>On top of that, the people in your community carry a weight that rarely gets talked about in trading spaces — the background hum of financial anxiety that never fully switches off. Worrying whether it's enough. Whether the decisions they're making now will hold. That stress doesn't stay out of the market — it sits behind every trade, every entry, every time they hesitate or second-guess a position they know is right. Most of them blame themselves for it. The reality is it's timing — and it follows a pattern specific to each person.</p>
      <p>I built The Edge Index for exactly this — a personalised report and platform designed to give every trader their personal edge. Not a generic signal. Not a market forecast. A map of <em>them</em> — so they know when to back themselves and when to step back, in any market condition.</p>
      `}
      <p>I'd love to send you a complimentary one. No strings attached — it takes two minutes, and you'll have the full report in your inbox within the hour.</p>
      <p>Would you be open to it?</p>
      <p><a href="https://t.me/TheEdgeIndexBot" class="cta">Get Your Free Report →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildFollowUpEmailHtml(target) {
  const male = isMale(target);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><div class="logo">The Edge Index</div></div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>Just following up on my note from a few days ago.</p>
      ${male ? `
      <p>With markets reacting to every geopolitical headline and volatility staying elevated — the traders who come out ahead won't just have the best strategy. They'll know themselves well enough to execute it clearly when conditions are hardest. The Edge Index maps exactly that window for each individual.</p>
      <p>Several traders I've sent this to have called it the missing piece — the one thing that finally explained why the same setup worked in some months and failed in others.</p>
      ` : `
      <p>With everything happening in the world right now — rates rising, cost of living squeezing harder, markets reacting to every geopolitical headline — the people who come out ahead won't just have the best strategy. They'll know themselves well enough to execute it clearly when the pressure is highest.</p>
      <p>The people I've sent this report to say the same thing: they already knew their strategy — what they didn't have was a map of themselves. One said it was the first time they stopped feeling like the problem.</p>
      `}
      <p>I'd love to send you yours — just two minutes to get your details across.</p>
      <p><a href="https://t.me/TheEdgeIndexBot" class="cta">Get Your Free Report →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildPostReportEmailHtml(target) {
  const male = isMale(target);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .highlight { background: #1a1a0e; border-left: 3px solid #c9a84c; padding: 16px 20px; margin: 20px 0; font-size: 15px; color: #c9a84c; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><div class="logo">The Edge Index</div></div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>I hope your Edge Index Brief landed well — I'd love to know what you took from it.</p>
      <p>I want to be direct about why I reached out specifically.</p>
      ${male ? `
      <p>The people in ${target.community} trust your judgment. They're there because you've shown them something real. What you just experienced in your report — every person in your community could have their own version. Their own timing map. Their own clarity on when to push and when to protect.</p>
      <p>In a market environment driven by geopolitical volatility, rate uncertainty, and constant headline noise — the edge isn't a better indicator. It's a clearer operator. That's what The Edge Index gives each person: a personalised map of when their decision-making is sharpest and when it's most at risk.</p>
      ` : `
      <p>The people in ${target.community} trust you. They follow you because you've shown them something real. Right now — with cost of living crushing people, geopolitical instability driving up the price of everything, and a level of financial anxiety most of us haven't felt in our lifetimes — the people in your community are scared. Not just about their trades. About their future. Their children's future.</p>
      <p>What you just experienced in your report is a map. That map is what every person in your community needs right now — not as a luxury, but as protection. So they stop second-guessing themselves at exactly the wrong moment. So they stop losing money in windows that were always going to be hard for them specifically.</p>
      `}
      <p>You have the ability to give every one of them that.</p>
      <div class="highlight">
        Founding community licence: <strong>$500/month</strong> (standard rate: $2,500/month)<br><br>
        Every member of ${target.community} gets their own personalised 12-month Edge Index Brief. Their own map. Their own edge.
      </div>
      <p>${male ? 'This is what great community leaders do — they bring their people a genuine advantage.' : 'This is what community leaders do in a crisis — they bring their people something that actually helps.'} Would you be open to a quick call this week?</p>
      <p><a href="mailto:anna@annamassie.com.au" class="cta">Reply to Book a Call →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildPostReportNudgeHtml(target) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><div class="logo">The Edge Index</div></div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>Just a final note from me.</p>
      <p>I only have three founding community licences available at the $500/month rate. The people who move on this early are the ones whose communities will have the clearest edge going into the rest of the year — when markets stay uncertain and every decision carries more weight.</p>
      <p>If now isn't the right moment, no problem at all. But if you want to talk through what it would look like for your community — even just 15 minutes — I'm here.</p>
      <p><a href="mailto:anna@annamassie.com.au" class="cta">Let's Talk →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── Resend email sender ─────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
  if (!to) throw new Error('No email address for this target');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Resend error (${res.status}): ${err}`); }
  return res.json();
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function sendColdEmail(targetId) {
  const targets = loadOutreachData();
  const target  = targets.find(t => t.id === targetId);
  if (!target)           throw new Error(`Target not found: ${targetId}`);
  if (!target.email)     throw new Error(`No email for ${target.name} — DM: ${target.dmHandle}`);
  if (target.stage >= 1) throw new Error(`Already contacted: stage ${target.stage}`);
  await sendEmail(target.email, `Complimentary Edge Index Brief for you`, buildColdEmailHtml(target));
  addPaidEmail(target.email); // Whitelist — bypasses payment gate
  updateTarget(targetId, { stage: 1, emailSentAt: new Date().toISOString() });
  return target;
}

export async function sendFollowUp(targetId) {
  const target = getTarget(targetId);
  if (!target)           throw new Error(`Target not found: ${targetId}`);
  if (!target.email)     throw new Error(`No email for ${target.name}`);
  if (target.replied)    throw new Error(`${target.name} already replied`);
  if (target.stage !== 1) throw new Error(`Needs stage 1 first`);
  await sendEmail(target.email, `Re: Complimentary Edge Index Brief`, buildFollowUpEmailHtml(target));
  updateTarget(targetId, { stage: 2, followupSentAt: new Date().toISOString() });
  return target;
}

export function markReportReceived(email) {
  const targets = loadOutreachData();
  const target  = targets.find(t => t.email?.toLowerCase() === email?.toLowerCase());
  if (!target) return false;
  updateTarget(target.id, { reportReceivedAt: new Date().toISOString() });
  return target;
}

export function markReplied(targetId, notes = '') {
  const target = getTarget(targetId);
  if (!target) return false;
  updateTarget(targetId, { replied: true, notes: notes || target.notes });
  return true;
}

export async function runDailyFollowUpSweep() {
  const targets    = loadOutreachData();
  const now        = Date.now();
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const results    = [];
  for (const t of targets) {
    if (t.stage !== 1 || t.replied || !t.email || !t.emailSentAt) continue;
    if (now - new Date(t.emailSentAt).getTime() >= THREE_DAYS) {
      try   { await sendFollowUp(t.id); results.push({ target: t, status: 'sent' }); }
      catch (e) { results.push({ target: t, status: 'error', error: e.message }); }
    }
  }
  return results;
}

export async function runDailyLicensingSweep() {
  const targets   = loadOutreachData();
  const now       = Date.now();
  const ONE_DAY   = 24 * 60 * 60 * 1000;
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
  const results   = [];
  for (const t of targets) {
    if (!t.email || !t.reportReceivedAt || t.replied) continue;
    const elapsed = now - new Date(t.reportReceivedAt).getTime();
    if (elapsed >= ONE_DAY && !t.licensingPitchSentAt) {
      try {
        await sendEmail(t.email, `Your Edge Index Brief — and what's possible for ${t.community}`, buildPostReportEmailHtml(t));
        updateTarget(t.id, { licensingPitchSentAt: new Date().toISOString() });
        results.push({ target: t, status: 'pitch_sent' });
      } catch (e) { results.push({ target: t, status: 'error', error: e.message }); }
    }
    if (elapsed >= ONE_DAY + FIVE_DAYS && t.licensingPitchSentAt && !t.nudgeSentAt) {
      try {
        await sendEmail(t.email, `Re: Edge Index community licence — last note`, buildPostReportNudgeHtml(t));
        updateTarget(t.id, { nudgeSentAt: new Date().toISOString() });
        results.push({ target: t, status: 'nudge_sent' });
      } catch (e) { results.push({ target: t, status: 'error', error: e.message }); }
    }
  }
  return results;
}

export function getOutreachStats() {
  const targets  = loadOutreachData();
  const byStage  = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const byGender = { male: 0, female: 0, mixed: 0, unknown: 0 };
  const byTier   = {};
  let replied = 0; let hasEmail = 0;
  for (const t of targets) {
    byStage[t.stage]  = (byStage[t.stage]  || 0) + 1;
    byGender[t.gender]= (byGender[t.gender]|| 0) + 1;
    byTier[t.tier]    = (byTier[t.tier]    || 0) + 1;
    if (t.replied) replied++;
    if (t.email)   hasEmail++;
  }
  return { total: targets.length, byStage, byGender, byTier, replied, hasEmail };
}

export function getTierTargets(tier) {
  return loadOutreachData().filter(t => t.tier === tier && t.stage === 0 && t.email);
}

export function getReadyTargets() {
  return loadOutreachData().filter(t => t.stage === 0 && t.email);
}
