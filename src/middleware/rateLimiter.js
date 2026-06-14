const redis = require("../redis");

function tokenBucketRateLimiter(options = {}) {
  const capacity = options.capacity || 20;
  const refillRate = options.refillRate || 1;

  return async function rateLimiter(req, res, next) {
    try {
      const ip = req.ip || req.socket.remoteAddress;
      const key = `rate_limit:${ip}`;
      const now = Date.now();

      const bucket = await redis.hgetall(key);

      const tokens = bucket.tokens === undefined ? capacity : Number(bucket.tokens);
      const lastRefill = bucket.lastRefill === undefined ? now : Number(bucket.lastRefill);

      const secondsPassed = (now - lastRefill) / 1000;
      const tokensToAdd = secondsPassed * refillRate;
      const currentTokens = Math.min(capacity, tokens + tokensToAdd);

      if (currentTokens < 1) {
        const retryAfterSeconds = Math.ceil((1 - currentTokens) / refillRate);

        await redis.hset(key, {
          tokens: currentTokens,
          lastRefill: now
        });

        await redis.expire(key, capacity * 2);

        res.set("Retry-After", String(retryAfterSeconds));

        return res.status(429).json({
          error: "rate limit exceeded",
          retryAfterSeconds: retryAfterSeconds
        });
      }

      await redis.hset(key, {
        tokens: currentTokens - 1,
        lastRefill: now
      });

      await redis.expire(key, capacity * 2);

      next();
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "rate limiter failed" });
    }
  };
}

module.exports = tokenBucketRateLimiter;