# URL Shortener Backend - Project Report

## 1. Project Overview

This project is a backend URL shortener built using Node.js, Express.js, MongoDB, Redis, and Render.

The application allows a user to submit a long URL and receive a shorter URL. When someone visits the short URL, the backend redirects them to the original URL and tracks the number of clicks.

The project was built in phases:

1. Core URL shortening service
2. MongoDB persistence
3. Redis caching and link expiry
4. Redis-backed rate limiting
5. Benchmarking with autocannon
6. Deployment using Render, MongoDB Atlas, and Upstash Redis

The goal of the project was to learn backend fundamentals such as REST APIs, database modeling, caching, rate limiting, deployment, and basic performance testing.

## 2. Tech Stack

| Technology | Purpose |
| --- | --- |
| Node.js | Runtime for running JavaScript on the backend |
| Express.js | Web framework for creating API routes |
| MongoDB | Primary database for storing URL metadata |
| Mongoose | ODM for defining schemas and interacting with MongoDB |
| Redis | Cache layer and rate limiter storage |
| ioredis | Redis client used by the Node.js app |
| Docker Compose | Local development setup for MongoDB and Redis |
| Render | Hosting platform for the backend API |
| MongoDB Atlas | Hosted production MongoDB database |
| Upstash Redis | Hosted production Redis database |
| autocannon | Load testing and benchmarking tool |

## 3. Main Features

- Create a short URL from a long URL
- Generate short codes using base62 encoding
- Store URL metadata in MongoDB
- Redirect short URLs to the original URL using `302 Found`
- Track total clicks for every short URL
- Return stats for a short URL
- Cache redirect data in Redis using cache-aside pattern
- Expire short URLs using `expiresAt`
- Return `410 Gone` when a link is expired
- Rate limit URL creation using a Redis token bucket
- Benchmark redirect performance using autocannon
- Deploy the backend API live on Render

## 4. API Endpoints

### 4.1 Health Check

```http
GET /health
```

Used to check whether the server is running.

Example response:

```json
{
  "status": "ok"
}
```

### 4.2 Create Short URL

```http
POST /shorten
```

Request body:

```json
{
  "url": "https://example.com",
  "ttlDays": 30
}
```

Response:

```json
{
  "originalUrl": "https://example.com",
  "shortCode": "abc123",
  "shortUrl": "https://url-shortener-backend-yqk1.onrender.com/abc123",
  "expiresAt": "2026-07-13T10:00:00.000Z"
}
```

Behavior:

1. Server receives the original URL.
2. Server generates a short code.
3. URL data is saved in MongoDB.
4. Redirect data is cached in Redis.
5. Server returns the short URL.

### 4.3 Redirect Short URL

```http
GET /:code
```

Example:

```http
GET /abc123
```

Behavior:

1. Server checks Redis for `url:abc123`.
2. If Redis has the data, it is a cache hit.
3. If Redis does not have the data, MongoDB is queried.
4. If URL exists and is not expired, user is redirected to the original URL.
5. Click count is incremented in MongoDB.

Successful response:

```http
302 Found
Location: https://example.com
```

Possible error responses:

```json
{
  "error": "short url not found"
}
```

```json
{
  "error": "short url expired"
}
```

### 4.4 Get URL Stats

```http
GET /:code/stats
```

Example response:

```json
{
  "originalUrl": "https://example.com",
  "shortCode": "abc123",
  "clicks": 5,
  "createdAt": "2026-06-13T10:00:00.000Z",
  "expiresAt": "2026-07-13T10:00:00.000Z"
}
```

This endpoint is useful for verifying click tracking and URL metadata.

## 5. Database Design

### 5.1 URL Schema

Each URL document stores:

| Field | Purpose |
| --- | --- |
| `originalUrl` | The long URL submitted by the user |
| `shortCode` | Generated short code used in the short URL |
| `clicks` | Number of times the short URL was visited |
| `createdAt` | Time when the short URL was created |
| `expiresAt` | Time when the short URL should expire |

Conceptual schema:

```js
{
  originalUrl: String,
  shortCode: String,
  clicks: Number,
  createdAt: Date,
  expiresAt: Date
}
```

### 5.2 Counter Schema

The project uses a counter collection to generate sequential IDs.

Conceptual schema:

```js
{
  name: String,
  value: Number
}
```

The counter increments each time a new short URL is created. The numeric value is then converted to base62.

## 6. Short Code Generation

The project uses base62 encoding to create short codes.

Base62 uses:

```text
0-9, a-z, A-Z
```

This gives 62 possible characters per position.

Examples:

| Number | Base62 |
| --- | --- |
| 1 | `1` |
| 10 | `a` |
| 61 | `Z` |
| 62 | `10` |

Why base62 is useful:

- Produces shorter codes than decimal numbers
- Uses URL-safe characters
- Avoids special characters
- Easy to explain and implement

## 7. Why MongoDB Is Used

MongoDB is used as the source of truth.

It stores persistent URL data such as:

- Original URL
- Short code
- Click count
- Expiry time

Redis is only a temporary cache. If Redis is cleared, the app can still recover URL data from MongoDB.

## 8. Redis Caching

### 8.1 Problem Without Redis

Without Redis, every redirect request has to read from MongoDB:

```text
Client -> Express -> MongoDB -> Redirect
```

For popular short URLs, this creates repeated database reads.

### 8.2 Cache-Aside Pattern

This project uses cache-aside.

Flow:

```text
Client requests /:code
        |
        v
Check Redis
        |
        |-- cache hit --> redirect
        |
        |-- cache miss --> query MongoDB
                           store result in Redis
                           redirect
```

Why cache-aside is simple:

- Application controls what gets cached
- Redis can be cleared without losing source data
- MongoDB remains the permanent database

### 8.3 Redis Key Format

Redirect data is cached using keys like:

```text
url:abc123
```

The cached value contains:

```json
{
  "originalUrl": "https://example.com",
  "expiresAt": "2026-07-13T10:00:00.000Z"
}
```

### 8.4 Redis TTL

Redis keys are stored with TTL.

TTL means "time to live". After the TTL expires, Redis automatically removes the key.

The project sets Redis TTL based on the remaining time until `expiresAt`, capped at 24 hours.

This prevents Redis from storing expired URL data forever.

## 9. Link Expiry

Each URL has an `expiresAt` field.

When a redirect request comes in:

1. The server checks if the current time is greater than `expiresAt`.
2. If expired, the server deletes the Redis key.
3. The server returns `410 Gone`.

Why `410 Gone`:

- `404 Not Found` means the resource may never have existed.
- `410 Gone` means the resource existed before but is no longer available.

MongoDB also has a TTL index on `expiresAt`, so expired documents are eventually deleted by MongoDB.

Important detail:

MongoDB TTL deletion is not instant. That is why the app still checks expiry in the route before redirecting.

## 10. Redirect Status Code

The project uses:

```http
302 Found
```

Why not `301`?

`301 Moved Permanently` can be cached by browsers. If the browser permanently caches the redirect, future clicks may skip the backend. That would break click tracking.

`302 Found` is temporary, so requests are more likely to continue reaching the backend, allowing the server to track clicks.

## 11. Click Tracking

Every time a short URL is visited successfully, the app increments the click count in MongoDB.

On cache hit:

```text
Redis -> redirect -> increment MongoDB clicks
```

On cache miss:

```text
MongoDB -> cache in Redis -> redirect -> increment MongoDB clicks
```

This keeps Redis useful for lookup speed while MongoDB stores the permanent click count.

## 12. Rate Limiting

### 12.1 Why Rate Limiting Is Needed

The `POST /shorten` endpoint creates new records. Without rate limiting, someone could spam the endpoint and create many short URLs quickly.

Rate limiting protects:

- Server resources
- MongoDB writes
- Redis writes
- Application reliability

### 12.2 Token Bucket Algorithm

The project uses a token bucket rate limiter stored in Redis.

Each client IP gets a bucket.

Default values:

```text
Bucket capacity: 20 tokens
Refill rate: 1 token per second
```

Each `POST /shorten` request spends 1 token.

If tokens are available:

```text
Allow request
```

If no tokens are available:

```http
429 Too Many Requests
```

### 12.3 Redis Key For Rate Limiting

Rate limit data is stored using keys like:

```text
rate_limit:127.0.0.1
```

The stored values include:

- Current token count
- Last refill timestamp

### 12.4 Why Token Bucket Instead Of Fixed Window

Fixed window rate limiting can allow bursts at the boundary between two windows.

Example:

```text
20 requests at 12:00:59
20 requests at 12:01:00
```

That allows 40 requests almost instantly.

Token bucket smooths traffic because tokens refill gradually over time.

## 13. Benchmarking

The redirect endpoint was benchmarked locally using autocannon.

Command:

```bash
npx autocannon -c 50 -d 10 http://localhost:3000/YOUR_CODE
```

Recorded local results:

```text
Cold Redis:
p99 latency: 61 ms
avg req/sec: 1440.1

Warm Redis:
p99 latency: 58 ms
avg req/sec: 1416.6
```

Interpretation:

- p99 latency means 99% of requests completed within that time.
- Average requests/sec means how many requests the server handled per second on average.
- Results are local and depend on machine performance, Docker, and current system load.

Important resume note:

Do not claim Redis reduced latency by a specific percentage because the benchmark did not clearly prove a large improvement. A safer claim is:

```text
Benchmarked redirect endpoint at approximately 1.4k requests/sec with 58-61 ms p99 latency locally.
```

## 14. Deployment

The project is deployed using:

- Render for hosting the Node.js backend
- MongoDB Atlas for production MongoDB
- Upstash Redis for production Redis

Production environment variables:

```env
BASE_URL=https://url-shortener-backend-yqk1.onrender.com
MONGO_URI=<MongoDB Atlas connection string>
REDIS_URL=<Upstash Redis connection string>
NODE_ENV=production
```

The deployed API was tested using:

```bash
curl https://url-shortener-backend-yqk1.onrender.com/health
```

Expected response:

```json
{
  "status": "ok"
}
```

The redirect endpoint was also tested live and returned:

```http
302 Found
Location: https://google.com
```

## 15. Important Files

| File | Purpose |
| --- | --- |
| `src/server.js` | Starts the server and connects to MongoDB |
| `src/app.js` | Configures Express middleware and routes |
| `src/routes.js` | Contains URL creation, redirect, and stats routes |
| `src/db.js` | Connects to MongoDB |
| `src/redis.js` | Connects to Redis |
| `src/models/Url.js` | Mongoose schema for URL records |
| `src/models/Counter.js` | Mongoose schema for counter-based short code generation |
| `src/utils/base62.js` | Converts numbers into base62 short codes |
| `src/middleware/rateLimiter.js` | Redis token bucket rate limiter |
| `docker-compose.yml` | Runs local MongoDB and Redis |
| `README.md` | Public project documentation |
| `ARCHITECTURE.md` | Architecture explanation |
| `.env.example` | Example environment variables |

## 16. End-To-End Request Flow

### 16.1 Creating A Short URL

```text
Client sends POST /shorten
        |
        v
Rate limiter checks Redis tokens
        |
        v
Express validates request body
        |
        v
Counter increments in MongoDB
        |
        v
Counter value is base62 encoded
        |
        v
URL document is saved in MongoDB
        |
        v
URL data is cached in Redis
        |
        v
Short URL is returned
```

### 16.2 Redirecting A Short URL

```text
Client visits GET /:code
        |
        v
Express checks Redis
        |
        |-- cache hit --> check expiry --> increment clicks --> 302 redirect
        |
        |-- cache miss --> query MongoDB --> check expiry --> cache in Redis --> increment clicks --> 302 redirect
```

### 16.3 Getting Stats

```text
Client sends GET /:code/stats
        |
        v
Express queries MongoDB
        |
        v
Return original URL, short code, clicks, createdAt, expiresAt
```

## 17. Common Interview Questions

### Q1. What problem does this project solve?

It converts long URLs into shorter URLs and redirects users from the short URL to the original URL. It also tracks clicks, supports expiry, caches redirect data, and rate limits URL creation.

### Q2. Why did you use MongoDB?

MongoDB stores the permanent URL metadata such as original URL, short code, click count, creation time, and expiry time.

### Q3. Why did you use Redis?

Redis is used for caching redirect data and storing rate limiter state. It helps reduce repeated MongoDB reads for frequently accessed short URLs.

### Q4. What is cache-aside?

Cache-aside means the application checks the cache first. If data is not present, the app reads from the database, stores the result in cache, and then returns the response.

### Q5. Why use `302` instead of `301`?

`301` redirects can be cached permanently by browsers. That could prevent future requests from reaching the backend, which would break click tracking. `302` is temporary and better for tracking redirects.

### Q6. What happens when a link expires?

The server checks `expiresAt`. If the link is expired, it deletes the Redis key and returns `410 Gone`.

### Q7. How does the rate limiter work?

Each IP gets a token bucket stored in Redis. The bucket has a maximum number of tokens and refills over time. Each URL creation request consumes one token. If there are no tokens, the server returns `429 Too Many Requests`.

### Q8. What would break at higher scale?

Click tracking could become a bottleneck because every redirect updates MongoDB. Redis and MongoDB would need managed scaling. Click updates could be moved to a queue or processed asynchronously.

### Q9. How would you improve this project?

Possible improvements:

- Add user authentication
- Allow custom aliases
- Add analytics by date/referrer/device
- Queue click tracking asynchronously
- Add automated tests
- Add frontend UI
- Add monitoring and logging

## 18. Resume-Safe Explanation

A safe way to explain this project:

```text
I built and deployed a URL shortener backend using Node.js, Express, MongoDB, and Redis. It supports short URL creation, redirect handling, click tracking, stats, TTL-based expiry, Redis cache-aside lookups, and Redis-backed token bucket rate limiting. I deployed it on Render with MongoDB Atlas and Upstash Redis, and benchmarked redirects locally using autocannon.
```

## 19. Things To Avoid Saying

Avoid saying:

```text
I built a highly scalable distributed system.
```

Better:

```text
I built a backend project with caching, rate limiting, deployment, and basic performance benchmarking.
```

Avoid saying:

```text
Redis reduced latency by X%.
```

Better:

```text
Redis was added to reduce repeated MongoDB reads on hot redirect paths.
```

## 20. Final Revision Checklist

Before an interview, revise:

- What each endpoint does
- What data is stored in MongoDB
- How base62 encoding works
- What Redis stores
- What cache hit and cache miss mean
- Why `302` is used
- What `410 Gone` means
- How the token bucket rate limiter works
- What the benchmark numbers mean
- How the app is deployed
- What you would improve next

