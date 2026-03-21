/**
 * GrowthPilot AI — Backend v3
 * Integrations:
 *   - Anthropic Claude (AI content)
 *   - Twitter/X API v2 (post + trends)
 *   - Instagram Graph API (post)
 *   - TikTok API (post)
 *   - Stripe (card payments)
 *   - M-Pesa Daraja (mobile payments)
 *   - Resend (email receipts)
 */

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const Anthropic  = require('@anthropic-ai/sdk');
const Stripe     = require('stripe');
const axios      = require('axios');
const FormData   = require('form-data');
require('dotenv').config();

const app = express();

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','OPTIONS'] }));
app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limits
const stdLimiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
const aiLimiter  = rateLimit({ windowMs: 60*1000, max: 15, message: { success:false, message:'Too many AI requests. Wait 60 seconds.' } });
const payLimiter = rateLimit({ windowMs: 60*1000, max: 10, message: { success:false, message:'Too many payment requests.' } });
app.use('/api/', stdLimiter);

// ── CLIENTS ────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe    = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// ── PLANS ──────────────────────────────────────────────────
const PLANS = {
  starter: { name:'Starter', price:0,    priceKES:0,     stripePriceId:'',               features:['10 AI posts/month','2 platforms','Basic hashtags'] },
  pro:     { name:'Pro',     price:29,   priceKES:3800,  stripePriceId: process.env.STRIPE_PRO_PRICE_ID     || '', features:['Unlimited AI posts','All 4 platforms','Auto posting','Auto replies','Trend detection'] },
  agency:  { name:'Agency',  price:99,   priceKES:12900, stripePriceId: process.env.STRIPE_AGENCY_PRICE_ID || '', features:['Everything in Pro','20 client accounts','White-label','API access'] },
};

// ── IN-MEMORY STORE (use MongoDB/PostgreSQL in production) ─
let users           = [];
let scheduledPosts  = [];
let feedback        = [];
let payments        = [];

// ══════════════════════════════════════════════════════════
//  HEALTH
// ══════════════════════════════════════════════════════════
app.get('/', (req, res) => res.json({
  status:'ok', service:'GrowthPilot AI v3', version:'3.0.0',
  integrations: {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    twitter:   !!process.env.TWITTER_BEARER_TOKEN,
    instagram: !!process.env.INSTAGRAM_ACCESS_TOKEN,
    tiktok:    !!process.env.TIKTOK_ACCESS_TOKEN,
    stripe:    !!process.env.STRIPE_SECRET_KEY,
    mpesa:     !!process.env.MPESA_CONSUMER_KEY,
    resend:    !!process.env.RESEND_API_KEY,
  }
}));

// ══════════════════════════════════════════════════════════
//  AI CONTENT GENERATION
// ══════════════════════════════════════════════════════════
app.post('/api/generate', aiLimiter, async (req, res) => {
  const { topic, brand, tone='casual', platforms=['ig','tt'], includeHashtags=true } = req.body;
  if (!topic) return res.status(400).json({ success:false, message:'Topic is required' });

  const platMap     = { ig:'Instagram', tt:'TikTok', x:'Twitter/X', li:'LinkedIn' };
  const platGuides  = {
    ig: 'Instagram: 100-150 words, emotional, conversational, 2-3 line breaks, strong CTA',
    tt: 'TikTok: 50-80 words, trendy Gen-Z voice, hook in first 3 words, high energy',
    x:  'Twitter/X: max 280 chars, punchy, controversial hook OR helpful insight, 1-2 hashtags max',
    li: 'LinkedIn: 150-200 words, professional storytelling, data/results focused, industry insight',
  };

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5', max_tokens: 1500,
      messages: [{ role:'user', content:`Generate social media posts.

Topic: ${topic}
Brand: ${brand || 'Personal brand'}
Tone: ${tone}
Include hashtags: ${includeHashtags}

${platforms.map(p => platGuides[p] || '').filter(Boolean).join('\n')}

Respond ONLY with valid JSON (no markdown):
{
  "posts": [
    {
      "platform":"Platform Name",
      "platformKey":"ig/tt/x/li",
      "caption":"full caption with emojis",
      "hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5","#tag6","#tag7","#tag8","#tag9","#tag10"],
      "bestTimeToPost":"9:00 AM",
      "estimatedReach":"2K-8K",
      "tip":"one quick platform tip"
    }
  ]
}` }]
    });

    const parsed = JSON.parse(msg.content[0].text.trim().replace(/```json|```/g,''));
    return res.json({ success:true, data:parsed, generated_at:new Date().toISOString() });

  } catch(err) {
    console.error('AI generate error:', err.message);
    const fallback = platforms.map(p => ({
      platform: platMap[p]||p, platformKey:p,
      caption: `🚀 Big things happening with ${topic}!\n\n${brand ? brand+' is' : "We're"} pushing boundaries and today is no exception. This is the moment you've been waiting for — don't miss it!\n\nDrop a comment below 👇`,
      hashtags: ['#growthhacking','#socialmedia','#viral','#trending','#contentcreator','#marketing','#digital','#entrepreneur','#ai','#growth'],
      bestTimeToPost:'9:00 AM', estimatedReach:'1K-5K', tip:'Post at peak hours for max reach!'
    }));
    return res.json({ success:true, data:{ posts:fallback }, fallback:true });
  }
});

// ══════════════════════════════════════════════════════════
//  HASHTAG GENERATOR
// ══════════════════════════════════════════════════════════
app.post('/api/hashtags', aiLimiter, async (req, res) => {
  const { topic, platform='ig', niche='general', count=20 } = req.body;
  if (!topic) return res.status(400).json({ success:false, message:'Topic is required' });
  try {
    const msg = await anthropic.messages.create({
      model:'claude-opus-4-5', max_tokens:600,
      messages:[{ role:'user', content:`Generate ${count} hashtags for ${platform} about "${topic}" in ${niche} niche. Mix trending (5), medium (10), niche (5).
Respond ONLY JSON: {"hashtags":[{"tag":"#x","category":"trending/medium/niche","monthlyPosts":"2.4M","difficulty":"high/medium/low"}],"topPick":"#best","tip":"quick tip"}` }]
    });
    return res.json({ success:true, data:JSON.parse(msg.content[0].text.trim().replace(/```json|```/g,'')) });
  } catch(err) {
    return res.json({ success:true, data:{ hashtags:[
      {tag:`#${topic.replace(/\s/g,'').toLowerCase()}`,category:'niche',monthlyPosts:'50K',difficulty:'low'},
      {tag:'#growthhacking',category:'trending',monthlyPosts:'890K',difficulty:'medium'},
      {tag:'#socialmedia',category:'trending',monthlyPosts:'12M',difficulty:'high'},
      {tag:'#contentcreator',category:'trending',monthlyPosts:'8.1M',difficulty:'high'},
      {tag:'#digitalmarketing',category:'medium',monthlyPosts:'3.2M',difficulty:'medium'},
    ], topPick:`#${topic.replace(/\s/g,'').toLowerCase()}`, tip:'Mix trending and niche hashtags' }, fallback:true });
  }
});

// ══════════════════════════════════════════════════════════
//  TWITTER/X — POST TWEET
// ══════════════════════════════════════════════════════════
app.post('/api/social/twitter/post', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ success:false, message:'Tweet text required' });
  if (!process.env.TWITTER_BEARER_TOKEN || !process.env.TWITTER_ACCESS_TOKEN) {
    return res.json({ success:false, message:'Twitter API keys not configured. Add TWITTER_BEARER_TOKEN, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET, TWITTER_API_KEY, TWITTER_API_SECRET to .env', setup_url:'https://developer.twitter.com/en/portal/dashboard' });
  }
  try {
    const response = await axios.post('https://api.twitter.com/2/tweets',
      { text: text.slice(0, 280) },
      { headers: { Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`, 'Content-Type':'application/json' } }
    );
    scheduledPosts.push({ id:Date.now().toString(), platform:'Twitter/X', caption:text, status:'published', publishedAt:new Date().toISOString(), tweetId:response.data?.data?.id });
    return res.json({ success:true, message:'Tweet posted successfully!', data:response.data });
  } catch(err) {
    return res.status(500).json({ success:false, message:`Twitter error: ${err.response?.data?.detail || err.message}` });
  }
});

// ══════════════════════════════════════════════════════════
//  TWITTER/X — GET TRENDING TOPICS
// ══════════════════════════════════════════════════════════
app.get('/api/trends', async (req, res) => {
  const { woeid=1, country='kenya' } = req.query;

  const fallbackTrends = [
    {rank:1,name:'#AItools',posts:'2.4M',growth:'+312%',hot:true,category:'tech'},
    {rank:2,name:'#ContentCreator',posts:'8.1M',growth:'+24%',hot:false,category:'general'},
    {rank:3,name:'#GrowthHacking',posts:'890K',growth:'+187%',hot:true,category:'marketing'},
    {rank:4,name:'#DigitalMarketing',posts:'12M',growth:'+18%',hot:false,category:'marketing'},
    {rank:5,name:'#Automation',posts:'1.2M',growth:'+95%',hot:true,category:'tech'},
    {rank:6,name:'#SocialMediaGrowth',posts:'670K',growth:'+233%',hot:true,category:'marketing'},
    {rank:7,name:'#Kenya',posts:'5.1M',growth:'+28%',hot:false,category:'local'},
    {rank:8,name:'#Nairobi',posts:'890K',growth:'+67%',hot:true,category:'local'},
    {rank:9,name:'#ChatGPT',posts:'4.5M',growth:'+44%',hot:false,category:'tech'},
    {rank:10,name:'#Entrepreneur',posts:'9.2M',growth:'+12%',hot:false,category:'business'},
  ];

  // ── FETCH REAL NEWS from NewsAPI (free tier: 100 req/day) ──────────────
  async function fetchNews() {
    if (!process.env.NEWS_API_KEY) {
      // Curated fallback news when no API key
      return [
        {headline:'AI tools are reshaping social media marketing across Africa in 2025',source:'TechCabal',time:'2h ago',url:'https://techcabal.com',category:'AI'},
        {headline:'TikTok surpasses 2 billion monthly active users worldwide',source:'Reuters',time:'4h ago',url:'https://reuters.com',category:'Social'},
        {headline:'Instagram Reels algorithm update gives small creators a major boost',source:'Social Media Today',time:'6h ago',url:'https://socialmediatoday.com',category:'Instagram'},
        {headline:'X Premium subscriptions grow 40% across East Africa this quarter',source:'Business Insider Africa',time:'8h ago',url:'https://businessinsider.com',category:'Twitter'},
        {headline:'LinkedIn records highest engagement from Kenyan professionals in 2025',source:'LinkedIn News',time:'10h ago',url:'https://linkedin.com',category:'LinkedIn'},
        {headline:'Meta launches new AI tools for small business social media growth',source:'TechCrunch',time:'12h ago',url:'https://techcrunch.com',category:'Meta'},
      ];
    }
    try {
      const newsRes = await axios.get('https://newsapi.org/v2/top-headlines', {
        params: {
          q: 'social media marketing OR AI tools OR digital marketing',
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 6,
          apiKey: process.env.NEWS_API_KEY
        }
      });
      return newsRes.data.articles?.map((a, i) => {
        const diff = Math.floor((Date.now() - new Date(a.publishedAt)) / 3600000);
        return {
          headline: a.title?.replace(/ - .*$/, '') || 'No title',
          source: a.source?.name || 'Unknown',
          time: diff < 1 ? 'Just now' : diff < 24 ? `${diff}h ago` : `${Math.floor(diff/24)}d ago`,
          url: a.url || '#',
          category: 'News'
        };
      }) || [];
    } catch(e) {
      console.error('NewsAPI error:', e.message);
      return [];
    }
  }

  // ── FETCH REAL TWITTER TRENDS ──────────────────────────────────────────
  async function fetchTwitterTrends() {
    if (!process.env.TWITTER_BEARER_TOKEN) return null;
    try {
      // Get trends for Kenya (woeid: 23424863) or worldwide (1)
      const kenyaWoeid = country === 'kenya' ? 23424863 : parseInt(woeid);
      const r = await axios.get(
        `https://api.twitter.com/1.1/trends/place.json?id=${kenyaWoeid}`,
        { headers: { Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}` } }
      );
      return r.data[0]?.trends?.slice(0,10).map((t, i) => ({
        rank: i+1,
        name: t.name,
        posts: t.tweet_volume
          ? t.tweet_volume > 1000000
            ? (t.tweet_volume/1000000).toFixed(1)+'M'
            : (t.tweet_volume/1000).toFixed(0)+'K'
          : 'Trending',
        growth: t.tweet_volume > 500000 ? '+HOT🔥' : '+Trending',
        hot: t.tweet_volume > 500000,
        url: t.url || `https://twitter.com/search?q=${encodeURIComponent(t.name)}`
      })) || null;
    } catch(e) {
      console.error('Twitter trends error:', e.message);
      return null;
    }
  }

  try {
    const [twitterTrends, news] = await Promise.all([fetchTwitterTrends(), fetchNews()]);
    const trending = twitterTrends || fallbackTrends;
    return res.json({
      success: true,
      realtime: !!twitterTrends,
      data: {
        trending,
        news: news.length > 0 ? news : null,
        viralFormats: [
          {name:'POV videos',engagement:'12.4%',platform:'TikTok'},
          {name:'Carousel posts',engagement:'9.8%',platform:'Instagram'},
          {name:'Threads',engagement:'7.2%',platform:'Twitter/X'},
          {name:'Document posts',engagement:'11.3%',platform:'LinkedIn'},
        ],
        updatedAt: new Date().toISOString(),
        source: twitterTrends ? 'Twitter/X API (Real-time)' : 'Curated (Add TWITTER_BEARER_TOKEN for live data)',
        newsSource: process.env.NEWS_API_KEY ? 'NewsAPI (Real-time)' : 'Curated (Add NEWS_API_KEY for live news)',
      }
    });
  } catch(e) {
    return res.json({
      success: true, fallback: true,
      data: { trending: fallbackTrends, news: await fetchNews(), updatedAt: new Date().toISOString() }
    });
  }
});
// ══════════════════════════════════════════════════════════
//  INSTAGRAM — POST
// ══════════════════════════════════════════════════════════
app.post('/api/social/instagram/post', async (req, res) => {
  const { caption, imageUrl } = req.body;
  if (!caption) return res.status(400).json({ success:false, message:'Caption required' });

  if (!process.env.INSTAGRAM_ACCESS_TOKEN || !process.env.INSTAGRAM_BUSINESS_ID) {
    return res.json({ success:false, message:'Instagram API not configured. Add INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ID to .env', setup_url:'https://developers.facebook.com/docs/instagram-api/getting-started' });
  }

  try {
    // Step 1: Create media container
    const imgUrl = imageUrl || 'https://images.unsplash.com/photo-1611348586804-61bf6c080437?w=1080&q=90';
    const container = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.INSTAGRAM_BUSINESS_ID}/media`,
      { image_url:imgUrl, caption, access_token:process.env.INSTAGRAM_ACCESS_TOKEN }
    );
    const containerId = container.data.id;

    // Step 2: Publish
    await new Promise(r => setTimeout(r, 2000)); // Wait for container
    const publish = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.INSTAGRAM_BUSINESS_ID}/media_publish`,
      { creation_id:containerId, access_token:process.env.INSTAGRAM_ACCESS_TOKEN }
    );

    scheduledPosts.push({ id:Date.now().toString(), platform:'Instagram', caption, status:'published', publishedAt:new Date().toISOString(), postId:publish.data.id });
    return res.json({ success:true, message:'Instagram post published!', data:publish.data });
  } catch(err) {
    return res.status(500).json({ success:false, message:`Instagram error: ${err.response?.data?.error?.message || err.message}` });
  }
});

// ══════════════════════════════════════════════════════════
//  TIKTOK — POST
// ══════════════════════════════════════════════════════════
app.post('/api/social/tiktok/post', async (req, res) => {
  const { caption, videoUrl } = req.body;
  if (!caption) return res.status(400).json({ success:false, message:'Caption required' });

  if (!process.env.TIKTOK_ACCESS_TOKEN) {
    return res.json({ success:false, message:'TikTok API not configured. Add TIKTOK_ACCESS_TOKEN to .env', setup_url:'https://developers.tiktok.com/doc/content-posting-api-get-started' });
  }

  try {
    // TikTok Content Posting API
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: { title:caption.slice(0,150), privacy_level:'PUBLIC_TO_EVERYONE', disable_comment:false },
        source_info: { source:'PULL_FROM_URL', video_url: videoUrl || '' }
      },
      { headers: { Authorization:`Bearer ${process.env.TIKTOK_ACCESS_TOKEN}`, 'Content-Type':'application/json' } }
    );
    scheduledPosts.push({ id:Date.now().toString(), platform:'TikTok', caption, status:'published', publishedAt:new Date().toISOString() });
    return res.json({ success:true, message:'TikTok post initiated!', data:response.data });
  } catch(err) {
    return res.status(500).json({ success:false, message:`TikTok error: ${err.response?.data?.error?.message || err.message}` });
  }
});

// ══════════════════════════════════════════════════════════
//  AUTO REPLY GENERATOR
// ══════════════════════════════════════════════════════════
app.post('/api/reply', aiLimiter, async (req, res) => {
  const { comment, brand, tone='friendly', platform } = req.body;
  if (!comment) return res.status(400).json({ success:false, message:'Comment required' });
  try {
    const msg = await anthropic.messages.create({
      model:'claude-opus-4-5', max_tokens:250,
      messages:[{ role:'user', content:`Reply to this ${platform||'social media'} comment for ${brand||'a brand'} (${tone} tone).
Comment: "${comment}"
Rules: 1-2 sentences max, human-sounding, 1-2 emojis, don't start with "Thank you for"
Respond ONLY JSON: {"reply":"text","sentiment":"positive/neutral/negative","action":"none/escalate/promote"}` }]
    });
    return res.json({ success:true, data:JSON.parse(msg.content[0].text.trim().replace(/```json|```/g,'')) });
  } catch(err) {
    return res.json({ success:true, data:{ reply:`Love this! 🙌 This is exactly the energy we're here for — stay tuned for more!`, sentiment:'positive', action:'none' }, fallback:true });
  }
});

// ══════════════════════════════════════════════════════════
//  CUSTOMER FEEDBACK
// ══════════════════════════════════════════════════════════
app.post('/api/feedback', (req, res) => {
  const { name, email, rating, message, platform, category='general' } = req.body;
  if (!message) return res.status(400).json({ success:false, message:'Feedback message required' });
  const fb = { id:Date.now().toString(), name:name||'Anonymous', email:email||'', rating:rating||5, message, platform:platform||'general', category, createdAt:new Date().toISOString(), status:'new' };
  feedback.unshift(fb);
  if (feedback.length > 200) feedback = feedback.slice(0,200);
  console.log(`📬 Feedback from ${fb.name}: ${fb.rating}⭐ — "${fb.message.slice(0,60)}..."`);
  return res.json({ success:true, message:'Thank you for your feedback!', data:fb });
});

app.get('/api/feedback', (req, res) => {
  const { limit=20, rating, status } = req.query;
  let fb = [...feedback];
  if (rating) fb = fb.filter(f => f.rating == rating);
  if (status) fb = fb.filter(f => f.status === status);
  const avgRating = fb.length ? (fb.reduce((a,f) => a+f.rating, 0)/fb.length).toFixed(1) : 0;
  return res.json({ success:true, data:fb.slice(0,+limit), total:fb.length, avgRating });
});

app.get('/api/feedback/stats', (req, res) => {
  const total = feedback.length;
  const avg   = total ? (feedback.reduce((a,f) => a+f.rating, 0)/total).toFixed(1) : 0;
  const dist  = [1,2,3,4,5].map(r => ({ rating:r, count:feedback.filter(f=>f.rating===r).length }));
  const recent = feedback.slice(0,5);
  return res.json({ success:true, data:{ total, avgRating:avg, distribution:dist, recent } });
});

// ══════════════════════════════════════════════════════════
//  PAYMENTS — STRIPE
// ══════════════════════════════════════════════════════════
app.post('/api/payments/stripe/create-checkout', payLimiter, async (req, res) => {
  const { plan='pro', email, successUrl, cancelUrl } = req.body;
  const planData = PLANS[plan];
  if (!planData) return res.status(400).json({ success:false, message:'Invalid plan' });

  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder') {
    return res.json({ success:false, message:'Stripe not configured. Add STRIPE_SECRET_KEY to .env', setup_url:'https://dashboard.stripe.com/apikeys', demo:true });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name:`GrowthPilot ${planData.name}`, description:planData.features.join(' · ') },
          unit_amount: planData.price * 100,
          recurring: { interval:'month' }
        },
        quantity: 1,
      }],
      success_url: successUrl || `${req.headers.origin || 'https://growthpilot.netlify.app'}/success?plan=${plan}&session={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl  || `${req.headers.origin || 'https://growthpilot.netlify.app'}/pricing`,
      metadata: { plan, service:'growthpilot' }
    });

    payments.push({ id:session.id, type:'stripe', plan, email:email||'unknown', amount:planData.price, currency:'USD', status:'pending', createdAt:new Date().toISOString() });
    return res.json({ success:true, checkoutUrl:session.url, sessionId:session.id });
  } catch(err) {
    return res.status(500).json({ success:false, message:`Stripe error: ${err.message}` });
  }
});

// Stripe webhook
app.post('/api/payments/stripe/webhook', express.raw({type:'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET||'');
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const pmIdx = payments.findIndex(p => p.id === session.id);
      if (pmIdx > -1) payments[pmIdx].status = 'paid';
      console.log(`✅ Stripe payment complete: ${session.id}`);
    }
    res.json({ received:true });
  } catch(err) {
    return res.status(400).json({ error:`Webhook error: ${err.message}` });
  }
});

// ══════════════════════════════════════════════════════════
//  PAYMENTS — M-PESA DARAJA
// ══════════════════════════════════════════════════════════
async function getMpesaToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const base = process.env.MPESA_SANDBOX === 'true' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
  const r = await axios.get(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers:{ Authorization:`Basic ${auth}` } });
  return r.data.access_token;
}

app.post('/api/payments/mpesa/stk-push', payLimiter, async (req, res) => {
  let { phone, plan='pro', amount } = req.body;
  if (!phone) return res.status(400).json({ success:false, message:'Phone number required (format: 254XXXXXXXXX)' });

  // Check all required env vars
  const missing = ['MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_SHORTCODE','MPESA_PASSKEY'].filter(k => !process.env[k]);
  if (missing.length > 0) {
    return res.json({
      success:false, demo:true,
      message:`M-Pesa not fully configured. Missing: ${missing.join(', ')}. Add them in Render → Environment Variables.`,
      setup_url:'https://developer.safaricom.co.ke'
    });
  }

  // Format phone number — accept 07xx, 01xx, 254xx, +254xx
  phone = phone.toString().replace(/\s+/g,'').replace(/^\+/,'');
  if (phone.startsWith('07') || phone.startsWith('01')) phone = '254' + phone.slice(1);
  if (!phone.startsWith('254') || phone.length !== 12) {
    return res.status(400).json({ success:false, message:`Invalid phone format. Got: ${phone}. Use 254712345678 or 0712345678` });
  }

  const planData = PLANS[plan];
  const amountKES = amount || planData?.kes || planData?.priceKES || 3800;
  const isSandbox = process.env.MPESA_SANDBOX !== 'false';
  const base = isSandbox ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
  const callbackBase = process.env.BACKEND_URL || 'https://growthpilot-77mo.onrender.com';

  try {
    console.log(`📱 M-Pesa STK Push initiated — Phone: ${phone}, Amount: KES ${amountKES}, Sandbox: ${isSandbox}`);
    const token     = await getMpesaToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
    const password  = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            Math.ceil(amountKES), // must be integer
      PartyA:            phone,
      PartyB:            process.env.MPESA_SHORTCODE,
      PhoneNumber:       phone,
      CallBackURL:       `${callbackBase}/api/payments/mpesa/callback`,
      AccountReference:  'GrowthPilot',
      TransactionDesc:   `GrowthPilot ${planData?.name || plan} Plan`
    };

    console.log('STK Payload:', JSON.stringify(payload));
    const r = await axios.post(`${base}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    console.log('STK Response:', JSON.stringify(r.data));

    if (r.data.ResponseCode !== '0') {
      return res.status(400).json({ success:false, message:`M-Pesa rejected: ${r.data.ResponseDescription || r.data.errorMessage}` });
    }

    const checkoutId = r.data.CheckoutRequestID;
    payments.push({ id:checkoutId, type:'mpesa', plan, phone, amount:amountKES, currency:'KES', status:'pending', createdAt:new Date().toISOString() });
    return res.json({
      success: true,
      message: `✅ M-Pesa prompt sent to ${phone}! Check your phone and enter your PIN.`,
      checkoutRequestId: checkoutId,
      amount: amountKES,
      currency: 'KES',
      sandbox: isSandbox
    });

  } catch(err) {
    const errMsg = err.response?.data?.errorMessage || err.response?.data?.ResultDesc || err.message;
    console.error('STK Push Error:', errMsg, err.response?.data);
    return res.status(500).json({ success:false, message:`M-Pesa error: ${errMsg}` });
  }
});

app.post('/api/payments/mpesa/callback', (req, res) => {
  const body    = req.body?.Body?.stkCallback;
  const code    = body?.ResultCode;
  const checkId = body?.CheckoutRequestID;
  if (code === 0) {
    const pmIdx = payments.findIndex(p => p.id === checkId);
    if (pmIdx > -1) payments[pmIdx].status = 'paid';
    const meta = body?.CallbackMetadata?.Item || [];
    const amount = meta.find(i=>i.Name==='Amount')?.Value;
    const receipt = meta.find(i=>i.Name==='MpesaReceiptNumber')?.Value;
    console.log(`✅ M-Pesa payment confirmed: KES ${amount} — Receipt: ${receipt}`);
  }
  res.json({ ResultCode:0, ResultDesc:'Accepted' });
});

app.get('/api/payments/mpesa/status/:id', async (req, res) => {
  const pm = payments.find(p => p.id === req.params.id);
  if (!pm) return res.status(404).json({ success:false, message:'Payment not found' });
  return res.json({ success:true, data:pm });
});

// ══════════════════════════════════════════════════════════
//  PAYMENTS — HISTORY + ANALYTICS
// ══════════════════════════════════════════════════════════
app.get('/api/payments', (req, res) => {
  const total   = payments.filter(p=>p.status==='paid').reduce((a,p)=>a+(p.currency==='KES'?p.amount/130:p.amount),0);
  const monthly = payments.filter(p=>p.status==='paid'&&new Date(p.createdAt)>new Date(Date.now()-30*86400000)).length;
  return res.json({ success:true, data:payments.slice(0,50), stats:{ totalRevenue:total.toFixed(2), monthlySubscriptions:monthly, totalTransactions:payments.length } });
});

// ══════════════════════════════════════════════════════════
//  SCHEDULE POSTS
// ══════════════════════════════════════════════════════════
app.post('/api/schedule', (req, res) => {
  const { caption, hashtags, platform, scheduledTime, status='scheduled', imageUrl } = req.body;
  if (!caption || !platform) return res.status(400).json({ success:false, message:'Caption and platform required' });
  const post = { id:Date.now().toString(), caption, hashtags:hashtags||[], platform, imageUrl:imageUrl||null, scheduledTime:scheduledTime||new Date(Date.now()+3600000).toISOString(), status, createdAt:new Date().toISOString() };
  scheduledPosts.unshift(post);
  if (scheduledPosts.length > 100) scheduledPosts = scheduledPosts.slice(0,100);
  return res.json({ success:true, data:post, message:`Post scheduled for ${platform}!` });
});

app.get('/api/schedule', (req, res) => {
  const { platform, status } = req.query;
  let posts = [...scheduledPosts];
  if (platform) posts = posts.filter(p=>p.platform===platform);
  if (status)   posts = posts.filter(p=>p.status===status);
  return res.json({ success:true, data:posts, total:posts.length });
});

app.delete('/api/schedule/:id', (req, res) => {
  const idx = scheduledPosts.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({ success:false, message:'Post not found' });
  scheduledPosts.splice(idx,1);
  return res.json({ success:true, message:'Post deleted' });
});

// ══════════════════════════════════════════════════════════
//  ANALYTICS
// ══════════════════════════════════════════════════════════
app.get('/api/analytics', (req, res) => {
  const rand = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
  return res.json({ success:true, data:{
    overview:{ totalFollowers:27600, avgEngagement:'8.7', totalReach:494000, postsToday:rand(3,7), repliesHandled:rand(350,450), growthRate:`+${rand(15,45)}%` },
    platforms:{
      ig:  { followers:12400+rand(-50,200),  engagement:8.7,  reach:142000+rand(-1000,5000),  color:'#E1306C', icon:'📸' },
      tt:  { followers:8900+rand(-100,500),  engagement:12.3, reach:289000+rand(-2000,10000), color:'#010101', icon:'🎵' },
      x:   { followers:4200+rand(-20,100),   engagement:4.1,  reach:45000+rand(-500,2000),    color:'#1DA1F2', icon:'𝕏' },
      li:  { followers:2100+rand(-10,80),    engagement:6.8,  reach:18000+rand(-200,1000),    color:'#0077B5', icon:'💼' },
    },
    weeklyChart:[
      {day:'Mon',ig:45,tt:78,x:23,li:18},{day:'Tue',ig:62,tt:91,x:31,li:24},
      {day:'Wed',ig:38,tt:65,x:19,li:15},{day:'Thu',ig:85,tt:112,x:44,li:38},
      {day:'Fri',ig:71,tt:98,x:37,li:29},{day:'Sat',ig:94,tt:134,x:52,li:41},
      {day:'Sun',ig:68,tt:87,x:28,li:22},
    ],
    updatedAt:new Date().toISOString()
  }});
});

// ══════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        GrowthPilot AI — Backend v3.0.0               ║
╠══════════════════════════════════════════════════════╣
║  Port          : ${PORT}                                  ║
║  Anthropic AI  : ${process.env.ANTHROPIC_API_KEY   ? '✅ Connected'    : '❌ Missing ANTHROPIC_API_KEY'}              ║
║  Twitter/X     : ${process.env.TWITTER_BEARER_TOKEN ? '✅ Connected'    : '⚠️  Missing TWITTER_BEARER_TOKEN'}          ║
║  Instagram     : ${process.env.INSTAGRAM_ACCESS_TOKEN?'✅ Connected'   : '⚠️  Missing INSTAGRAM_ACCESS_TOKEN'}         ║
║  TikTok        : ${process.env.TIKTOK_ACCESS_TOKEN  ? '✅ Connected'    : '⚠️  Missing TIKTOK_ACCESS_TOKEN'}            ║
║  Stripe        : ${process.env.STRIPE_SECRET_KEY    ? '✅ Connected'    : '⚠️  Missing STRIPE_SECRET_KEY'}              ║
║  M-Pesa        : ${process.env.MPESA_CONSUMER_KEY   ? '✅ Connected'    : '⚠️  Missing MPESA_CONSUMER_KEY'}             ║
╚══════════════════════════════════════════════════════╝
  `);
});
// ── M-PESA DEBUG TEST ────────────────────────────────
app.get('/api/payments/mpesa/test', async (req, res) => {
  const config = {
    consumer_key:    process.env.MPESA_CONSUMER_KEY    ? '✅ '+process.env.MPESA_CONSUMER_KEY.slice(0,6)+'...' : '❌ MISSING',
    consumer_secret: process.env.MPESA_CONSUMER_SECRET ? '✅ Set' : '❌ MISSING',
    shortcode:       process.env.MPESA_SHORTCODE        ? '✅ '+process.env.MPESA_SHORTCODE : '❌ MISSING',
    passkey:         process.env.MPESA_PASSKEY          ? '✅ '+process.env.MPESA_PASSKEY.slice(0,8)+'...' : '❌ MISSING',
    sandbox:         process.env.MPESA_SANDBOX !== 'false' ? '✅ Sandbox ON' : '⚠️ LIVE mode',
    backend_url:     process.env.BACKEND_URL || 'https://growthpilot-77mo.onrender.com (default)',
  };
  let tokenTest = '⏳ Not tested (key missing)';
  if (process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET) {
    try { const t = await getMpesaToken(); tokenTest = '✅ Token OK: '+t.slice(0,12)+'...'; }
    catch(e) { tokenTest = '❌ Token FAILED: '+e.message; }
  }
  res.json({ service:'M-Pesa Config Test', config, tokenTest, timestamp:new Date().toISOString() });
});


