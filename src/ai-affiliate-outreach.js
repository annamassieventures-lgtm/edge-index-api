/**
 * ai-affiliate-outreach.js
 * The Edge Index — AI Influencer Affiliate Track (US-focused)
 *
 * COMPLETELY SEPARATE from community-outreach.js (trading licensing track).
 * Never mention licensing or monthly fees to these targets.
 * Never mention affiliate model to trading community leaders.
 *
 * Angle: AI influencers talk software/productivity. Nobody is connecting AI
 * to the physical commodities trade it's creating — copper, rare earths,
 * electricity infrastructure, uranium, water. The Edge Index maps the timing.
 *
 * Model: 25% affiliate commission = $625 per $2,500 sale.
 * Sequence: cold email → follow-up (3d) → affiliate pitch (24h after report) → nudge (5d)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addPaidEmail } from './shared/paidUsers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE  = path.join(__dirname, '../data/ai-affiliate-outreach.json');
const FROM_EMAIL = 'The Edge Index <reports@edgeindex.io>';
const WHOP_PRODUCT_URL   = 'https://whop.com/the-edge-index/the-edge-index-brief';
const WHOP_AFFILIATE_URL = 'https://whop.com/the-edge-index/the-edge-index-brief/?affiliate=true';
const BOT_URL = 'https://t.me/TheEdgeIndexBot';

// ─── TARGET LIST ─────────────────────────────────────────────────────────────
// US AI influencers — affiliate model only, never licensing
// gender: 'male' | 'female' | 'mixed'
// stage: 0=not contacted, 1=cold sent, 2=follow-up sent, 3=affiliate pitch sent, 4=done

const INITIAL_TARGETS = [
  // ── TIER 1 ── High-reach US AI creators ──────────────────────────────────
  { id: 'matt-wolfe',       gender: 'male',   name: 'Matt Wolfe',       community: 'Future Tools',           tier: 1, platform: 'YouTube/Newsletter', audience: '500K+',   email: 'matt@futuretools.io',         dmHandle: '@mreflow',          niche: 'ai-tools',     stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Largest AI tools newsletter' },
  { id: 'lex-fridman',      gender: 'male',   name: 'Lex Fridman',      community: 'Lex Fridman Podcast',    tier: 1, platform: 'YouTube/Podcast',    audience: '4M+',     email: null,                          dmHandle: '@lexfridman',       niche: 'ai-research',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Massive reach, AI + tech' },
  { id: 'allie-k-miller',   gender: 'female', name: 'Allie K. Miller',  community: 'Allie K. Miller',        tier: 1, platform: 'LinkedIn/Newsletter', audience: '400K+',   email: 'allie@alliekmiller.com',      dmHandle: '@alliekmiller',     niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Top female AI voice' },
  { id: 'greg-isenberg',    gender: 'male',   name: 'Greg Isenberg',    community: 'Late Checkout',          tier: 1, platform: 'X/YouTube',          audience: '500K+',   email: null,                          dmHandle: '@gregisenberg',     niche: 'ai-startup',   stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Huge AI/startup audience' },
  { id: 'liam-ottley',      gender: 'male',   name: 'Liam Ottley',      community: 'Liam Ottley',            tier: 1, platform: 'YouTube',            audience: '300K+',   email: null,                          dmHandle: '@liamottley',       niche: 'ai-automation',stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'AI automation, young audience' },
  { id: 'wes-roth',         gender: 'male',   name: 'Wes Roth',         community: 'Wes Roth',               tier: 1, platform: 'YouTube',            audience: '400K+',   email: null,                          dmHandle: '@wes_roth',         niche: 'ai-tools',     stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Deep AI tool reviews' },
  { id: 'ai-jason',         gender: 'male',   name: 'Jason West',       community: 'AI Jason',               tier: 1, platform: 'YouTube/X',          audience: '250K+',   email: null,                          dmHandle: '@ai_jason',         niche: 'ai-tools',     stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'AI tools + automation' },
  { id: 'tina-huang',       gender: 'female', name: 'Tina Huang',       community: 'Tina Huang',             tier: 1, platform: 'YouTube',            audience: '600K+',   email: null,                          dmHandle: '@tina_huang_',      niche: 'ai-data',      stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Data science / AI creator' },
  { id: 'sam-parr',         gender: 'male',   name: 'Sam Parr',         community: 'My First Million',       tier: 1, platform: 'Podcast/X',          audience: '1M+',     email: 'sam@thehustle.co',            dmHandle: '@theSamParr',       niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Business + AI, massive podcast' },
  { id: 'shaan-puri',       gender: 'male',   name: 'Shaan Puri',       community: 'My First Million',       tier: 1, platform: 'Podcast/X',          audience: '1M+',     email: 'puri.shaan@gmail.com',        dmHandle: '@ShaanVP',          niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Co-host, huge X following' },
  { id: 'corbin-brown',     gender: 'male',   name: 'Corbin Brown',     community: 'Corbin AI',              tier: 1, platform: 'YouTube',            audience: '200K+',   email: null,                          dmHandle: '@corbinai',         niche: 'ai-tools',     stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'AI tools reviews' },
  { id: 'nick-saraev',      gender: 'male',   name: 'Nick Saraev',      community: 'Nick Saraev',            tier: 1, platform: 'YouTube/Newsletter', audience: '150K+',   email: null,                          dmHandle: '@nicksaraev',       niche: 'ai-automation',stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'AI automation agency builder' },
  { id: 'rachel-woods',     gender: 'female', name: 'Rachel Woods',     community: 'Rachel Woods AI',        tier: 1, platform: 'TikTok/YouTube',     audience: '300K+',   email: null,                          dmHandle: '@rachelwoods_ai',   niche: 'ai-tools',     stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Female AI tools creator' },
  { id: 'dave-shapiro',     gender: 'male',   name: 'Dave Shapiro',     community: 'Dave Shapiro',           tier: 1, platform: 'YouTube',            audience: '150K+',   email: null,                          dmHandle: '@daveshap',         niche: 'ai-future',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'AI futures / alignment' },
  { id: 'ben-tossell',      gender: 'male',   name: 'Ben Tossell',      community: "Ben's Bites",            tier: 1, platform: 'Newsletter',         audience: '100K+',   email: 'ben@bensbites.co',            dmHandle: '@bentossell',       niche: 'ai-news',      stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Top AI daily newsletter' },
  { id: 'ethan-mollick',    gender: 'male',   name: 'Ethan Mollick',    community: 'One Useful Thing',       tier: 1, platform: 'Newsletter/X',       audience: '400K+',   email: 'emollick@wharton.upenn.edu',  dmHandle: '@emollick',         niche: 'ai-education', stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Wharton prof, AI education' },

  // ── TIER 1 ── USA additions from research ────────────────────────────────
  { id: 'nicolas-boucher',  gender: 'male',   name: 'Nicolas Boucher',  community: 'AI Finance Club',        tier: 1, platform: 'LinkedIn/Newsletter', audience: '1M+',     email: null,                          dmHandle: '@nicolasboucher_',  niche: 'ai-finance',   stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Ex-CFO, AI + finance, PERFECT FIT — 1M LinkedIn' },
  { id: 'cleo-abram',       gender: 'female', name: 'Cleo Abram',       community: 'Huge If True',           tier: 1, platform: 'YouTube',            audience: '900K+',   email: 'cleoabram@gmail.com',         dmHandle: '@cleoabram',        niche: 'ai-future',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Science/future/AI YouTube, young female audience' },
  { id: 'gary-vaynerchuk',  gender: 'male',   name: 'Gary Vaynerchuk',  community: 'GaryVee',                tier: 1, platform: 'YouTube/X/Podcast',  audience: '10M+',    email: 'gvaynerchuk@gmail.com',       dmHandle: '@garyvee',          niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Massive business audience, covers AI heavily' },
  { id: 'mario-nawfal',     gender: 'male',   name: 'Mario Nawfal',     community: 'Mario Nawfal',           tier: 1, platform: 'X Spaces',           audience: '2M+',     email: null,                          dmHandle: '@MarioNawfal',      niche: 'ai-tech',      stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Dubai-based, X Spaces host, huge crypto/AI/tech reach' },
  { id: 'nathan-lands',     gender: 'male',   name: 'Nathan Lands',     community: 'The Next Wave',          tier: 1, platform: 'Podcast/Newsletter', audience: '300K+',   email: null,                          dmHandle: '@NathanLands',      niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Co-hosts The Next Wave with Matt Wolfe' },
  { id: 'justine-moore',    gender: 'female', name: 'Justine Moore',    community: 'Justine Moore',          tier: 1, platform: 'X/LinkedIn',         audience: '200K+',   email: 'jmoore@a16z.com',             dmHandle: '@venturetwins',     niche: 'ai-investing', stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'a16z partner, AI investing angle' },

  // ── TIER 1 ── UK/London ──────────────────────────────────────────────────
  { id: 'steven-bartlett',  gender: 'male',   name: 'Steven Bartlett',  community: 'Diary of a CEO',         tier: 1, platform: 'YouTube/Podcast',    audience: '4M+',     email: null,                          dmHandle: '@SteveBartlettSC',  niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UK, biggest business podcast, covers AI + investing heavily — huge USD audience' },
  { id: 'ali-abdaal',       gender: 'male',   name: 'Ali Abdaal',       community: 'Ali Abdaal',             tier: 1, platform: 'YouTube/Newsletter', audience: '5M+',     email: null,                          dmHandle: '@aliabdaal',        niche: 'ai-productivity',stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UK doctor turned creator, 5M YouTube, AI productivity + wealth building' },
  { id: 'mark-tilbury',     gender: 'male',   name: 'Mark Tilbury',     community: 'Mark Tilbury',           tier: 1, platform: 'YouTube/TikTok',     audience: '3M+',     email: 'mark@marktilbury.com',        dmHandle: '@marktilbury_',     niche: 'ai-finance',   stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UK, personal finance + investing + business strategy YouTube, 3M+ subs' },

  // ── TIER 1 ── Singapore ───────────────────────────────────────────────────
  { id: 'ayesha-khanna',    gender: 'female', name: 'Dr. Ayesha Khanna',community: 'Addo AI',                tier: 1, platform: 'LinkedIn/Speaking',  audience: '300K+',   email: 'ayesha@addo.ai',              dmHandle: '@ayeshaakhanna',    niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Singapore, CEO Addo AI, Forbes Female Entrepreneur, LinkedIn Top Voice' },
  { id: 'anson-zeall',      gender: 'male',   name: 'Anson Zeall',      community: 'Anson Zeall',            tier: 1, platform: 'YouTube/LinkedIn',   audience: '100K+',   email: null,                          dmHandle: '@ansonzeall',       niche: 'ai-crypto',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Singapore, blockchain/AI/Web3, USD audience' },

  // ── TIER 1 ── Dubai/UAE ───────────────────────────────────────────────────
  { id: 'eva-zuk',          gender: 'female', name: 'Eva Zuk',          community: 'Eva Zuk',                tier: 1, platform: 'Instagram/YouTube',  audience: '200K+',   email: null,                          dmHandle: '@evazuk_',          niche: 'ai-wealth',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Dubai, luxury property + wealth/financial independence for women — perfect fit' },
  { id: 'shadi-dawi',       gender: 'male',   name: 'Shadi Dawi',       community: 'Shadi Dawi',             tier: 1, platform: 'LinkedIn/YouTube',   audience: '150K+',   email: null,                          dmHandle: '@shadiDawi',        niche: 'ai-marketing', stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Dubai, AI for marketing/business' },

  // ── TIER 2 ── Strong US AI creators ─────────────────────────────────────
  { id: 'futurepedia-riley',gender: 'male',   name: 'Riley Brown',      community: 'Futurepedia',            tier: 2, platform: 'YouTube/Newsletter', audience: '200K+',   email: null,                          dmHandle: '@rileybrown_ai',    niche: 'ai-tools',     stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: '' },
  { id: 'jaeden-bartlett',  gender: 'male',   name: 'Jaeden Bartlett',  community: 'Jaeden Bartlett',        tier: 2, platform: 'YouTube',            audience: '120K+',   email: null,                          dmHandle: '@jaedenb',          niche: 'ai-automation',stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: '' },
  { id: 'cassie-kozyrkov',  gender: 'female', name: 'Cassie Kozyrkov',  community: 'Cassie Kozyrkov',        tier: 2, platform: 'LinkedIn/YouTube',   audience: '200K+',   email: null,                          dmHandle: '@quaesita',         niche: 'ai-data',      stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Ex-Google, AI decision intelligence' },
  { id: 'siraj-raval',      gender: 'male',   name: 'Siraj Raval',      community: 'Siraj Raval',            tier: 2, platform: 'YouTube',            audience: '800K+',   email: null,                          dmHandle: '@sirajraval',       niche: 'ai-education', stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: '' },
  { id: 'ai-explained',     gender: 'male',   name: 'AI Explained',     community: 'AI Explained',           tier: 2, platform: 'YouTube',            audience: '600K+',   email: null,                          dmHandle: '@aiexplained_',     niche: 'ai-research',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: '' },
  { id: 'two-minute-papers',gender: 'male',   name: 'Károly Zsolnai-Fehér', community: 'Two Minute Papers', tier: 2, platform: 'YouTube',            audience: '1.3M+',   email: null,                          dmHandle: '@karoly_zf',        niche: 'ai-research',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: '' },
  { id: 'frank-kern-ai',    gender: 'male',   name: 'Frank Kern',       community: 'Frank Kern',             tier: 2, platform: 'YouTube/Email',      audience: '300K+',   email: 'frank@frankkern.com',         dmHandle: '@frankkerndotcom',  niche: 'ai-marketing', stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'AI marketing audience' },
  { id: 'the-rundown-ai',   gender: 'male',   name: 'Rowan Cheung',     community: 'The Rundown AI',         tier: 2, platform: 'Newsletter',         audience: '600K+',   email: null,                          dmHandle: '@rowancheung_',     niche: 'ai-news',      stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Daily AI newsletter' },
  { id: 'aarthi-ramamurthy',gender: 'female', name: 'Aarthi Ramamurthy',community: 'The Good Time Show',    tier: 2, platform: 'Podcast/X',          audience: '100K+',   email: 'aarthi.ramamurthy@gmail.com', dmHandle: '@aarthir',          niche: 'ai-tech',      stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Female tech/AI voice' },
  { id: 'sara-gorin',       gender: 'female', name: 'Sara Gorin',       community: 'Sara Gorin AI',          tier: 2, platform: 'LinkedIn/TikTok',    audience: '150K+',   email: null,                          dmHandle: '@saragorin',        niche: 'ai-tools',     stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: '' },
  { id: 'peter-diamandis',  gender: 'male',   name: 'Peter Diamandis',  community: 'Peter Diamandis',        tier: 2, platform: 'Newsletter/X',       audience: '500K+',   email: null,                          dmHandle: '@PeterDiamandis',   niche: 'ai-future',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Abundance / tech future' },
  { id: 'gary-marcus',      gender: 'male',   name: 'Gary Marcus',      community: 'Gary Marcus',            tier: 2, platform: 'Newsletter/X',       audience: '200K+',   email: null,                          dmHandle: '@GaryMarcus',       niche: 'ai-research',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: '' },
  { id: 'andrej-karpathy',  gender: 'male',   name: 'Andrej Karpathy',  community: 'Andrej Karpathy',        tier: 2, platform: 'X/YouTube',          audience: '800K+',   email: 'andrej.karpathy@gmail.com',   dmHandle: '@karpathy',         niche: 'ai-research',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Ex-Tesla/OpenAI, very technical' },

  // ── TIER 2 ── USA additions ───────────────────────────────────────────────
  { id: 'bernard-marr',     gender: 'male',   name: 'Bernard Marr',     community: 'Bernard Marr',           tier: 2, platform: 'LinkedIn/Forbes',    audience: '2M+',     email: null,                          dmHandle: '@BernardMarr',      niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Forbes contributor, AI business strategy' },
  { id: 'amy-webb',         gender: 'female', name: 'Amy Webb',         community: 'Future Today Institute', tier: 2, platform: 'LinkedIn/Speaking',  audience: '200K+',   email: null,                          dmHandle: '@amywebb',          niche: 'ai-future',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'USA, futurist, annual AI tech trends report' },
  { id: 'oana-labes',       gender: 'female', name: 'Oana Labes',       community: 'Oana Labes',             tier: 2, platform: 'LinkedIn',           audience: '300K+',   email: null,                          dmHandle: '@OanaLabes',        niche: 'ai-finance',   stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'LinkedIn top voice in finance, infographics audience' },
  { id: 'sandra-kublik',    gender: 'female', name: 'Sandra Kublik',    community: 'Sandra Kublik',          tier: 2, platform: 'LinkedIn/Speaking',  audience: '100K+',   email: null,                          dmHandle: '@SandraKublik',     niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'AI business consultant/speaker' },
  { id: 'katie-king',       gender: 'female', name: 'Katie King',       community: 'AI in Business',         tier: 2, platform: 'LinkedIn/Speaking',  audience: '150K+',   email: null,                          dmHandle: '@KatieKingAI',      niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'CEO AI in Business, BBC commentator, WEF contributor' },
  { id: 'ronald-van-loon',  gender: 'male',   name: 'Ronald van Loon',  community: 'Ronald van Loon',        tier: 2, platform: 'LinkedIn/YouTube',   audience: '500K+',   email: null,                          dmHandle: '@Ronald_vanLoon',   niche: 'ai-data',      stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Top LinkedIn AI/data influencer' },

  // ── TIER 2 ── Singapore additions ────────────────────────────────────────
  { id: 'sopnendu-mohanty', gender: 'male',   name: 'Sopnendu Mohanty', community: 'MAS Fintech',            tier: 2, platform: 'LinkedIn/Speaking',  audience: '100K+',   email: 'namysop@me.com',              dmHandle: '@SopnenduMohanty',  niche: 'ai-finance',   stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Singapore, Chief Fintech Officer MAS, regulatory AI+finance influence' },
  { id: 'chris-chong-sg',   gender: 'male',   name: 'Chris Chong',      community: 'Chris Chong',            tier: 2, platform: 'YouTube',            audience: '50K+',    email: null,                          dmHandle: '@chrischongsg',     niche: 'ai-finance',   stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Singapore, FIRE/finance YouTube, smaller but engaged' },

  // ── TIER 2 ── Dubai/UAE additions ─────────────────────────────────────────
  { id: 'khalid-al-ameri',  gender: 'male',   name: 'Khalid Al Ameri',  community: 'Khalid Al Ameri',        tier: 2, platform: 'YouTube/Instagram',  audience: '3M+',     email: null,                          dmHandle: '@khalid_alAmeri',   niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Dubai/UAE, massive lifestyle+business audience, covers future/tech' },
  { id: 'peng-t',           gender: 'male',   name: 'Peng T',           community: 'Crypto Banter',          tier: 2, platform: 'YouTube/X',          audience: '500K+',   email: null,                          dmHandle: '@pengT_',           niche: 'ai-crypto',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Dubai-based, crypto/AI/trading crossover audience' },
  { id: 'omar-shaikh',      gender: 'male',   name: 'Omar Shaikh',      community: 'Omar Shaikh',            tier: 2, platform: 'Instagram/YouTube',  audience: '500K+',   email: null,                          dmHandle: '@omarshaikhofficial',niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Dubai, entrepreneurship/wealth/business, USD-comfortable audience' },
  { id: 'talal-hasan',      gender: 'male',   name: 'Talal Hasan',      community: 'Talal Hasan',            tier: 2, platform: 'YouTube/LinkedIn',   audience: '200K+',   email: null,                          dmHandle: '@TalalHasanAI',     niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UAE/Gulf, AI for business, Arabic + English audience' },

  // ── TIER 2 ── UK additions ────────────────────────────────────────────────
  { id: 'james-jani',       gender: 'male',   name: 'James Jani',       community: 'James Jani',             tier: 2, platform: 'YouTube',            audience: '1M+',     email: null,                          dmHandle: '@jamesjani',        niche: 'ai-finance',   stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UK, documentary finance YouTube, research-heavy investing content' },
  { id: 'hamish-hodder',    gender: 'male',   name: 'Hamish Hodder',    community: 'Hamish Hodder',          tier: 2, platform: 'YouTube',            audience: '500K+',   email: null,                          dmHandle: '@hamishhodder',     niche: 'ai-investing', stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UK, investing YouTube, ETFs/stocks/finance audience' },
  { id: 'tobi-lutke-ai',    gender: 'male',   name: 'Simon Squibb',     community: 'Simon Squibb',           tier: 2, platform: 'YouTube/TikTok',     audience: '2M+',     email: null,                          dmHandle: '@simonsquibb',      niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UK, entrepreneur/startup/business content, massive TikTok' },
  { id: 'nuseir-yassin',    gender: 'male',   name: 'Nuseir Yassin',    community: 'Nas Daily',              tier: 2, platform: 'YouTube/Facebook',   audience: '20M+',    email: null,                          dmHandle: '@nasdaily',         niche: 'ai-future',    stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'Israel/Dubai-based, global storytelling, massive reach, covers AI/future/money' },
  { id: 'rania-anderson',   gender: 'female', name: 'Rania Anderson',   community: 'The Way Women Work',     tier: 2, platform: 'LinkedIn/Speaking',  audience: '100K+',   email: null,                          dmHandle: '@RaniaAnderson',    niche: 'ai-business',  stage: 0, emailSentAt: null, followupSentAt: null, reportReceivedAt: null, affiliatePitchSentAt: null, replied: false, notes: 'UK/global, women in leadership + investing, female audience' },
];

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_TARGETS, null, 2));
    return [...INITIAL_TARGETS];
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(targets) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(targets, null, 2));
}

function updateTarget(id, fields) {
  const targets = loadData();
  const idx = targets.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`Target not found: ${id}`);
  targets[idx] = { ...targets[idx], ...fields };
  saveData(targets);
}

function isMale(target) {
  return target.gender === 'male';
}

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────

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
      <p>I've been following ${target.community} — what you've built is genuinely impressive.</p>
      ${male ? `
      <p>Everyone in AI right now is talking about the software opportunity — and they're right. But there's a physical world trade running underneath it that almost nobody in your space is covering. The infrastructure buildout for AI requires enormous amounts of copper, rare earths, uranium, and electricity capacity. Data centres are being converted into electricity hubs globally. The commodities supercycle this is creating is one of the biggest macro trades of the decade — and your audience has no timing tool for when to position into it.</p>
      <p>That's what The Edge Index does. It's a personalised 12-month intelligence report that maps each person's individual decision-timing windows — when their judgment is sharpest, when risk is highest, when to move and when to hold. Built for the investor who already understands the thesis and just needs to know their personal window for execution.</p>
      ` : `
      <p>The conversation in AI right now is almost entirely about software — tools, productivity, automation. But underneath it, there's a physical world story that nobody is telling your audience. The infrastructure powering AI requires copper, rare earths, uranium, electricity on a scale we've never seen. Companies like Firmus are building entire electricity hubs to power it. The commodities trade connected to AI is one of the biggest financial opportunities of this decade — and the women in your audience are in the perfect position to see it early, if they know when to move.</p>
      <p>That's exactly what The Edge Index maps — a personalised 12-month intelligence report for each person, showing their individual timing windows. When their decision-making is clearest. When to act and when to wait. Not a market signal — a map of them, applied to any market condition.</p>
      `}
      <p>I'd like to send you a complimentary report — no strings, two minutes to set up, your full brief in your inbox within the hour.</p>
      <p>Would you be open to it?</p>
      <p><a href="${BOT_URL}" class="cta">Get Your Free Report →</a></p>
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
      <p>The commodities angle on AI infrastructure isn't going away — it's accelerating. Electricity demand from AI data centres is now one of the fastest-growing drivers of energy investment globally. Copper, uranium, rare earths — these aren't side stories. They're the foundation of everything your audience is building on top of. The window to position intelligently is now, and the Edge Index tells each person exactly when that window is open for them specifically.</p>
      ` : `
      <p>The physical infrastructure story behind AI is moving fast — electricity hubs, data centre conversions, commodity supply chains under pressure globally. The women in your audience who see this early and know when to move will look back on this as one of the clearest opportunities of their lifetime. The Edge Index maps that timing individually, so the decision isn't guesswork.</p>
      `}
      <p>The complimentary report is still available for you. Two minutes, and you'll have a full 12-month brief in your inbox.</p>
      <p><a href="${BOT_URL}" class="cta">Claim Your Free Report →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildAffiliatePitchHtml(target) {
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
    .highlight { background: #1a1a1a; border-left: 3px solid #c9a84c; padding: 16px 20px; margin: 24px 0; }
    .highlight p { margin: 0; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><div class="logo">The Edge Index</div></div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>Hope the report landed well — I'd love to know what you made of it.</p>
      ${male ? `
      <p>What you just experienced is a timing map built specifically for you. Every person in ${target.community} could have their own version — their own 12-month window for when to execute on the commodity thesis, when to be aggressive, when risk is highest for them specifically.</p>
      <p>Here's something worth knowing: we run a 25% affiliate programme. The report retails at $2,500 USD. One referral from your audience earns you <strong>$625</strong>. If 10 people from ${target.community} buy through your link in the next month, that's $6,250 — from one post or mention.</p>
      ` : `
      <p>What you just received is a map — your personal timing intelligence for the next 12 months. Every person in ${target.community} could have exactly this. Their own clarity on when to move and when to hold, at a time when the financial stakes have never felt higher.</p>
      <p>We run a 25% affiliate programme. The report is $2,500 USD per person. Every person who buys through your link earns you <strong>$625</strong>. A single recommendation to your audience could generate thousands — passively, with no ongoing commitment from you.</p>
      `}
      <div class="highlight">
        <p>25% commission · $625 per sale · $2,500 report · Paid automatically via Whop</p>
      </div>
      <p>Sign up as an affiliate below — Whop generates your unique link instantly. Share it once, earn on every sale.</p>
      <p><a href="${WHOP_AFFILIATE_URL}" class="cta">Become an Affiliate →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildFinalNudgeHtml(target) {
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
      <p>Last note from me — I don't want to crowd your inbox.</p>
      <p>The affiliate programme is open and the commission is $625 per sale. If the timing isn't right or it's not a fit for your audience, completely understood.</p>
      <p>If you change your mind at any point, the link below will always be live.</p>
      <p><a href="${WHOP_AFFILIATE_URL}" class="cta">Join the Affiliate Programme →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── EMAIL SENDER ─────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${res.status} ${err}`);
  }
  return res.json();
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export function loadAiData() { return loadData(); }
export function getAiTarget(id) { return loadData().find(t => t.id === id); }
export function markAiReplied(id) { updateTarget(id, { replied: true }); }

export async function sendAiColdEmail(targetId) {
  const targets = loadData();
  const target  = targets.find(t => t.id === targetId);
  if (!target)           throw new Error(`Target not found: ${targetId}`);
  if (!target.email)     throw new Error(`No email for ${target.name} — DM: ${target.dmHandle}`);
  if (target.stage >= 1) throw new Error(`Already contacted: stage ${target.stage}`);

  await sendEmail(target.email, `A complimentary report for you, ${target.name.split(' ')[0]}`, buildColdEmailHtml(target));
  addPaidEmail(target.email); // Whitelist so they bypass Whop payment gate
  updateTarget(targetId, { stage: 1, emailSentAt: new Date().toISOString() });
  return target;
}

export async function sendAiFollowUp(targetId) {
  const target = loadData().find(t => t.id === targetId);
  if (!target)           throw new Error(`Target not found: ${targetId}`);
  if (!target.email)     throw new Error(`No email for ${target.name}`);
  if (target.stage !== 1) throw new Error(`Not at follow-up stage: stage ${target.stage}`);

  await sendEmail(target.email, `Following up — the AI commodities trade`, buildFollowUpEmailHtml(target));
  updateTarget(targetId, { stage: 2, followupSentAt: new Date().toISOString() });
  return target;
}

export async function sendAffiliatePitch(targetId) {
  const target = loadData().find(t => t.id === targetId);
  if (!target)       throw new Error(`Target not found: ${targetId}`);
  if (!target.email) throw new Error(`No email for ${target.name}`);

  await sendEmail(target.email, `Your affiliate link — $625 per sale`, buildAffiliatePitchHtml(target));
  updateTarget(targetId, { stage: 3, affiliatePitchSentAt: new Date().toISOString() });
  return target;
}

export function markAiReportReceived(email) {
  if (!email) return;
  const targets = loadData();
  const target  = targets.find(t => t.email && t.email.toLowerCase() === email.toLowerCase());
  if (!target) return;
  if (!target.reportReceivedAt) {
    updateTarget(target.id, { reportReceivedAt: new Date().toISOString() });
  }
}

export async function runAiDailyFollowUpSweep() {
  const targets = loadData();
  const now     = Date.now();
  const sent    = [];

  for (const t of targets) {
    if (!t.email || t.replied) continue;

    // Follow-up: 3 days after cold email, still at stage 1
    if (t.stage === 1 && t.emailSentAt) {
      const daysSince = (now - new Date(t.emailSentAt).getTime()) / 86400000;
      if (daysSince >= 3) {
        try { await sendAiFollowUp(t.id); sent.push(`follow-up: ${t.name}`); } catch(e) {}
      }
    }

    // Final nudge: 5 days after affiliate pitch, still at stage 3
    if (t.stage === 3 && t.affiliatePitchSentAt) {
      const daysSince = (now - new Date(t.affiliatePitchSentAt).getTime()) / 86400000;
      if (daysSince >= 5) {
        try {
          await sendEmail(t.email, `Last note — affiliate programme`, buildFinalNudgeHtml(t));
          updateTarget(t.id, { stage: 4 });
          sent.push(`nudge: ${t.name}`);
        } catch(e) {}
      }
    }
  }
  return sent;
}

export async function runAiAffiliatePitchSweep() {
  const targets = loadData();
  const now     = Date.now();
  const sent    = [];

  for (const t of targets) {
    if (!t.email || t.replied || !t.reportReceivedAt) continue;
    if (t.stage >= 3) continue;

    // Affiliate pitch: 24 hours after they receive their report
    const hoursSince = (now - new Date(t.reportReceivedAt).getTime()) / 3600000;
    if (hoursSince >= 24) {
      try { await sendAffiliatePitch(t.id); sent.push(t.name); } catch(e) {}
    }
  }
  return sent;
}

export function getAiStats() {
  const targets  = loadData();
  const total    = targets.length;
  const withEmail = targets.filter(t => t.email).length;
  const tier1    = targets.filter(t => t.tier === 1).length;
  const tier2    = targets.filter(t => t.tier === 2).length;
  const stage0   = targets.filter(t => t.stage === 0).length;
  const stage1   = targets.filter(t => t.stage === 1).length;
  const stage2   = targets.filter(t => t.stage === 2).length;
  const stage3   = targets.filter(t => t.stage === 3).length;
  const replied  = targets.filter(t => t.replied).length;
  const pitchSent = targets.filter(t => t.affiliatePitchSentAt).length;
  return { total, withEmail, tier1, tier2, stage0, stage1, stage2, stage3, replied, pitchSent };
}

export async function batchSendAiColdEmails(tier) {
  const targets = loadData().filter(t => t.tier === tier && t.email && t.stage === 0);
  const results = [];
  for (const t of targets) {
    try {
      await sendAiColdEmail(t.id);
      results.push({ name: t.name, status: 'sent' });
      await new Promise(r => setTimeout(r, 1200)); // rate limit
    } catch(e) {
      results.push({ name: t.name, status: 'failed', error: e.message });
    }
  }
  return results;
}
