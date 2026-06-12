const express = require("express");
const Url = require("./models/Url");
const Counter = require("./models/Counter");
const encodeBase62 = require("./utils/base62");

const router = express.Router();

async function generateShortCode() {
  const counter = await Counter.findOneAndUpdate(
    { name: "url" },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );

  return encodeBase62(counter.value);
}

router.post("/shorten", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const shortCode = await generateShortCode();

    const newUrl = await Url.create({
      originalUrl: url,
      shortCode: shortCode
    });

    return res.json({
      originalUrl: newUrl.originalUrl,
      shortCode: newUrl.shortCode,
      shortUrl: `http://localhost:3000/${newUrl.shortCode}`
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
      createdAt: urlData.createdAt
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "something went wrong" });
  }
});

router.get("/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const urlData = await Url.findOne({ shortCode: code });

    if (!urlData) {
      return res.status(404).json({ error: "short url not found" });
    }

    urlData.clicks = urlData.clicks + 1;
    await urlData.save();

    return res.redirect(urlData.originalUrl);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "something went wrong" });
  }
});

module.exports = router;