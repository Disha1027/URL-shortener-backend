\# Architecture



This project is a backend URL shortener built with Node.js, Express, MongoDB, and Redis.



\## High-Level Flow



```text

Client

&#x20; |

&#x20; | POST /shorten

&#x20; v

Express API

&#x20; |

&#x20; | generate base62 short code

&#x20; v

MongoDB

&#x20; |

&#x20; | save originalUrl, shortCode, clicks, expiresAt

&#x20; v

Response with shortUrl

```



```text

Client

&#x20; |

&#x20; | GET /:code

&#x20; v

Express API

&#x20; |

&#x20; | check Redis cache

&#x20; v

Redis

&#x20; |

&#x20; | cache hit

&#x20; v

302 redirect to original URL

```



```text

Client

&#x20; |

&#x20; | GET /:code

&#x20; v

Express API

&#x20; |

&#x20; | check Redis cache

&#x20; v

Redis

&#x20; |

&#x20; | cache miss

&#x20; v

MongoDB

&#x20; |

&#x20; | fetch original URL

&#x20; v

Redis

&#x20; |

&#x20; | store URL data with TTL

&#x20; v

302 redirect to original URL

```



\## Main Components



\### Express



Express handles HTTP routes:



\- `POST /shorten`

\- `GET /:code`

\- `GET /:code/stats`

\- `GET /health`



\### MongoDB



MongoDB is the main database.



It stores:



\- original URL

\- short code

\- click count

\- creation date

\- expiry date



\### Redis



Redis is used for two things:



1\. Caching redirect data

2\. Rate limiting URL creation



For redirect caching, Redis stores data using keys like:



```text

url:abc123

```



For rate limiting, Redis stores data using keys like:



```text

rate\_limit:127.0.0.1

```



\## Why Redis Is Used



Without Redis, every redirect requires a MongoDB read.



```text

GET /:code -> MongoDB -> redirect

```



With Redis, frequently visited short URLs can be served from cache.



```text

GET /:code -> Redis -> redirect

```



MongoDB is still the source of truth. Redis is only a temporary cache.



\## Cache-Aside Pattern



The redirect endpoint uses cache-aside.



1\. Check Redis first.

2\. If the data exists, use it.

3\. If not, fetch from MongoDB.

4\. Store the MongoDB result in Redis.

5\. Redirect the user.



This keeps Redis simple because the app controls what gets cached.



\## Expiry Strategy



Each short URL has an `expiresAt` field.



When a redirect request comes in, the server checks whether the link is expired.



If expired, the server returns:



```text

410 Gone

```



MongoDB also has a TTL index on `expiresAt`, so expired documents are eventually removed automatically.



Redis keys also use TTL so cached URL data does not live forever.



\## Rate Limiting Strategy



`POST /shorten` uses a token bucket rate limiter.



Each IP gets a bucket with:



\- 20 maximum tokens

\- 1 token refilled per second



Each request spends 1 token.



If the bucket has no tokens, the server returns:



```text

429 Too Many Requests

```



This protects the URL creation endpoint from spam.



\## Why 302 Redirect



The redirect endpoint uses `302 Found`.



A `301` redirect can be cached by browsers permanently. That is not ideal here because the server needs redirect requests to reach the backend so it can track clicks.



A `302` redirect is temporary, so clients are more likely to request the backend again.



\## Benchmark Notes



The redirect endpoint was benchmarked locally using autocannon:



```bash

npx autocannon -c 50 -d 10 http://localhost:3000/YOUR\_CODE

```



Recorded local result:



```text

Cold Redis:

p99 latency: 61 ms

avg req/sec: 1440.1



Warm Redis:

p99 latency: 58 ms

avg req/sec: 1416.6

```



These numbers are local machine results and can change depending on system load, Docker performance, and network conditions.



\## What Could Improve At Higher Scale



\- Use Redis Cluster or managed Redis for high availability.

\- Batch or asynchronously process click tracking.

\- Use read replicas for MongoDB.

\- Add custom aliases for short URLs.

\- Add user accounts and authentication.

\- Add analytics by time, location, or referrer.

\- Add stronger validation and abuse protection.

