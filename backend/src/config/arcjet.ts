import arcjet, { shield, detectBot, slidingWindow } from "@arcjet/node";

const isProduction = process.env.NODE_ENV === "production";

if (!process.env.ARCJET_KEY && isProduction) {
  throw new Error("ARCJET_KEY is not set in the environment variables");
}

const aj = !process.env.ARCJET_KEY ? null : arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE",
      allow: [
        "CATEGORY:SEARCH_ENGINE",
      ],
    }),
    // slidingWindow({
    //   mode: "LIVE",
    //   interval: '2m',
    //   max: 5,
    // }),
  ],
});

export default aj;