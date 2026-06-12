const express = require("express");
const Url = require("./models/Url");
const Counter = require("./models/Counter");
const encodeBase62 = require("./utils/base62");
const redis = require("./redis");

const router = express.Router();

async function generateShortCode() {
  const counter = await Counter.findOneAndUpdate(
    { name: "url" },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );

  return encodeBase62(counter.value);
}

function getExpiryDate(ttlDays) {
  const days = ttlDays === undefined ? 30 : Number(ttlDays);

  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }

  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function isExpired(expiresAt) {
  return new Date(expiresAt).getTime() <= Date.now();
}

function getRedisTtlSeconds(expiresAt) {
  const secondsUntilExpiry = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / 1000
  );

  return Math.min(24 * 60 * 60, secondsUntilExpiry);
}

router.post("/shorten", async (req, res) => {
  try {
    const { url, ttlDays } = req.body;

    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const shortCode = await generateShortCode();
    const expiresAt = getExpiryDate(ttlDays);
if (!expiresAt) {
  return res.status(400).json({ error: "ttlDays must be a positive number" });
}

    const newUrl = await Url.create({
      originalUrl: url,
      shortCode: shortCode,
      expiresAt: expiresAt
    });

   const redisTtlSeconds = getRedisTtlSeconds(newUrl.expiresAt);

    if (redisTtlSeconds > 0) {
  await redis.set(
    `url:${newUrl.shortCode}`,
    JSON.stringify({
      originalUrl: newUrl.originalUrl,
      expiresAt: newUrl.expiresAt
    }),
    "EX",
    redisTtlSeconds
  );
}

    return res.json({
      originalUrl: newUrl.originalUrl,
      shortCode: newUrl.shortCode,
      shortUrl: `http://localhost:3000/${newUrl.shortCode}`,
      expiresAt: newUrl.expiresAt
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "something went wrong" });
  }
});

router.get("/:code/stats", async (req, res) => {
  try {
    const { code } = req.params;

    const urlData = await Url.findOne({ shortCode: code });

    if (!urlData) {
      return res.status(404).json({ error: "short url not found" });
    }

    return res.json({
      originalUrl: urlData.originalUrl,
      shortCode: urlData.shortCode,
      clicks: urlData.clicks,
      createdAt: urlData.createdAt,
      expiresAt: urlData.expiresAt
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "something went wrong" });
  }
});

router.get("/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const cachedData = await redis.get(`url:${code}`);

    if (cachedData) {
      console.log("CACHE HIT");

      const parsedData = JSON.parse(cachedData);

      if (isExpired(parsedData.expiresAt)) {
        await redis.del(`url:${code}`);
        return res.status(410).json({ error: "short url expired" });
      }

      await Url.updateOne({ shortCode: code }, { $inc: { clicks: 1 } });
      return res.redirect(parsedData.originalUrl);
    }

    console.log("CACHE MISS");

    const urlData = await Url.findOne({ shortCode: code });

    if (!urlData) {
      return res.status(404).json({ error: "short url not found" });
    }

    if (isExpired(urlData.expiresAt)) {
      await redis.del(`url:${code}`);
      return res.status(410).json({ error: "short url expired" });
    }

    const redisTtlSeconds = getRedisTtlSeconds(urlData.expiresAt);

    if (redisTtlSeconds > 0) {
  await redis.set(
    `url:${urlData.shortCode}`,
    JSON.stringify({
      originalUrl: urlData.originalUrl,
      expiresAt: urlData.expiresAt
    }),
    "EX",
    redisTtlSeconds
  );
}

    await Url.updateOne({ shortCode: code }, { $inc: { clicks: 1 } });

    return res.redirect(urlData.originalUrl);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "something went wrong" });
  }
});

module.exports = router;