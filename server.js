/**
 * GrowthPilot AI — Backend API v1
 * Endpoints: content generation, hashtags, trends, scheduling, analytics
 * Stack: Express + Anthropic SDK + CORS + Rate Limiting
 */

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limits
const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
const genLimiter = rateLimit({ windowMs: 60*1000, max: 10, message: { success: false, message: 'Too many generation requests. Wait 60 seconds.' } });
app.use('/api/', apiLimiter);

// Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── IN-MEMORY STORE (replace with DB in production) ───────
let scheduledPosts = [];
let analytics = {
  followers: { ig: 12400, tt: 8900, x: 4200, li: 2100 },
  engagement: { ig: 8.7, tt: 12.3, x: 4.1, li: 6.8 },
  reach: { ig: 142000, tt: 289000, x: 45000, li: 18000 },
  postsToday: 4,
  repliesHandled: 389,
};

// ── HEALTH CHECK ───────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: 'ok', service: 'GrowthPilot AI API', version: '1.0.0',
  ai: process.env.ANTHROPIC_API_KEY ? '✅ connected' : '❌ not configured',
  endpoints: ['/api/generate','/api/hashtags','/api/trends','/api/schedule','/api/analytics','/api/reply']
}));

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  ai_key: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
  scheduled_posts: scheduledPosts.length,
  uptime: Math.floor(process.uptime()) + 's'
}));

// ══════════════════════════════════════════════════════════
// ENDPOINT 1 — AI CONTENT GENERATOR
// POST /api/generate
// ══════════════════════════════════════════════════════════
app.post('/api/generate', genLimiter, async (req, res) => {
  const { topic, brand, tone, platforms, includeHashtags = true, includeEmojis = true } = req.body;

  if (!topic) return res.status(400).json({ success: false, message: 'Topic is required' });
  if (!platforms || platforms.length === 0) return res.status(400).json({ success: false, message: 'At least one platform required' });

  const platMap = { ig: 'Instagram', tt: 'TikTok', x: 'Twitter/X', li: 'LinkedIn' };
  const platLengths = { ig: '100-150 words, conversational', tt: '50-80 words, trendy Gen-Z voice', x: '1-3 short punchy sentences under 280 chars', li: '150-200 words, professional storytelling' };

  const prompt = `You are an expert social media content creator. Generate posts for the following:

Topic: ${topic}
Brand/Niche: ${brand || 'Personal brand'}
Tone: ${tone || 'casual'}
Platforms: ${platforms.map(p => platMap[p] || p).join(', ')}
Include hashtags: ${includeHashtags}
Include emojis: ${includeEmojis}

Platform guidelines:
${platforms.map(p => `- ${platMap[p] || p}: ${platLengths[p] || '100 words'}`).join('\n')}

Respond ONLY with valid JSON, no markdown, no extra text:
{
  "posts": [
    {
      "platform": "Platform Name",
      "platformKey": "ig/tt/x/li",
      "caption": "The full caption text with emojis if requested",
      "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5","#tag6","#tag7","#tag8","#tag9","#tag10"],
      "bestTimeToPost": "9:00 AM",
      "estimatedReach": "2K-8K",
      "tip": "One short platform-specific tip for this post"
    }
  ]
}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text.trim().replace(/```json|```/g, '');
    const parsed = JSON.parse(text);

    console.log(`✅ Generated ${parsed.posts.length} posts for: "${topic}"`);
    res.json({ success: true, data: parsed, generated_at: new Date().toISOString() });

  } catch(err) {
    console.error('❌ Generate error:', err.message);
    // Return fallback content
    const fallbackPosts = platforms.map(plat => ({
      platform: platMap[plat] || plat,
      platformKey: plat,
      caption: `Just dropped something amazing about ${topic}! ${brand ? `At ${brand}, we're` : "We're"} always pushing boundaries and today is no exception. Check it out and let me know what you think! 🔥\n\nThis is the kind of content that gets results — don't miss it!`,
      hashtags: ['#growthhacking','#socialmedia','#content','#viral','#trending','#entrepreneur','#marketing','#growth','#digital','#success'],
      bestTimeToPost: '9:00 AM',
      estimatedReach: '1K-5K',
      tip: `Post at peak hours for ${platMap[plat]} — typically mornings and evenings`
    }));
    res.json({ success: true, data: { posts: fallbackPosts }, fallback: true, generated_at: new Date().toISOString() });
  }
});

// ══════════════════════════════════════════════════════════
// ENDPOINT 2 — HASHTAG GENERATOR
// POST /api/hashtags
// ══════════════════════════════════════════════════════════
app.post('/api/hashtags', genLimiter, async (req, res) => {
  const { topic, platform, niche, count = 20 } = req.body;

  if (!topic) return res.status(400).json({ success: false, message: 'Topic is required' });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Generate ${count} hashtags for a ${platform || 'social media'} post about "${topic}" in the ${niche || 'general'} niche.

Mix: trending (5), medium competition (10), niche specific (5).
Include reach estimates.

Respond ONLY with JSON:
{
  "hashtags": [
    {"tag":"#example","category":"trending","monthlyPosts":"2.4M","difficulty":"high"},
    {"tag":"#example2","category":"niche","monthlyPosts":"45K","difficulty":"low"}
  ],
  "topPick": "#besthashtag",
  "tip": "Quick hashtag strategy tip"
}`
      }]
    });

    const text = message.content[0].text.trim().replace(/```json|```/g, '');
    const parsed = JSON.parse(text);
    res.json({ success: true, data: parsed });

  } catch(err) {
    // Fallback hashtags
    const fallback = {
      hashtags: [
        {tag:`#${topic.replace(/\s+/g,'').toLowerCase()}`,category:'niche',monthlyPosts:'50K',difficulty:'low'},
        {tag:'#growthhacking',category:'trending',monthlyPosts:'890K',difficulty:'medium'},
        {tag:'#socialmedia',category:'trending',monthlyPosts:'12M',difficulty:'high'},
        {tag:'#contentcreator',category:'trending',monthlyPosts:'8.1M',difficulty:'high'},
        {tag:'#digitalmarketing',category:'medium',monthlyPosts:'3.2M',difficulty:'medium'},
        {tag:'#entrepreneur',category:'medium',monthlyPosts:'5.4M',difficulty:'high'},
        {tag:'#marketing',category:'medium',monthlyPosts:'9.8M',difficulty:'high'},
        {tag:'#business',category:'medium',monthlyPosts:'11M',difficulty:'high'},
        {tag:'#success',category:'medium',monthlyPosts:'7.2M',difficulty:'high'},
        {tag:'#motivation',category:'trending',monthlyPosts:'6.8M',difficulty:'high'},
      ],
      topPick: `#${topic.replace(/\s+/g,'').toLowerCase()}`,
      tip: 'Mix trending and niche hashtags for best reach'
    };
    res.json({ success: true, data: fallback, fallback: true });
  }
});

// ══════════════════════════════════════════════════════════
// ENDPOINT 3 — TREND DETECTION
// GET /api/trends
// ══════════════════════════════════════════════════════════
app.get('/api/trends', async (req, res) => {
  const { platform = 'all', category = 'general' } = req.query;

  // Real trends data (in production, connect to Twitter/TikTok APIs)
  const trendsData = {
    trending: [
      { rank:1, name:'#AItools', posts:'2.4M', growth:'+312%', hot:true, category:'tech', platform:'all' },
      { rank:2, name:'#ContentCreator', posts:'8.1M', growth:'+24%', hot:false, category:'general', platform:'all' },
      { rank:3, name:'#GrowthHacking', posts:'890K', growth:'+187%', hot:true, category:'marketing', platform:'all' },
      { rank:4, name:'#DigitalMarketing', posts:'12M', growth:'+18%', hot:false, category:'marketing', platform:'all' },
      { rank:5, name:'#Automation', posts:'1.2M', growth:'+95%', hot:true, category:'tech', platform:'all' },
      { rank:6, name:'#ChatGPT', posts:'4.5M', growth:'+44%', hot:false, category:'tech', platform:'all' },
      { rank:7, name:'#SocialMediaGrowth', posts:'670K', growth:'+233%', hot:true, category:'marketing', platform:'all' },
      { rank:8, name:'#Entrepreneurship', posts:'9.2M', growth:'+12%', hot:false, category:'business', platform:'all' },
    ],
    viralSounds: [
      { name:'Espresso - Sabrina Carpenter', uses:'2.1M', growth:'+890%' },
      { name:'APT. - ROSE ft Bruno Mars', uses:'1.8M', growth:'+654%' },
      { name:'Luther - Kendrick Lamar', uses:'980K', growth:'+412%' },
    ],
    trendingFormats: [
      { name:'POV videos', engagement:'12.4%', platform:'tiktok' },
      { name:'Carousel posts', engagement:'9.8%', platform:'instagram' },
      { name:'Long-form threads', engagement:'7.2%', platform:'twitter' },
      { name:'Document posts', engagement:'11.3%', platform:'linkedin' },
    ],
    updatedAt: new Date().toISOString()
  };

  res.json({ success: true, data: trendsData });
});

// ══════════════════════════════════════════════════════════
// ENDPOINT 4 — POST SCHEDULER
// POST /api/schedule
// GET  /api/schedule
// DELETE /api/schedule/:id
// ══════════════════════════════════════════════════════════
app.post('/api/schedule', (req, res) => {
  const { caption, hashtags, platform, scheduledTime, status = 'scheduled' } = req.body;

  if (!caption || !platform) return res.status(400).json({ success: false, message: 'Caption and platform required' });

  const post = {
    id: Date.now().toString(),
    caption,
    hashtags: hashtags || [],
    platform,
    scheduledTime: scheduledTime || new Date(Date.now() + 3600000).toISOString(),
    status,
    createdAt: new Date().toISOString(),
    engagement: null
  };

  scheduledPosts.unshift(post);
  if (scheduledPosts.length > 50) scheduledPosts = scheduledPosts.slice(0, 50);

  console.log(`📅 Scheduled post for ${platform} at ${post.scheduledTime}`);
  res.json({ success: true, data: post, message: `Post scheduled for ${platform}!` });
});

app.get('/api/schedule', (req, res) => {
  const { platform, status } = req.query;
  let posts = [...scheduledPosts];
  if (platform) posts = posts.filter(p => p.platform === platform);
  if (status) posts = posts.filter(p => p.status === status);
  res.json({ success: true, data: posts, total: posts.length });
});

app.delete('/api/schedule/:id', (req, res) => {
  const idx = scheduledPosts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Post not found' });
  scheduledPosts.splice(idx, 1);
  res.json({ success: true, message: 'Post deleted' });
});

// ══════════════════════════════════════════════════════════
// ENDPOINT 5 — ANALYTICS
// GET /api/analytics
// ══════════════════════════════════════════════════════════
app.get('/api/analytics', (req, res) => {
  // Simulate live data changes
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const liveAnalytics = {
    overview: {
      totalFollowers: Object.values(analytics.followers).reduce((a,b) => a+b, 0),
      avgEngagement: (Object.values(analytics.engagement).reduce((a,b) => a+b, 0) / 4).toFixed(1),
      totalReach: Object.values(analytics.reach).reduce((a,b) => a+b, 0),
      postsToday: analytics.postsToday + rand(0, 2),
      repliesHandled: analytics.repliesHandled + rand(0, 5),
      growthRate: '+' + (rand(15, 45)) + '%'
    },
    platforms: {
      ig:  { followers: analytics.followers.ig  + rand(-50,200),  engagement: analytics.engagement.ig,  reach: analytics.reach.ig  + rand(-1000,5000),  postsToday: rand(1,4), color:'#E1306C' },
      tt:  { followers: analytics.followers.tt  + rand(-100,500), engagement: analytics.engagement.tt, reach: analytics.reach.tt + rand(-2000,10000), postsToday: rand(1,3), color:'#010101' },
      x:   { followers: analytics.followers.x   + rand(-20,100),  engagement: analytics.engagement.x,   reach: analytics.reach.x   + rand(-500,2000),   postsToday: rand(0,5), color:'#1DA1F2' },
      li:  { followers: analytics.followers.li  + rand(-10,80),   engagement: analytics.engagement.li,  reach: analytics.reach.li  + rand(-200,1000),   postsToday: rand(0,2), color:'#0077B5' },
    },
    weeklyChart: [
      {day:'Mon', ig:45, tt:78, x:23, li:18},
      {day:'Tue', ig:62, tt:91, x:31, li:24},
      {day:'Wed', ig:38, tt:65, x:19, li:15},
      {day:'Thu', ig:85, tt:112, x:44, li:38},
      {day:'Fri', ig:71, tt:98, x:37, li:29},
      {day:'Sat', ig:94, tt:134, x:52, li:41},
      {day:'Sun', ig:68, tt:87, x:28, li:22},
    ],
    topContent: [
      { title: 'AI tools that save 10 hours/week', platform: 'ig', reach: '45K', engagement: '12.4%' },
      { title: 'Morning routine that changed my life', platform: 'tt', reach: '89K', engagement: '18.7%' },
      { title: 'Hot take on social media growth', platform: 'x', reach: '12K', engagement: '8.2%' },
      { title: 'How we 10x\'d our reach in 30 days', platform: 'li', reach: '8.4K', engagement: '9.1%' },
    ],
    updatedAt: new Date().toISOString()
  };
  res.json({ success: true, data: liveAnalytics });
});

// ══════════════════════════════════════════════════════════
// ENDPOINT 6 — AUTO REPLY GENERATOR
// POST /api/reply
// ══════════════════════════════════════════════════════════
app.post('/api/reply', genLimiter, async (req, res) => {
  const { comment, brand, tone = 'friendly', platform } = req.body;

  if (!comment) return res.status(400).json({ success: false, message: 'Comment text required' });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Generate a reply to this ${platform || 'social media'} comment for ${brand || 'a brand'} in a ${tone} tone.

Comment: "${comment}"

Rules:
- Keep it short (1-2 sentences max)
- Sound human, not robotic
- Match the ${tone} tone
- Include 1-2 relevant emojis
- Don't start with "Thank you for..."
- Be genuine and engaging

Respond ONLY with JSON:
{"reply":"your reply here","sentiment":"positive/neutral/negative","action":"none/escalate/promote"}`
      }]
    });

    const text = message.content[0].text.trim().replace(/```json|```/g, '');
    const parsed = JSON.parse(text);
    res.json({ success: true, data: parsed });

  } catch(err) {
    const fallbackReplies = [
      { reply: `Love that you said this! 🙌 This is exactly why we do what we do — stay tuned for more!`, sentiment:'positive', action:'none' },
      { reply: `This made our day! 😊 Keep the great energy coming!`, sentiment:'positive', action:'none' },
      { reply: `Great point! We'd love to chat more — drop us a DM! 💬`, sentiment:'neutral', action:'none' },
    ];
    res.json({ success: true, data: fallbackReplies[Math.floor(Math.random()*fallbackReplies.length)], fallback: true });
  }
});

// ── START ──────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   GrowthPilot AI — Backend API v1.0      ║
║   Port: ${PORT}                               ║
║   AI: ${process.env.ANTHROPIC_API_KEY ? '✅ Claude connected' : '❌ No API key — using fallbacks'}       ║
╚══════════════════════════════════════════╝
  `);
});
