/*!
 * Redis Rate Limiter for NOC Control Center
 * Uses rate-limiter-flexible with ioredis
 */

const Redis = require('ioredis');
const { RateLimiterRedis } = require('rate-limiter-flexible');

let redisClient = null;
let limiterInstances = new Map();

/**
 * Initialize Redis connection
 * @param {Object} options - Redis connection options
 * @param {string} options.host - Redis host (default: 'localhost')
 * @param {number} options.port - Redis port (default: 6379)
 * @param {string} options.password - Redis password (optional)
 * @param {number} options.db - Redis database number (default: 0)
 * @returns {Redis} Redis client instance
 */
function initRedis(options = {}) {
  const {
    host = process.env.REDIS_HOST || 'localhost',
    port = parseInt(process.env.REDIS_PORT || '6379', 10),
    password = process.env.REDIS_PASSWORD || undefined,
    db = parseInt(process.env.REDIS_DB || '0', 10),
  } = options;

  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis({
    host,
    port,
    password,
    db,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) {
        console.error('[rate-limiter] Redis connection failed after 3 retries');
        return null; // Stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  redisClient.on('error', (err) => {
    console.error('[rate-limiter] Redis error:', err.message);
  });

  redisClient.on('connect', () => {
    console.log('[rate-limiter] Redis connected');
  });

  redisClient.on('ready', () => {
    console.log('[rate-limiter] Redis ready');
  });

  return redisClient;
}

/**
 * Get or create a rate limiter instance
 * @param {string} keyPrefix - Prefix for Redis keys (e.g., 'rl:login', 'rl:cmd')
 * @param {Object} options - Rate limiter options
 * @param {number} options.points - Max requests allowed
 * @param {number} options.duration - Time window in seconds
 * @param {number} options.blockDuration - Block duration in seconds (optional)
 * @returns {RateLimiterRedis} Rate limiter instance
 */
function getLimiter(keyPrefix, options) {
  const cacheKey = `${keyPrefix}:${options.points}:${options.duration}:${options.blockDuration || 0}`;
  
  if (limiterInstances.has(cacheKey)) {
    return limiterInstances.get(cacheKey);
  }

  if (!redisClient) {
    initRedis();
  }

  const limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix,
    points: options.points,
    duration: options.duration,
    blockDuration: options.blockDuration || 0,
    // Execute Lua script atomically
    execEvenly: true,
  });

  limiterInstances.set(cacheKey, limiter);
  return limiter;
}

/**
 * Check rate limit for a key
 * @param {string} keyPrefix - Prefix for Redis keys
 * @param {string} key - Unique identifier (e.g., IP address, user ID)
 * @param {Object} options - Rate limiter options
 * @param {number} options.points - Max requests allowed
 * @param {number} options.duration - Time window in seconds
 * @param {number} options.blockDuration - Block duration in seconds (optional)
 * @returns {Promise<{allowed: boolean, remaining: number, resetTime: number|null}>}
 */
async function checkRateLimit(keyPrefix, key, options) {
  const limiter = getLimiter(keyPrefix, options);
  
  try {
    const result = await limiter.consume(key);
    return {
      allowed: true,
      remaining: result.remainingPoints,
      resetTime: Date.now() + result.msBeforeNext,
    };
  } catch (rejRes) {
    // rejRes is a RateLimiterRes object when blocked
    return {
      allowed: false,
      remaining: rejRes.remainingPoints || 0,
      resetTime: rejRes.msBeforeNext ? Date.now() + rejRes.msBeforeNext : null,
      retryAfterSec: Math.ceil(rejRes.msBeforeNext / 1000) || options.blockDuration || options.duration,
    };
  }
}

/**
 * Reset rate limit for a specific key
 * @param {string} keyPrefix - Prefix for Redis keys
 * @param {string} key - Unique identifier
 * @returns {Promise<void>}
 */
async function resetRateLimit(keyPrefix, key) {
  const limiter = getLimiter(keyPrefix, { points: 1, duration: 1 });
  await limiter.delete(key);
}

/**
 * Close Redis connection
 * @returns {Promise<void>}
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    limiterInstances.clear();
  }
}

module.exports = {
  initRedis,
  getLimiter,
  checkRateLimit,
  resetRateLimit,
  closeRedis,
};