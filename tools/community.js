// ============================================================
// community.js — Caregiver Community Forum
//
// Anonymous Q&A where caregivers share experiences.
// No PHI — just questions like "Has anyone dealt with
// Medicare denying Xdemvy?" and "How long did your
// mom's refund from the vein doctor take?"
// ============================================================

const fs = require('fs');
const path = require('path');
const POSTS_FILE = path.join(__dirname, '..', 'data', 'community_posts.json');

function loadPosts() {
  try {
    if (!fs.existsSync(POSTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
  } catch (e) { return []; }
}

function savePosts(posts) {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}

const CATEGORIES = [
  'medications', 'insurance', 'doctors', 'pharmacy',
  'medicare', 'medicaid', 'caregiving', 'billing',
  'specialists', 'lab-results', 'tips', 'emotional-support'
];

function createPost({ userId, displayName, category, title, body }) {
  const posts = loadPosts();
  const post = {
    id: 'post_' + Date.now(),
    userId,
    displayName: displayName || 'Anonymous Caregiver',
    category: CATEGORIES.includes(category) ? category : 'caregiving',
    title,
    body,
    replies: [],
    upvotes: 0,
    upvotedBy: [],
    viewCount: 0,
    createdAt: new Date().toISOString(),
  };
  posts.unshift(post);
  savePosts(posts);
  return post;
}

function addReply(postId, { userId, displayName, body }) {
  const posts = loadPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return null;
  const reply = {
    id: 'reply_' + Date.now(),
    userId,
    displayName: displayName || 'Anonymous Caregiver',
    body,
    upvotes: 0,
    upvotedBy: [],
    createdAt: new Date().toISOString(),
  };
  post.replies.push(reply);
  savePosts(posts);
  return reply;
}

function upvotePost(postId, userId) {
  const posts = loadPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return null;
  if (post.upvotedBy.includes(userId)) return post; // already upvoted
  post.upvotes++;
  post.upvotedBy.push(userId);
  savePosts(posts);
  return post;
}

function upvoteReply(postId, replyId, userId) {
  const posts = loadPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return null;
  const reply = post.replies.find(r => r.id === replyId);
  if (!reply) return null;
  if (reply.upvotedBy.includes(userId)) return reply;
  reply.upvotes++;
  reply.upvotedBy.push(userId);
  savePosts(posts);
  return reply;
}

function getPosts({ category, sort, limit, offset } = {}) {
  let posts = loadPosts();
  if (category && category !== 'all') {
    posts = posts.filter(p => p.category === category);
  }
  if (sort === 'popular') {
    posts.sort((a, b) => b.upvotes - a.upvotes);
  }
  // Default: newest first (already sorted by unshift)
  const total = posts.length;
  const start = offset || 0;
  const end = start + (limit || 20);
  return { posts: posts.slice(start, end), total, categories: CATEGORIES };
}

function getPost(postId) {
  const posts = loadPosts();
  const post = posts.find(p => p.id === postId);
  if (post) post.viewCount++;
  savePosts(posts);
  return post;
}

module.exports = { createPost, addReply, upvotePost, upvoteReply, getPosts, getPost, CATEGORIES };
